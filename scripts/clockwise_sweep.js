/* globals
canvas,
CONST,
PIXI,
CONFIG,
foundry
*/
"use strict";

import { lineSegment3dWallIntersection, combineBoundaryPolygonWithHoles } from "./util.js";
import { Draw } from "./geometry/Draw.js";
import { Shadow, ShadowProjection } from "./geometry/Shadow.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { Plane } from "./geometry/3d/Plane.js";
import { SETTINGS, getSceneSetting } from "./settings.js";
import { SCENE_GRAPH } from "./WallTracer.js";
import { MODULE_ID } from "./const.js";

/**
 * Wrap ClockwisePolygonSweep.prototype._identifyEdges
 * Get walls that are below the
 * For compatibility with Wall Height and other modules, just re-run quad tree to
 * get walls below the source.
 * Wall Height will have already removed these walls from the LOS, so can just store here.
 */
export function _computeClockwiseSweepPolygon(wrapped) {
  wrapped();

  const shaderAlgorithm = getSceneSetting(SETTINGS.SHADING.ALGORITHM);
  if ( shaderAlgorithm === SETTINGS.SHADING.TYPES.NONE ) return;

  // Ignore lights set with default of positive infinity
  const source = this.config.source;
  const sourceZ = source?.elevationZ;
  if ( !isFinite(sourceZ) ) return;

  /* Ignoring walls
    Limited-height walls removed by Wall Height; shadows must be separate.
    If the limited-height wall is completely above the source, we don't care about it.
    Limited-height walls completely below 0 can be ignored if the source is above 0 and vice-versa
      (b/c ground assumed to block)
  */

  // From ClockwisePolygonSweep.prototype.getWalls
  const bounds = this._defineBoundingBox();
  const collisionTest = (o, rect) => originalTestWallInclusion.call(this, o.t, rect);
  let walls = canvas.walls.quadtree.getObjects(bounds, { collisionTest });

  // Filter out walls that are below ground if the observer is above ground
  // For now, treat the ground as 0.
  // TODO: Measure ground as ground elevation directly below the source?
  // Or measure as ground elevation directly above/under the wall?
  const rect = new PIXI.Rectangle(source.x - 1, source.y - 1, 2, 2);
  const tiles = canvas.tiles.quadtree.getObjects(rect);
  walls = walls.filter(w => w.bottomZ <= sourceZ && !isWallUnderneathTile(source, w, tiles));

  if ( sourceZ >= 0 ) walls = walls.filter(w => w.topZ >= 0);
  else walls = walls.filter(w => w.bottomZ <= 0); // Source below ground; drop tiles above

  /* Terrain wall shadows
    If a limited-height wall is blocking a terrain wall of any height,
    that will not be recorded by the LOS sweep b/c the limited-height wall is removed by Wall Height.

    Non-terrain walls will create shadows that entirely overlap whatever shadow would
    be caused by the terrain wall behind.

    Thus, we only need to care about terrain walls that are behind other terrain walls.

    The shadows of two terrain walls is the intersection of them.
  */


  this._elevatedvision ??= {};
  this._elevatedvision.shadows = [];
//   this._elevatedvision.terrainShadows = []; // Debugging
  this._elevatedvision.combinedShadows = [];
  this._elevatedvision.terrainWalls = new Set();
  this._elevatedvision.heightWalls = new Set();

  walls.forEach(w => {
    if ( isLimitedWallForSource(w, source) ) {
      this._elevatedvision.terrainWalls.add(w);
      return;
    }

    // Only keep limited-height walls. (Infinite-height walls incorporated into LOS polygon.)
    if ( !isFinite(w.bottomZ) && !isFinite(w.topZ) ) return;
    this._elevatedvision.heightWalls.add(w);
  });


  if ( shaderAlgorithm === SETTINGS.SHADING.TYPES.WEBGL ) return;

  // TODO: Fix below b/c POLYGONS is only algorithm left.

  // Construct shadows from the walls below the light source
  // Only need to construct the combined shadows if using polygons for vision, not shader.
  if ( !this._elevatedvision.terrainWalls.size && !this._elevatedvision.heightWalls.size ) return;

  // Store each shadow individually
  source._elevatedvision ??= {};
  source._elevatedvision.ShadowProjection ??= new ShadowProjection(new Plane(), source);
  const proj = source._elevatedvision.ShadowProjection;

  // For each terrain wall, find all other potentially blocking terrain walls.
  // Intersect the shadow for each.
  if ( this._elevatedvision.terrainWalls.size > 1 ) {
    // Temporarily cache the wall points
    this._elevatedvision.terrainWalls.forEach(w => {
      w._elevatedvision ??= {};
      w._elevatedvision.wallPoints = Point3d.fromWall(w, { finite: true });
    });

    const sourceOrigin = Point3d.fromPointSource(this.config.source);

    for ( const w of this._elevatedvision.terrainWalls ) {
      const blocking = filterPotentialBlockingWalls(
        w._elevatedvision.wallPoints,
        this._elevatedvision.terrainWalls,
        sourceOrigin);
      blocking.delete(w);

      if ( blocking.size ) {
        const shadowWPts = proj._constructShadowPointsForWallPoints(w._elevatedvision.wallPoints);
        if ( !shadowWPts.length ) continue;
        const shadowW = new Shadow(shadowWPts);

        for ( const bw of blocking ) {
          const shadowBWPts = proj.constructShadowPointsForWall(bw);
          if ( !shadowBWPts.length ) continue;
          const shadowBW = new Shadow(shadowBWPts);
          const shadowIX = shadowW.intersectPolygon(shadowBW)[0];
          if ( shadowIX && shadowIX.points.length > 5 ) {
            this._elevatedvision.shadows.push(shadowIX);
//             this._elevatedvision.terrainShadows.push(shadowIX);
          }
        }
      }
    }
  }

  for ( const w of this._elevatedvision.heightWalls ) {
    const shadowPoints = proj.constructShadowPointsForWall(w);
    if ( !shadowPoints.length ) continue;
    this._elevatedvision.shadows.push(new Shadow(shadowPoints));
  }
  if ( !this._elevatedvision.shadows.length ) return;

  // Combine the shadows and trim to be within the LOS
  // We want one or more LOS polygons along with non-overlapping holes.
  this._elevatedvision.combinedShadows = combineBoundaryPolygonWithHoles(this, this._elevatedvision.shadows);

}

/**
 * From point of view of a source (light or vision observer), is the wall underneath the tile?
 * Only source elevation and position, not perspective, taken into account.
 * So if source is above tile and wall is below tile, that counts.
 * @param {PointSource} observer
 * @param {Wall} wall
 * @param {Tile[]} tiles    Set of tiles; will default to all tiles under the observer
 * @returns {boolean}
 */
function isWallUnderneathTile(observer, wall, tiles) {
  if ( !tiles ) {
    const rect = new PIXI.Rectangle(observer.x - 1, observer.y - 1, 2, 2);
    tiles = canvas.tiles.quadtree.getObjects(rect);
  }
  const observerZ = observer.elevationZ;
  for ( const tile of tiles ) {
    const tileE = tile.document.flags?.levels?.rangeBottom ?? tile.document?.elevation ?? 0;
    const tileZ = CONFIG.GeometryLib.utils.gridUnitsToPixels(tileE);
    if ( observerZ > tileZ && wall.topZ < tileZ ) return true;
  }
  return false;
}

/**
 * Taken from ClockwisePolygonSweep.prototype._testWallInclusion
 * Avoid Wall Height changing this.
 */
function originalTestWallInclusion(wall, bounds) {
  const {type, boundaryShapes} = this.config;

  // First test for inclusion in our overall bounding box
  if ( !bounds.lineSegmentIntersects(wall.A, wall.B, { inside: true }) ) return false;

  // Specific boundary shapes may impose additional requirements
  for ( const shape of boundaryShapes ) {
    if ( shape._includeEdge && !shape._includeEdge(wall.A, wall.B) ) return false;
  }

  // Ignore walls which are nearly collinear with the origin, except for movement
  const side = wall.orientPoint(this.origin);
  if ( (type !== "move") && !side ) return false;

  // Always include interior walls underneath active roof tiles
  if ( (type === "sight") && wall.hasActiveRoof ) return true;

  // Otherwise, ignore walls that are not blocking for this polygon type
  else if ( !wall.document[type] || wall.isOpen ) return false;

  // Ignore one-directional walls which are facing away from the origin
  return !wall.document.dir || (side !== wall.document.dir);
}

/**
 * For debugging: draw the shadows for this LOS object using the debug drawing tools.
 */
export function _drawShadowsClockwiseSweepPolygon(
  { color = Draw.COLORS.gray, width = 1, fill = Draw.COLORS.gray, alpha = 0.5 } = {}) {
  const shadows = this.shadows;
  if ( !shadows || !shadows.length ) return;

  Draw.clearDrawings();
  for ( const shadow of shadows ) {
    shadow.draw({color, width, fill, alpha});
  }
}

export function testWallsForIntersections(origin, destination, walls, mode, type) {
  origin = new Point3d(origin.x, origin.y, origin.z);
  destination = new Point3d(destination.x, destination.y, destination.z);

  const collisions = [];
  for ( let wall of walls ) {
    const x = lineSegment3dWallIntersection(origin, destination, wall);
    if ( x ) {
      if ( mode === "any" ) {   // We may be done already
        if ( (type && wall.document[type] === CONST.WALL_SENSE_TYPES.NORMAL) || (walls.length > 1) ) return true;
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
  if ( collisions[0]?.type === CONST.WALL_SENSE_TYPES.LIMITED ) collisions.shift();

  if ( mode === "sorted" ) return collisions;

  return collisions[0] || null;
}

/**
 * Determine if the wall is restricted for the given source.
 * @param {Wall} wall
 * @param {PointSource} source
 * @returns {boolean} True if limited
 */
function isLimitedWallForSource(wall, source) {
  let type;
  switch ( source.constructor.name ) {
    case "LightSource":
      type = "light";
      break;

    case "MovementSource":
      type = "move";
      break;

    case "SoundSource":
      type = "sound";
      break;

    case "VisionSource":
      type = "sight";
      break;

    default: return false;
  }

  return wall.document[type] === CONST.WALL_SENSE_TYPES.LIMITED;
}

/**
 * Filter an array of wall points to only include those between the given wall points and source.
 * Use triangle
 * WallPoints struct: { A: top: Point3d, bottom: Point3d, B: top: Point3d, bottom: Point3d }, wall
 * @param {WallPoints} wallPoints
 * @param {Wall[]|Set<Wall>|Map<Wall>} wallPointsArr
 * @param {Point3d} sourceOrigin
 * @returns {wallPoints[]}
 */
function filterPotentialBlockingWalls(wallPoints, wallArr, sourceOrigin) {
  const viewableTriangle = new PIXI.Polygon([
    sourceOrigin.to2d(),
    wallPoints.A.top.to2d(),
    wallPoints.B.top.to2d()]);

  // Filter by the precise triangle cone.
  const edges = [...viewableTriangle.iterateEdges()];
  const blockingWallPoints = wallArr.filter(w => {
    const pts = w._elevatedvision.wallPoints;
    if ( viewableTriangle.contains(pts.A.top.x, pts.A.top.y)
      || viewableTriangle.contains(pts.B.top.x, pts.B.top.y) ) return true;
    return edges.some(e => foundry.utils.lineSegmentIntersects(pts.A.top, pts.B.top, e.A, e.B));
  });
  return blockingWallPoints;
}

// ----- Wall Tracing Enhancements to Sweep ----- //
/**
 * Wrap ClockwiseSweepPolygon.prototype.initialize.
 * Determine if the origin is enclosed by interior boundary polygon and add as a containing shape.
 * @param {Function} wrapper
 * @param {Point} origin
 * @param {object} config
 */
export function initializeClockwiseSweepPolygon(wrapper, origin, config) {
  const sourceOrigin = config.source ? Point3d.fromPointSource(config.source) : new Point3d(origin.x, origin.y, 0);
  const encompassingPolygon = SCENE_GRAPH.encompassingPolygon(sourceOrigin, config.type);
  if ( encompassingPolygon ) {
    config.boundaryShapes ||= [];
    config.boundaryShapes.push(encompassingPolygon);
  }
  wrapper(origin, config);
}
