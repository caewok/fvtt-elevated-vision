/* globals

*/
"use strict";

import { log } from "./util.js";

/**
 * Wrap ClockwisePolygonSweep.prototype._compute
 * Add shadows after computation is complete
 * For each edge that is below the light source, calculate a shadow polygon.
 * This is the quadrilateral formed by the wall casting a shadow from the higher
 * light on the ground surface.
 * For now, ground surface is assumed to be elevation 0.
 * Store shadow map in wall, keyed by source.
 * Shadows in the sweep are intersected against the sweep polygon.
 */
export function EVCompute(wrapped) {
   wrapped();

  // PIXI.js hates overlapping holes:
  // https://www.html5gamedevs.com/topic/45827-overlapping-holes-in-pixigraphics/
  // Use clipper to combine the shadows into a single non-overlapping set

  // Combining shadows where each shadow is a single path in an array of paths
  // doesn't work b/c those paths are combined in a way to keep each separate
  // sub-path.

  // Instead, union each shadow in turn, then intersect against the polygon sweep.

  const src = this.config.source
  this.close(); // Should already be closed; but just in case.

  // First, construct the shadows and store in walls for debugging and potential
  // future performance improvements. TO-DO: Update shadow for wall only when needed.
  const shadows = [];
  this.edgesBelowSource.forEach(e => {
    const shadow = Shadow.constructShadow(e.wall, src);
    if ( !shadow ) return;

    if ( !e.wall.shadows ) { e.wall.shadows = new Map(); }
    e.wall.shadows.set(src.object.id, shadow);
    shadows.push(shadow);
  });

  if ( !shadows.length ) return;

  // Second, union all shadows as necessary
  let combined_shadow_path = new ClipperLib.Paths();
  combined_shadow_path.push(shadows[0].clipperCoordinates);
  if ( shadows.length > 1 ) {
    for ( let i = 1; i < shadows.length; i += 1 ) {
      const c = new ClipperLib.Clipper();
      const solution = new ClipperLib.Paths();
      c.AddPaths(combined_shadow_path, ClipperLib.PolyType.ptSubject, true);
      c.AddPath(shadows[i].clipperCoordinates, ClipperLib.PolyType.ptClip, true);
      c.Execute(ClipperLib.ClipType.ctUnion, solution);
      combined_shadow_path = solution;
    }
  }

  // Third, intersect the shadow(s) with the sweep polygon
  const c = new ClipperLib.Clipper();
  const solution = new ClipperLib.Paths();
  c.AddPath(this.clipperCoordinates, ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(combined_shadow_path, ClipperLib.PolyType.ptClip, true);
  c.Execute(ClipperLib.ClipType.ctIntersection, solution);

  // Store the resulting combined shadows
  this.shadows = solution.map(pts => Shadow.fromClipperPoints(pts));
}

export function EVDrawShadows({ color = COLORS.gray, width = 1, fill = COLORS.gray, alpha = .5 } = {} ) {
  clearDrawings();
  this.shadows.forEach(s => {
    Shadow.prototype.draw.call(s, {color, width, fill, alpha});
    if ( this.config.debug ) { drawSegment(s.wall, { color: COLORS.black, alpha: .7 }); }
  });
}

/**
 * Override ClockwisePolygonSweep.testWallInclusion
 * Ensure that Wall Height does not remove walls here that will be caught later
 */
export function testWallInclusionClockwiseSweep(wall, origin, type) {
  // Always include interior walls underneath active roof tiles
  if ( (type === "sight") && wall.hasActiveRoof ) return true;

  // Ignore walls that are not blocking for this polygon type
  if ( !wall.data[type] || wall.isOpen ) return false;

  // Ignore walls which are exactly in-line with the origin, except for movement
  const side = wall.orientPoint(origin);
  if ( (type !== "move") && (side === CONST.WALL_DIRECTIONS.BOTH) ) return false;

  // Ignore one-directional walls which are facing away from the origin
  return !wall.data.dir || (side !== wall.data.dir);
}


/**
 * Wrap ClockwisePolygonSweep.prototype._identifyEdges
 * Test edges for elevation once the edges are set.
 * Move into different buckets depending on where the wall is in relation to the source
 * elevation.
 */
export function EVIdentifyEdges(wrapped) {
  wrapped();

  // By convention, treat the Wall Height module rangeTop as the elevation
  // Remove edges that will not block the source when viewed straight-on
  // But store for later processing
  this.edgesBelowSource = new Set(); // Top of edge below source top
  this.edgesAboveSource = new Set(); // Bottom of edge above the source top

  if ( !this.config.source ) return;

  // Ignore lights set with default of positive infinity
  if ( !isFinite(this.config.source.top) ) return;

  const sourceZ = this.config.source.elevationZ ?? 0;
  this.edges.forEach((e, key) => {
    if ( sourceZ > e.topZ ) {
      this.edgesBelowSource.add(e);
      this.edges.delete(key);
    } else if ( sourceZ < e.bottomZ ) {
      this.edgesAboveSource.add(e);
      this.edges.delete(key);
    }
  });
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

  // Identify Edges
  const collisions = [];
  const walls = canvas.walls.quadtree.getObjects(ray.bounds);
  for ( let wall of walls ) {
    if ( !EVTestWallInclusion(wall, origin, type) ) continue;
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
