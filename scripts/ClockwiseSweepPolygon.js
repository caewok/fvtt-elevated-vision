/* globals
canvas,
ClipperLib,
CONFIG,
CONST,
foundry,
PIXI,
PointSourcePolygon
*/
"use strict";

import { MODULE_ID, OTHER_MODULES, FLAGS } from "./const.js";
import { lineSegment3dWallIntersection, combineBoundaryPolygonWithHoles } from "./util.js";
import { Draw } from "./geometry/Draw.js";
import { Shadow, ShadowProjection } from "./geometry/Shadow.js";
import { SCENE_GRAPH } from "./WallTracer.js";

export const PATCHES = {};
PATCHES.POLYGONS = {};

/**
 * From ClockwiseSweepPolygon#_determineEdgeTypes
 * @type {enum}
 */
const EDGE_TYPES = {
  NO: 0,
  MAYBE: 1,
  ALWAYS: 2
};


/* TODO: Use region shapes to influence shadow elevation.
1. Do shadow calcs for scene elevation.
2. For a given region polygon, if not hole:
- Erase the shadow calc in (1) for that poly area
- Do the shadow calculation but change the background elevation. (Ramps? Hard)
- Union the shadows from (1) and (2).
- If region is above source, region is entirely shadowed

Sort regions from low to high so overlapping regions are processed
*/

/**
 * Wrap ClockwiseSweepPolygon.prototype._identifyEdges
 * Get walls that are below the
 * For compatibility with Wall Height and other modules, just re-run quad tree to
 * get walls below the source.
 * Wall Height will have already removed these walls from the LOS, so can just store here.
 */
function _compute(wrapped) {
  wrapped();
  if ( !canvas.edges.quadtree ) return; // Too early in loading.

  const sweep = this;
  const source = sweep.config.source;
  let sourceZ = source.elevationZ;
  if ( !isFinite(sourceZ) ) sourceZ = 1e06;

  const bounds = sweep._defineBoundingBox();
  const edgeTypes = sweep._determineEdgeTypes();
  edgeTypes.regionWall = EDGE_TYPES.MAYBE;
  const collisionTest = (o, rect) => _testEdgeInclusion.call(sweep, o.t, edgeTypes, rect);
  let edges = canvas.edges.quadtree.getObjects(bounds, { collisionTest });

  /* Ignoring walls
    Limited-height walls removed by Wall Height; shadows must be separate.
    If the limited-height wall is completely above the source, we don't care about it.
    Limited-height walls completely below 0 can be ignored if the source is above 0 and vice-versa
      (b/c ground assumed to block)
  */

  const rect = new PIXI.Rectangle(source.x - 1, source.y - 1, 2, 2);
  const tiles = canvas.tiles.quadtree.getObjects(rect);
  const sourceE = CONFIG.GeometryLib.utils.pixelsToGridUnits(sourceZ);
  edges = edges.filter(e => edgeMinBottomE(e) <= sourceE && !edgeIsUnderneathTile(this, e, tiles));

  const TM = OTHER_MODULES.TERRAIN_MAPPER;
  const sceneGroundE = TM.ACTIVE ? (canvas.scene.getFlag(TM.KEY, TM.BACKGROUND_ELEVATION) || 0) : 0;
  const ClipperPaths = CONFIG.GeometryLib.ClipperPaths;
  const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
  const { Point3d, Plane } = CONFIG.GeometryLib.threeD;

  // Locate all regions that block vision.
  // Sort from lowest to highest elevation, including the scene background "region".
  // Construct the shadow polygon for each and combine.
  // If the region is above the source, simply shadow its polygon(s)
  // If the region is below the source, apply shadows to its plane.
  // TODO: Handle ramps and steps.
  const blockingRegions = canvas.regions.placeables
    .filter(r => r.document.getFlag(MODULE_ID, FLAGS.BLOCKS_VISION))
    .map(r => {
      return { paths: ClipperPaths.fromPolygons(r.polygons), maxE: maxRegionElevation(r) };
    });
  blockingRegions.push({ paths: canvas.scene[MODULE_ID].sceneBackgroundRegion, maxE: sceneGroundE });
  blockingRegions.sort((a, b) => a.maxE - b.maxE);

  const evS = _constructPolygonShadowsObject(sweep);
  const sourceType = source.constructor.sourceType;
  edges.forEach(e => {
    if ( e[sourceType] === CONST.WALL_SENSE_TYPES.LIMITED ) evS.limitedEdges.add(e);
    else evS.normalEdges.add(e);
  });
  if ( !evS.limitedEdges.size && !evS.normalEdges.size) return;

  // Determine all the shadows in the scene.
  let shadowPath = new ClipperPaths(); // Empty path.
  for ( const blockingRegion of blockingRegions ) {
    if ( blockingRegion.maxE > sourceE ) {
      // Region top is above the source, so it is totally in shadow.
      // Remove the area for this region from the sweep shape.
      shadowPath.union(blockingRegion.paths);
      continue;
    }

    // Add back this region so shadows specific to its plane can be calculated.
    shadowPath = blockingRegion.paths.diffPaths(shadowPath);

    // TODO: Handle ramps
    const ptOnPlane = new Point3d(0, 0, gridUnitsToPixels(blockingRegion.maxE));
    const normal = new Point3d(0, 0, 1);
    evS.shadowProjection = new ShadowProjection(new Plane(ptOnPlane, normal), sweep.config.source);

    // Store each shadow individually
    evS.shadows.length = 0;
    _constructLimitedEdgeShadows(evS, source);
    _constructNormalEdgeShadows(evS);

    // Combine the shadows
    // Use positive fill so any overlap is filled.
    const regionShadows = ClipperPaths.fromPolygons(evS.shadows);

    // Get the shadows that intersect the region shape only.
    const regionShadowsTrimmed = ClipperPaths.clip(blockingRegion.paths, regionShadows, {
      clipType: ClipperLib.ClipType.ctIntersection,
      subjFillType: ClipperLib.PolyFillType.pftPositive, // {pftEvenOdd: 0, pftNonZero: 1, pftPositive: 2, pftNegative: 3
      clipFillType: ClipperLib.PolyFillType.pftPositive
    });

    // Add back into the shadow path
    if ( regionShadowsTrimmed.paths.length ) shadowPath = regionShadowsTrimmed.combine(shadowPath);
  }

  // Invert the shadow path, keeping within the bounds of the sweep.
  // The sweep fills in the visible portions; shadows are effectively holes.
  const sweepPath = ClipperPaths.fromPolygons([sweep]);
  const sweepWithShadows = ClipperPaths.clip(sweepPath, shadowPath, {
    clipType: ClipperLib.ClipType.ctDifference,
    subjFillType: ClipperLib.PolyFillType.pftPositive, // {pftEvenOdd: 0, pftNonZero: 1, pftPositive: 2, pftNegative: 3
    clipFillType: ClipperLib.PolyFillType.pftPositive
  });

  const shadows = shadowPath.toPolygons();
  evS.combinedShadows = sweepWithShadows.toPolygons();

  // Trigger so that PIXI.Graphics.drawShape draws the holes.
  if ( evS.combinedShadows.length ) sweep._evPolygons = evS.combinedShadows;
}

PATCHES.POLYGONS.WRAPS = { _compute };

/**
 * @typedef {object} PolygonShadows
 * @prop {ShadowProjection} shadowProjection
 * @prop {Shadow[]} shadows
 * @prop {PIXI.Polygon[]} combined
 * @prop {Set<Edge>} limitedEdges
 * @prop {Set<Edge>} normalEdges
 */

/**
 * Build the polygon shadows object for a sweep
 * @param {ClockwisePolygonSweep} sweep
 * @returns {PolygonShadows}
 */
function _constructPolygonShadowsObject(sweep) {
  const ev = sweep[MODULE_ID] ??= {};
  if ( ev.polygonShadows ) {
    const evS = ev.polygonShadows;
    evS.shadows.length = 0;
    evS.combined.length = 0;
    evS.limitedEdges.clear();
    evS.normalEdges.clear();

  } else {
    ev.polygonShadows = {
      shadowProjection: new ShadowProjection(new CONFIG.GeometryLib.threeD.Plane(), sweep.config.source),
      shadows: [],             /** @type {Shadow[]} */
      combined: [],            /** @type {PIXI.Polygon[]} */
      limitedEdges: new Set(), /** @type {Set<Edge>} */
      normalEdges: new Set()   /** @type {Set<Edge>} */
    };
  }
  return ev.polygonShadows;
}

/**
 * Construct a shadow for an edge.
 * @param {Edge} edge
 * @param {ShadowProjection} proj
 * @returns {Shadow|null}
 */
function _shadowForEdge(edge, proj) {
  const edgePoints = edgePointsForEdge(edge, { finite: true });
  const shadowPoints = proj._constructShadowPointsForWallPoints(edgePoints);
  if ( !shadowPoints.length ) return null;
  return new Shadow(shadowPoints);
}

/**
 * Construct limited edge (terrain wall) shadows
 * @param {PolygonShadows} evS
 * @param {RenderedEffectSource} source
 */
function _constructLimitedEdgeShadows(evS, source) {
  /* Terrain wall shadows
    If a limited-height wall is blocking a terrain wall of any height,
    that will not be recorded by the LOS sweep b/c the limited-height wall is removed by Wall Height.

    Non-terrain walls will create shadows that entirely overlap whatever shadow would
    be caused by the terrain wall behind.

    Thus, we only need to care about terrain walls that are behind other terrain walls.

    The shadows of two terrain walls is the intersection of them.
  */

  if ( evS.limitedEdges.size < 2 ) return;
  // Temporarily cache the edge points
  evS.limitedEdges.forEach(e => {
    e._elevatedvision ??= {};
    e._elevatedvision.edgePoints = edgePointsForEdge(e, { finite: true });
  });

  // For each limited edge, determine what edges block the source in relation to it.
  const sourceOrigin = CONFIG.GeometryLib.threeD.Point3d.fromPointSource(source);
  for ( const e of evS.limitedEdges ) {
    const blockingEdges = filterPotentialBlockingEdges(
      e._elevatedvision.edgePoints,
      evS.limitedEdges,
      sourceOrigin);
    blockingEdges.delete(e);

    if ( blockingEdges.size ) {
      const shadowWPts = evS.shadowProjection._constructShadowPointsForWallPoints(e._elevatedvision.edgePoints);
      if ( !shadowWPts.length ) continue;
      const shadowW = new Shadow(shadowWPts);

      for ( const blockingEdge of blockingEdges ) {
        const shadowBW = _shadowForEdge(blockingEdge, evS.shadowProjection);
        if ( !shadowBW ) continue;
        const shadowIX = shadowW.intersectPolygon(shadowBW)[0];
        if ( shadowIX && shadowIX.points.length > 5 ) evS.shadows.push(shadowIX);
      }
    }
  }
}

/**
 * Construct normal edge shadows
 * @param {PolygonShadows} evS
 */
function _constructNormalEdgeShadows(evS) {
  for ( const e of evS.normalEdges ) {
    const shadow = _shadowForEdge(e, evS.shadowProjection);
    if ( !shadow ) continue;
    evS.shadows.push(shadow);
  }
}

/**
 * From point of view of a source (light or vision observer), is the wall underneath the tile?
 * Only source elevation and position, not perspective, taken into account.
 * So if source is above tile and wall is below tile, that counts.
 * @param {PointSource} observer    The light or vision that originates the source
 * @param {Edge} edge               The Edge being considered
 * @param {Tile[]} tiles            Set of tiles; will default to all tiles under the observer
 * @returns {boolean}
 */
function edgeIsUnderneathTile(observer, edge, tiles) {
  if ( !tiles ) {
    const rect = new PIXI.Rectangle(observer.x - 1, observer.y - 1, 2, 2);
    tiles = canvas.tiles.quadtree.getObjects(rect);
  }
  const e = edge.elevationLibGeometry;
  const topE = Math.max(e.a.top, e.b.top);
  const observerE = observer.elevationE;
  for ( const tile of tiles ) {
    const tileE = tile.document?.elevation ?? 0;
    if ( observerE > tileE && topE < tileE ) return true;
  }
  return false;
}

/**
 * Get the maximum top elevation of an edge.
 * @param {Edge} edge
 * @returns {number} Elevation in grid units.
 */
function edgeMaxTopE(edge) {
  const e = edge.elevationLibGeometry;
  return Math.max(e.a.top ?? Number.POSITIVE_INFINITY, e.b.top ?? Number.POSITIVE_INFINITY);
}

/**
 * Get the minimum bottom elevation of an edge.
 * @param {Edge} edge
 * @returns {number} Elevation in grid units.
 */
function edgeMinBottomE(edge) {
  const e = edge.elevationLibGeometry;
  return Math.min(e.a.bottom ?? Number.NEGATIVE_INFINITY, e.b.bottom ?? Number.NEGATIVE_INFINITY);
}

/**
 * @typedef {object} EdgePoints
 * @prop {object} a
 *   - @prop {Point3d} top
 *   - @prop {Point3d} bottom
 * @prop {object} b
 *   - @prop {Point3d} top
 *   - @prop {Point3d} bottom
 */

/**
 * Construct 3d points representing the edge
 * @param {Edge}
 * @returns {EdgePoints}
 */
function edgePointsForEdge(edge, { finite = false } = {}) {
  const e = edge.elevationLibGeometry;

  // Use MAX instead of Number.MAX_SAFE_INTEGER to improve numerical accuracy
  // particularly when converting to/from 2d.
  let MAX = Number.POSITIVE_INFINITY;
  if ( finite ) {
    const numDigits = numPositiveDigits(canvas.dimensions.maxR);
    MAX = CONFIG.GeometryLib.utils.pixelsToGridUnits(Number(`1e0${numDigits}`));
  }

  const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
  const Point3d = CONFIG.GeometryLib.threeD.Point3d;
  const obj = {
    a: {
      top: new Point3d(edge.a.x, edge.a.y, gridUnitsToPixels(e.a.top ?? MAX)),
      bottom: new Point3d(edge.a.x, edge.a.y, gridUnitsToPixels(edge.a.bottom ?? -MAX))
    },
    b: {
      top: new Point3d(edge.b.x, edge.b.y, gridUnitsToPixels(e.b.top ?? MAX)),
      bottom: new Point3d(edge.b.x, edge.b.y, gridUnitsToPixels(edge.b.bottom ?? -MAX))
    }
  };

  // TODO: Remove backwards compatible.
  // Backwards compatibility
  Object.defineProperty(obj, "A", { get: function() { return this.a; } });
  Object.defineProperty(obj, "B", { get: function() { return this.b; } });
  return obj;
}


/**
 * Taken from ClockwisePolygonSweep.prototype._testEdgeInclusion
 * Avoid Wall Height changing this.
 * @param {Edge} edge                     The Edge being considered
 * @param {Record<EdgeTypes, 0|1|2>} edgeTypes Which types of edges are being used? 0=no, 1=maybe, 2=always
 * @param {PIXI.Rectangle} bounds         The overall bounding box
 * @returns {boolean}                     Should the edge be included?
 */
function _testEdgeInclusion(edge, edgeTypes, bounds) {
  const { type, boundaryShapes, useThreshold, wallDirectionMode, externalRadius } = this.config;

  // Only include edges of the appropriate type
  const m = edgeTypes[edge.type];
  if ( !m ) return false;
  if ( m === 2 ) return true;

  // Test for inclusion in the overall bounding box
  if ( !bounds.lineSegmentIntersects(edge.a, edge.b, { inside: true }) ) return false;

  // Specific boundary shapes may impose additional requirements
  for ( const shape of boundaryShapes ) {
    if ( shape._includeEdge && !shape._includeEdge(edge.a, edge.b) ) return false;
  }

  // Ignore edges which do not block this polygon type
  if ( edge[type] === CONST.WALL_SENSE_TYPES.NONE ) return false;

  // Ignore edges which are collinear with the origin
  const side = edge.orientPoint(this.origin);
  if ( !side ) return false;

  // Ignore one-directional walls which are facing away from the origin
  const wdm = PointSourcePolygon.WALL_DIRECTION_MODES;
  if ( edge.direction && (wallDirectionMode !== wdm.BOTH) ) {
    if ( (wallDirectionMode === wdm.NORMAL) === (side === edge.direction) ) return false;
  }

  // Ignore threshold walls which do not satisfy their required proximity
  if ( useThreshold ) return !edge.applyThreshold(type, this.origin, externalRadius);
  return true;
}

/**
 * New method: ClockwiseSweepPolygon.prototype._drawShadows
 * For debugging: draw the shadows for this LOS object using the debug drawing tools.
 */
function _drawShadows(
  { color = Draw.COLORS.gray, width = 1, fill = Draw.COLORS.gray, alpha = 0.5 } = {}) {
  const shadows = this.shadows;
  if ( !shadows || !shadows.length ) return;

  Draw.clearDrawings();
  for ( const shadow of shadows ) shadow.draw({color, width, fill, alpha});
}

PATCHES.POLYGONS.METHODS = { _drawShadows };


export function testWallsForIntersections(origin, destination, walls, mode, type, testTerrain = true) {
  const Point3d = CONFIG.GeometryLib.threeD.Point3d;
  origin = new Point3d(origin.x, origin.y, origin.z);
  destination = new Point3d(destination.x, destination.y, destination.z);

  const collisions = [];
  for ( let wall of walls ) {
    const x = lineSegment3dWallIntersection(origin, destination, wall);
    if ( x ) {
      if ( mode === "any" ) {   // We may be done already
        if ( !testTerrain
          || (type && wall.document[type] === CONST.WALL_SENSE_TYPES.NORMAL)
          || (walls.length > 1) ) return true;
      }
      if ( type ) x.type = wall.document[type];
      x.wall = wall;
      collisions.push(x);
    }
  }
  if ( mode === "any" ) return false;

  // Return all collisions
  if ( mode === "all" ) return collisions;

  // Calculate distance to return the closest collision
  collisions.forEach(p => {
    p.distance2 = Math.pow(p.x - origin.x, 2)
      + Math.pow(p.y - origin.y, 2)
      + Math.pow(p.z - origin.z, 2);
  });

  // Return the closest collision
  collisions.sort((a, b) => a.distance2 - b.distance2);
  if ( testTerrain && collisions[0]?.type === CONST.WALL_SENSE_TYPES.LIMITED ) collisions.shift();

  if ( mode === "sorted" ) return collisions;

  return collisions[0] || null;
}

/**
 * Filter an array of edge points to only include those between the given edge points and source.
 * Use triangle
 * EdgePoints struct: { a: top: Point3d, bottom: Point3d, b: top: Point3d, bottom: Point3d }
 * @param {EdgePoints} wallPoints
 * @param {Edge[]|Set<Edge>|Map<Edge>} edgeArr
 * @param {Point3d} sourceOrigin
 * @returns {wallPoints[]}
 */
function filterPotentialBlockingEdges(edgePoints, edgeArr, sourceOrigin) {
  const viewableTriangle = new PIXI.Polygon([
    sourceOrigin.to2d(),
    edgePoints.A.top.to2d(),
    edgePoints.B.top.to2d()]);

  // Filter by the precise triangle cone.
  const triEdges = [...viewableTriangle.iterateEdges()];
  const blockingEdgePoints = edgeArr.filter(e => {
    const pts = e._elevatedvision.edgePoints;
    if ( viewableTriangle.contains(pts.A.top.x, pts.A.top.y)
      || viewableTriangle.contains(pts.B.top.x, pts.B.top.y) ) return true;
    return triEdges.some(e => foundry.utils.lineSegmentIntersects(pts.A.top, pts.B.top, e.A, e.B));
  });
  return blockingEdgePoints;
}

/**
 * Count the number of positive integer digits.
 * Will return 0 for negative numbers.
 * Will truncate any decimals.
 * https://stackoverflow.com/questions/14879691/get-number-of-digits-with-javascript
 * @param {number}      A positive number
 * @returns {number}    The number of digits before the decimal
 */
function numPositiveDigits(n) { return (Math.log(n) * Math.LOG10E) + 1 | 0; }

/**
 * Top elevation for a region
 * @param {Region} region
 * @returns {EdgeElevation}
 */
function maxRegionElevation(region) {
  const TM = OTHER_MODULES.TERRAIN_MAPPER;
  if ( TM.ACTIVE && region[TM.KEY].isElevated ) return region[TM.KEY].plateauElevation;
  return region.document.elevation.top ?? Number.POSITIVE_INFINITY;
}
