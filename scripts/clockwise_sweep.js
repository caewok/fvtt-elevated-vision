/* globals
canvas,
CONST,
Ray
*/
"use strict";

import { log, lineSegment3dWallIntersection, combineBoundaryPolygonWithHoles } from "./util.js";
import { COLORS, clearDrawings } from "./drawing.js";
import { Shadow } from "./Shadow.js";
import { Point3d } from "./Point3d.js";


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
  const sourceZ = this.config.source?.elevationZ;
  if ( !isFinite(sourceZ) ) return;

  // From ClockwisePolygonSweep.prototype.getWalls
  const bounds = this._defineBoundingBox();
  const collisionTest = (o, rect) => this._testShadowWallInclusion(o.t, rect);
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
  if ( !this.shadows.length ) return;

  // Combine the shadows and trim to be within the LOS
  // We want one or more LOS polygons along with non-overlapping holes.
  this.combinedShadows = combineBoundaryPolygonWithHoles(this, this.shadows);
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
  { color = COLORS.gray, width = 1, fill = COLORS.gray, alpha = 0.5 } = {}) {
  const shadows = this.shadows;
  if ( !shadows || !shadows.length ) return;

  clearDrawings();
  for ( const shadow of shadows ) {
    shadow.draw({color, width, fill, alpha});
  }
}

/**
 * 3d version of ClockwiseSweepPolygon.testCollision
 * Test whether a Ray between the origin and destination points would collide with a boundary of this Polygon
 * @param {Point} origin                          An origin point
 * @param {Point} destination                     A destination point
 * @param {PointSourcePolygonConfig} config       The configuration that defines a certain Polygon type
 * @param {string} [config.mode]                  The collision mode to test: "any", "all", or "closest"
 * @returns {boolean|Point3d|Point3d[]|null} The collision result depends on the mode of the test:
 *                                                * any: returns a boolean for whether any collision occurred
 *                                                * all: returns a sorted array of Point3d instances
 *                                                * closest: returns a Point3d instance or null
 */
export function testCollision3dClockwiseSweepPolygon(origin, destination, {mode="all", ...config}={}) {
  const poly = new this();
  const ray = new Ray(origin, destination);
  config.boundaryShapes ||= [];
  config.boundaryShapes.push(ray.bounds);
  poly.initialize(origin, config);
  return poly._testCollision3d(ray, mode);
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
export function _testCollision3dClockwiseSweepPolygon(ray, mode) {
  // Identify candidate edges
  // Don't use this._identifyEdges b/c we need all edges, including those excluded by Wall Height
  const collisionTest = (o, rect) => originalTestWallInclusion.call(this, o.t, rect);
  const walls = canvas.walls.quadtree.getObjects(ray.bounds, { collisionTest });
  return testWallsForIntersections(ray.A, ray.B, walls, mode, this.config.type);
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
