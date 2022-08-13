/* globals
ClipperLib,
canvas,
CONST,
ClockwiseSweepPolygon
*/
"use strict";

import { log, lineSegment3dWallIntersection } from "./util.js";
import { COLORS, drawSegment, clearDrawings } from "./drawing.js";
import { Shadow } from "./Shadow.js";


/**
 * Wrap ClockwisePolygonSweep.prototype._identifyEdges
 * Get walls that are below the
 * For compatibility with Wall Height and other modules, just re-run quad tree to
 * get walls below the source.
 * Wall Height will have already removed these walls from the LOS, so can just store here.
 */
export function _computeClockwiseSweepPolygon(wrapped) {
  wrapped();
  log("_computeClockwiseSweepPolygon");

  // Ignore lights set with default of positive infinity
  const sourceZ = this.config.source.elevationZ;
  if ( !isFinite(sourceZ) ) return;

  // From ClockwisePolygonSweep.prototype.getWalls
  const bounds = this._defineBoundingBox();
  const {type, boundaryShapes} = this.config;
  const collisionTest = (o, rect) => testShadowWallInclusion(o.t, rect, this.origin, type, boundaryShapes, sourceZ);
  const walls = canvas.walls.quadtree.getObjects(bounds, { collisionTest });
  this.wallsBelowSource = new Set(walls); // Top of edge below source top

  // Construct shadows from the walls below the light source
  this.shadows = [];
  this.combinedShadows = [];
  if ( !this.wallsBelowSource.size ) return;

  // Store each shadow individually
  for ( const w of this.wallsBelowSource ) {
    const shadow = Shadow.constructShadow(w, this.config.source);
    if ( !shadow ) continue;
    this.shadows.push(shadow);
  }

  // Combine the shadows and trim to be within the LOS
  let combined_shadow_path = new ClipperLib.Paths();
  combined_shadow_path.push(this.shadows[0].toClipperPoints());
  if ( this.shadows.length > 1 ) {
    for ( let i = 1; i < this.shadows.length; i += 1 ) {
      const c = new ClipperLib.Clipper();
      const solution = new ClipperLib.Paths();
      c.AddPaths(combined_shadow_path, ClipperLib.PolyType.ptSubject, true);
      c.AddPath(this.shadows[i].toClipperPoints(), ClipperLib.PolyType.ptClip, true);
      c.Execute(ClipperLib.ClipType.ctUnion, solution);
      combined_shadow_path = solution;
    }
  }

  // Third, intersect the shadow(s) with the sweep polygon
  const c = new ClipperLib.Clipper();
  const solution = new ClipperLib.Paths();
  c.AddPath(this.toClipperPoints(), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(combined_shadow_path, ClipperLib.PolyType.ptClip, true);
  c.Execute(ClipperLib.ClipType.ctIntersection, solution);

  this.combinedShadows = solution.map(pts => Shadow.fromClipperPoints(pts));
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
function testShadowWallInclusion(wall, bounds, origin, type, boundaryShapes = [], sourceZ) {
  // Only keep the wall if it is below the source elevation
  if ( sourceZ <= wall.topZ ) return false;

  // First test for inclusion in our overall bounding box
  if ( !bounds.lineSegmentIntersects(wall.A, wall.B, { inside: true }) ) return false;

  // Specific boundary shapes may impose additional requirements
  for ( const shape of boundaryShapes ) {
    if ( shape._includeEdge && !shape._includeEdge(wall.A, wall.B) ) return false;
  }

  // Ignore walls which are nearly collinear with the origin, except for movement
  const side = wall.orientPoint(origin);
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
  { color = COLORS.gray, width = 1, fill = COLORS.gray, alpha = 0.5 } = {}) {
  const shadows = this.shadows;
  if ( !shadows || !shadows.length ) return;

  clearDrawings();
  for ( const shadow of shadows ) {
    shadow.draw({color, width, fill, alpha});
  }
}

/**
 * Check whether a given ray intersects with walls.
 * This version considers rays with a z element
 *
 * @param {PolygonRay} ray            The Ray being tested
 * @param {object} [options={}]       Options which customize how collision is tested
 * @param {string} [options.type=move]        Which collision type to check, a value in CONST.WALL_RESTRICTION_TYPES
 * @param {string} [options.mode=all]         Which type of collisions are returned: any, closest, all
 * @param {boolean} [options.debug=false]     Visualize some debugging data to help understand the collision test
 * @return {boolean|object[]|object}  Whether any collision occurred if mode is "any"
 *                                    An array of collisions, if mode is "all"
 *                                    The closest collision, if mode is "closest"
 */
export function getRayCollisions3d(ray, {type="move", mode="all", debug=false}={}) {
  const origin = ray.A;
  const dest = ray.B;
  origin.z ??= 0;
  dest.z ??= 0;

  log(`getRayCollisions3d ${origin.x},${origin.y} --> ${dest.x},${dest.y}`);

  // Identify Edges
  const collisions = [];
  const walls = canvas.walls.quadtree.getObjects(ray.bounds);
  for ( let wall of walls ) {
    if ( !testWallInclusion(wall, ray.bounds, origin, type) ) continue;
    const x = lineSegment3dWallIntersection(origin, dest, wall);
    if ( x ) {
      if ( mode === "any" ) {   // We may be done already
        if ( (wall.document[type] === CONST.WALL_SENSE_TYPES.NORMAL) || (walls.length > 1) ) return true;
      }
      x.type = wall.document[type];
      collisions.push(x);
    }
  }
  if ( mode === "any" ) return false;

  // Return all collisions
  if ( debug ) ClockwiseSweepPolygon._visualizeCollision(ray, walls, collisions);
  if ( mode === "all" ) return collisions;

  // Calculate distance to return the closest collision
  collisions.forEach(p => {
    p.distance2 = Math.pow(p.x - origin.x, 2)
      + Math.pow(p.y - origin.y, 2)
      + Math.pow(p.z - origin.z, 2);
  });

  // Return the closest collision
  collisions.sort((a, b) => a.distance2 - b.distance2);
  if ( collisions[0].type === CONST.WALL_SENSE_TYPES.LIMITED ) collisions.shift();
  return collisions[0] || null;
}
