/* globals
canvas,
CONST,
Ray,
PIXI
*/
"use strict";

import { lineSegment3dWallIntersection, combineBoundaryPolygonWithHoles } from "./util.js";
import { Draw } from "./geometry/Draw.js";
import { Shadow, ShadowProjection } from "./geometry/Shadow.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { Plane } from "./geometry/3d/Plane.js";
import { getSetting, SETTINGS } from "./settings.js";

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
  const collisionTest = (o, rect) => this._testShadowWallInclusion(o.t, rect);
  let walls = canvas.walls.quadtree.getObjects(bounds, { collisionTest });

  // Filter out walls that are below ground if the observer is above ground
  // For now, treat the ground as 0.
  // TODO: Measure ground as ground elevation directly below the source?
  // Or measure as ground elevation directly above/under the wall?
  const rect = new PIXI.Rectangle(source.x - 1, source.y - 1, 2, 2);
  const tiles = canvas.tiles.quadtree.getObjects(rect);
  walls = walls.filter(w => !isWallUnderneathTile(source, w, tiles));

  if ( sourceZ >= 0 ) walls = walls.filter(w => w.topZ >= 0);
  else walls = walls.filter(w => w.bottomZ <= 0); // Source below ground; drop tiles above

  this.wallsBelowSource = new Set(walls); // Top of edge below source top

  if ( shaderAlgorithm === SETTINGS.SHADING.TYPES.WEBGL ) return;

  // TODO: Fix below b/c POLYGONS is only algorithm left.

  // Construct shadows from the walls below the light source
  // Only need to construct the combined shadows if using polygons for vision, not shader.
  this.shadows = [];
  this.combinedShadows = [];
  if ( !this.wallsBelowSource.size ) return;

  // Store each shadow individually
  for ( const w of this.wallsBelowSource ) {
    const proj = this.config.source._shadowProjection
      ?? (this.config.source._shadowProjection = new ShadowProjection(new Plane(), this.config.source));

    const shadowPoints = proj.constructShadowPointsForWall(w);
    if ( !shadowPoints.length ) continue;
    this.shadows.push(new Shadow(shadowPoints));
  }
  if ( !this.shadows.length ) return;

  // Combine the shadows and trim to be within the LOS
  // We want one or more LOS polygons along with non-overlapping holes.
  if ( combineShadows ) this.combinedShadows = combineBoundaryPolygonWithHoles(this, this.shadows);
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
 * Taken from ClockwisePolygonSweep.prototype._testWallInclusion but
 * adds test for the wall height.
 * @param {Wall} wall
 * @param {PIXI.Rectangle} bounds
 * @param {Point} origin
 * @param {string} type
 * @param {object[]} boundaryShapes
 * @param {number} sourceZ
 * @returns {Wall[]}
 */
export function _testShadowWallInclusionClockwisePolygonSweep(wall, bounds) {
  // Only keep the wall if it is below the source elevation
  if ( this.config.source.elevationZ <= wall.topZ ) return false;
  return originalTestWallInclusion.call(this, wall, bounds);
}

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
