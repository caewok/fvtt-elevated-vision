/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI,
PointSourcePolygon
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { Shadow, ShadowProjection } from "./geometry/Shadow.js";
import { combineBoundaryPolygonWithHoles } from "./util.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { Plane } from "./geometry/3d/Plane.js";

// Construct polygon shadows corresponding to walls for a given source.
// Related to the sweep but not dependent on it.

export function polygonShadowsRenderedPointSource(sweep) {
  let sourceZ = this.elevationZ;
  if ( !isFinite(sourceZ) ) sourceZ = 1e06;

  const bounds = sweep.bounds();
  const collisionTest = (o, rect) => originalTestWallInclusion.call(sweep, o.t, rect);
  let walls = canvas.walls.quadtree.getObjects(bounds, { collisionTest });

  /* Ignoring walls
    Limited-height walls removed by Wall Height; shadows must be separate.
    If the limited-height wall is completely above the source, we don't care about it.
    Limited-height walls completely below 0 can be ignored if the source is above 0 and vice-versa
      (b/c ground assumed to block)
  */

  const rect = new PIXI.Rectangle(this.x - 1, this.y - 1, 2, 2);
  const tiles = canvas.tiles.quadtree.getObjects(rect);
  walls = walls.filter(w => w.bottomZ <= sourceZ && !isWallUnderneathTile(this, w, tiles));
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

  const ev = this[MODULE_ID] ??= {};
  ev.polygonShadows = {
    shadows: [],
    combined: [],
    terrainWalls: new Set(),
    normalWalls: new Set()
  };
  const sourceType = this.constructor.sourceType;
  walls.forEach(w => {
    if ( w.document[sourceType] === CONST.WALL_SENSE_TYPES.LIMITED ) ev.terrainWalls.add(w);
    else ev.normalWalls.add(w);
  });
  if ( !this._elevatedvision.terrainWalls.size && !this._elevatedvision.normalWalls.size) return;

  // Store each shadow individually

  // For each terrain wall, find all other potentially blocking terrain walls.
  // Intersect the shadow for each.
  const proj = new ShadowProjection(new Plane(), this);
  if ( ev.terrainWalls.size > 1 ) {
    // Temporarily cache the wall points
    ev.terrainWalls.forEach(w => {
      w._elevatedvision ??= {};
      w._elevatedvision.wallPoints = Point3d.fromWall(w, { finite: true });
    });

    const sourceOrigin = Point3d.fromPointSource(this.config.source);

    for ( const w of ev.terrainWalls ) {
      const blocking = filterPotentialBlockingWalls(
        w._elevatedvision.wallPoints,
        ev.terrainWalls,
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
          if ( shadowIX && shadowIX.points.length > 5 ) ev.shadows.push(shadowIX);
        }
      }
    }
  }

  // Now process all the normal walls.
  for ( const w of ev.normalWalls ) {
    const shadowPoints = proj.constructShadowPointsForWall(w);
    if ( !shadowPoints.length ) continue;
    ev.shadows.push(new Shadow(shadowPoints));
  }

  if ( !ev.shadows.length ) return;

  // Combine the shadows and trim to be within the LOS
  // We want one or more LOS polygons along with non-overlapping holes.
  ev.combinedShadows = combineBoundaryPolygonWithHoles(sweep, ev.shadows);
}

/**
 * Taken from ClockwisePolygonSweep.prototype._testWallInclusion
 * Avoid Wall Height changing this.
 */
function originalTestWallInclusion(wall, bounds) {
  const { type, boundaryShapes, useThreshold, wallDirectionMode, externalRadius } = this.config;

  // First test for inclusion in our overall bounding box
  if ( !bounds.lineSegmentIntersects(wall.A, wall.B, { inside: true }) ) return false;

  // Specific boundary shapes may impose additional requirements
  for ( const shape of boundaryShapes ) {
    if ( shape._includeEdge && !shape._includeEdge(wall.A, wall.B) ) return false;
  }

  // Ignore walls which are nearly collinear with the origin, except for movement
  const side = wall.orientPoint(this.origin);
  if ( !side ) return false;

  // Always include interior walls underneath active roof tiles
  if ( (type === "sight") && wall.hasActiveRoof ) return true;

  // Otherwise, ignore walls that are not blocking for this polygon type
  else if ( !wall.document[type] || wall.isOpen ) return false;

  // Ignore one-directional walls which are facing away from the origin
  const wdm = PointSourcePolygon.WALL_DIRECTION_MODES;
  if ( wall.document.dir && (wallDirectionMode !== wdm.BOTH) ) {
    if ( (wallDirectionMode === wdm.NORMAL) === (side === wall.document.dir) ) return false;
  }

  // Condition walls on whether their threshold proximity is met
  if ( useThreshold ) return !wall.applyThreshold(type, this.origin, externalRadius);
  return true;
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
