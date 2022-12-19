/* globals
canvas,
CONST,
PIXI,
CONFIG
*/
"use strict";

import { lineSegment3dWallIntersection, combineBoundaryPolygonWithHoles } from "./util.js";
import { Draw } from "./geometry/Draw.js";
import { Shadow, ShadowProjection } from "./geometry/Shadow.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { Plane } from "./geometry/3d/Plane.js";
import { getSetting, SETTINGS } from "./settings.js";
import { isLimitedWallForSource, replaceTerrainWall } from "./terrain_walls.js";

/**
 * Wrap ClockwisePolygonSweep.prototype._identifyEdges
 * Get walls that are below the
 * For compatibility with Wall Height and other modules, just re-run quad tree to
 * get walls below the source.
 * Wall Height will have already removed these walls from the LOS, so can just store here.
 */
export function _computeClockwiseSweepPolygon(wrapped) {
  wrapped();

  const shaderAlgorithm = getSetting(SETTINGS.SHADING.ALGORITHM);
  if ( shaderAlgorithm === SETTINGS.SHADING.TYPES.NONE ) return;

  // Ignore lights set with default of positive infinity
  const source = this.config.source;
  const sourceZ = source?.elevationZ;
  if ( !isFinite(sourceZ) ) return;

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

  /* Ignoring walls
    Limited-height walls removed by Wall Height; shadows must be separate.
    If the limited-height wall is completely above the source, we don't care about it.
    Limited-height walls completely below 0 can be ignored if the source is above 0 and vice-versa
      (b/c ground assumed to block)
  */


  /* Terrain wall shadows
    If a limited-height wall is blocking a terrain wall of any height,
    that will not be recorded by the LOS sweep b/c the limited-height wall is removed by Wall Height.

    Non-terrain walls will create shadows that entirely overlap whatever shadow would
    be caused by the terrain wall behind.

    Thus, we only need to care about terrain walls that are behind other terrain walls.
    For those, we need to find the portion of the terrain wall blocked by the other from
    point of view of the source.

    Unfortunately, in 3d, the resulting smaller blocked terrain wall can have 3–8 points,
    depending on how the shadow trapezoid from the front wall intersects the back wall.
    It may also intersect only at an edge or corner, causing the terrain wall to
    degenerate to 1–2 points. Degenerate cases should be caught and removed.

    For WebGL, we will compute shadows from walls differently. We only need to know what
    terrain walls are potentially blocking or shadow-causing.
  */

  this._elevatedvision ??= {};
  this._elevatedvision.shadows = [];
  this._elevatedvision.combinedShadows = [];

  const terrainWallPointsArr = this._elevatedvision.terrainWallPointsArr = [];
  const heightWallPointsArr = this._elevatedvision.heightWallPointsArr = [];
  walls.forEach(w => {
    const isTerrain = isLimitedWallForSource(w, source);

    // Only keep limited-height walls. (Infinite-height walls incorporated into LOS polygon.)
    if ( !isTerrain && !isFinite(w.bottomZ) && !isFinite(w.topZ) ) return;

    const ptsArr = isTerrain ? terrainWallPointsArr : heightWallPointsArr;
    const pts = Point3d.fromWall(w, { finite: true });
    pts.wall = w;
    ptsArr.push(pts);
  });

  this._elevatedvision.wallsBelowSource = new Set(walls); // Top of edge below source top

  if ( shaderAlgorithm === SETTINGS.SHADING.TYPES.WEBGL ) return;

  const blockedTerrainWallPointsArr = this._elevatedvision.blockedTerrainWallPointsArr = [];
  for ( const terrainWallPoints of terrainWallPointsArr ) {
    const ptsArr = replaceTerrainWall(terrainWallPoints, terrainWallPointsArr, source);
    if ( !ptsArr.length ) continue;

    for ( const pts of ptsArr ) {
      // At least one point must be below the source and above 0 if source is above 0
      const keepPoints = pts.some(pt => pt.z < sourceZ) && sourceZ > 0
        ? pts.some(pt => pt.z > 0)
        : pts.some(pt => pt.z < 0);

      if ( keepPoints ) blockedTerrainWallPointsArr.push(pts);
    }
  }

  // Add in the height wall points
  this._elevatedvision.wallPointArrays = blockedTerrainWallPointsArr;
  for ( const heightWallPts of heightWallPointsArr ) {
    const out = [heightWallPts.A.top, heightWallPts.B.top, heightWallPts.B.bottom, heightWallPts.A.bottom];
    out.wall = heightWallPts.wall;
    this._elevatedvision.wallPointArrays.push(out);
  }

  if ( !this._elevatedvision.wallPointArrays.length ) return;

  // Construct shadows from the walls below the light source
  // Store each shadow individually
  this.config.source._elevatedvision ??= {};
  this.config.source._elevatedvision.ShadowProjection ??= new ShadowProjection(new Plane(), this.config.source);
  const proj = this.config.source._elevatedvision.ShadowProjection;

  for ( const wallPointsArr of this._elevatedvision.wallPointArrays ) {
    // Convert to 2d points; we can simply drop z b/c we are projecting to z=0 plane.
    const shadowPoints = proj._shadowPointsForPoints(wallPointsArr).map(pt => pt.to2d());
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
  const shadows = this._elevatedvision.shadows;
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
