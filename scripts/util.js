/* globals
game,
PIXI,
foundry,
*/
"use strict";

import { MODULE_ID } from "./const.js";

/**
 * Log message only when debug flag is enabled from DevMode module.
 * @param {Object[]} args  Arguments passed to console.log.
 */
export function log(...args) {
  try {
    const isDebugging = game.modules.get("_dev-mode")?.api?.getPackageDebugValue(MODULE_ID);
    if ( isDebugging ) {
      console.log(MODULE_ID, "|", ...args);
    }
  } catch(e) {
    // Empty
  }
}

/**
 * Get the point on a line AB that forms a perpendicular line to a point C.
 * From https://stackoverflow.com/questions/10301001/perpendicular-on-a-line-segment-from-a-given-point
 * This is basically simplified vector projection: https://en.wikipedia.org/wiki/Vector_projection
 * @param {Point} a
 * @param {Point} b
 * @param {Point} c
 * @return {Point} The point on line AB or null if a,b,c are collinear. Not
 *                 guaranteed to be within the line segment a|b.
 */
export function perpendicularPoint(a, b, c) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dab = Math.pow(dx, 2) + Math.pow(dy, 2);
  if ( !dab ) return null;

  const u = ((c.x - a.x) * dx + (c.y - a.y) * dy) / dab;
  return {
    x: a.x + u * dx,
    y: a.y + u * dy
  }
}

export function distanceBetweenPoints(a, b) {
  return Math.sqrt(distanceSquaredBetweenPoints(a, b));
}

export function distanceSquaredBetweenPoints(a, b) {
  return Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2);
}

/**
 * See https://github.com/mourner/robust-predicates
 * Each Point3d should have {x, y, z} coordinates.
 * @param {Point3d} a
 * @param {Point3d} b
 * @param {Point3d} c
 * @param {Point3d} d
 * @return {number}
 * Returns a positive value if the point d lies above the plane passing through a, b, and c,
 *   meaning that a, b, and c appear in counterclockwise order when viewed from d.
 * Returns a negative value if d lies below the plane.
 * Returns zero if the points are coplanar.
 *
 * The result is also an approximation of six times the signed volume of the tetrahedron
 * defined by the four points.
 */
export function orient3dFast(a, b, c, d) {
  const adx = a.x - d.x;
  const bdx = b.x - d.x;
  const cdx = c.x - d.x;
  const ady = a.y - d.y;
  const bdy = b.y - d.y;
  const cdy = c.y - d.y;
  const adz = a.z - d.z;
  const bdz = b.z - d.z;
  const cdz = c.z - d.z;

  return (adx * ((bdy * cdz) - (bdz * cdy)))
    + (bdx * ((cdy * adz) - (cdz * ady)))
    + (cdx * ((ady * bdz) - (adz * bdy)));
}

/**
 * Quickly test whether the line segment AB intersects with a plane.
 * This method does not determine the point of intersection, for that use lineLineIntersection.
 * Each Point3d should have {x, y, z} coordinates.
 *
 * @param {Point3d} a   The first endpoint of segment AB
 * @param {Point3d} b   The second endpoint of segment AB
 * @param {Point3d} c   The first point defining the plane
 * @param {Point3d} d   The second point defining the plane
 * @param {Point3d} e   The third point defining the plane.
 *                      Optional. Default is for the plane to go up in the z direction.
 *
 * @returns {boolean} Does the line segment intersect the plane?
 * Note that if the segment is part of the plane, this returns false.
 */
export function lineSegment3dPlaneIntersects(a, b, c, d, e = {x: c.x, y: c.y, z: c.z + 1}) {
  // A and b must be on opposite sides.
  // Parallels the 2d case.
  const xa = orient3dFast(a, c, d, e);
  const xb = orient3dFast(b, c, d, e);
  return xa * xb <= 0;
}

/**
 * Quickly test whether the line segment AB intersects with a wall in 3d.
 * Extension of lineSegmentPlaneIntersects where the plane is not infinite.
 * Takes advantage of the fact that 3d walls in Foundry move straight out of the canvas
 * @param {Point3d} a   The first endpoint of segment AB
 * @param {Point3d} b   The second endpoint of segment AB
 * @param {Point3d} c   The first corner of the rectangle
 * @param {Point3d} d   The second corner of the rectangle
 * @param {Point3d} e   The third corner of the rectangle
 * @param {Point3d} f   The fourth corner of the rectangle
 *                      Optional. Default is for the plane to go up in the z direction.
 *
 * @returns {boolean} Does the line segment intersect the rectangle in 3d?
 */
export function lineSegment3dWallIntersects(a, b, wall) {
  // Four corners of the wall
  const c = new PIXI.Point(wall.A.x, wall.A.y, wall.bottom);
  const d = new PIXI.Point(wall.B.x, wall.B.y, wall.bottom);

  // First test if wall and segment intersect from 2d overhead.
  if ( !foundry.utils.lineSegmentIntersects(a, b, c, d) ) { return false; }

  // Second test if segment intersects the wall as a plane
  const e = new PIXI.Point(wall.A.x, wall.A.y, wall.top);
  if ( !lineSegment3dPlaneIntersects(a, b, c, d, e) ) { return false; }

  // All that remains is to test whether the segment passes under or over the wall
  // Construct a plane at the top and bottom of the wall. Again, take advantage of
  // the fact that the wall moves directly up out of the canvas.
  const f = new PIXI.Point(wall.B.x, wall.B.y, wall.top);
  const topP = e;
  topP.x = (e.x === 0 && f.x === 0) ? (e.x + 1) : (e.x + f.x); // Make sure topP is a distinct point
  if ( !lineSegment3dPlaneIntersects(a, b, e, f, topP) ) { return false; }

  const bottomP = c;
  bottomP.x = (c.x === 0 && d.x === 0) ? (c.x + 1) : (c.x + d.x);
  if ( !lineSegment3dPlaneIntersects(a, b, c, d, bottomP) ) { return false; }

  return true;
}


/**
 * Get the intersection of a 3d line with a plane.
 * See https://stackoverflow.com/questions/5666222/3d-line-plane-intersection
 * @param {Point3d} a   First point on the line
 * @param {Point3d} b   Second point on the line
 * @param {Point3d} c   Coordinate point on the plane
 * @param {Point3d} d   Normal vector defining the plane direction (need not be normalized)
 * @return {Point3d|null}
 */
export function linePlane3dIntersection(a, b, c, d, epsilon = 1e-8) {
  const u = sub3dPoints(b, a);
  const dot = dot3dPoints(d, u);
  if ( Math.abs(dot) > epsilon ) {
    // The factor of the point between a -> b (0 - 1)
    // if 'fac' is between (0 - 1) the point intersects with the segment.
    // Otherwise:
    // < 0.0: behind a.
    // > 1.0: infront of b.
    const w = sub3dPoints(a, c);
    const fac = -dot3dPoints(d, w) / dot;
    const uFac = mul3dPoint(u, fac);
    return add3dPoints(a, uFac);
  }

  // The segment is parallel to the plane.
  return null;
}

/**
 * Get the intersection of a 3d line with a wall extended as a plane.
 * See https://stackoverflow.com/questions/5666222/3d-line-plane-intersection
 * @param {Point3d} a   First point on the line
 * @param {Point3d} b   Second point on the line
 * @param {Wall} wall   Wall to intersect
 */
export function lineWall3dIntersection(a, b, wall, epsilon = 1e-8) {
  const x = wall.A.x;
  const y = wall.A.y;
  const c = { x, y, z: 0 };

  // Perpendicular vectors are (-dy, dx) and (dy, -dx)
  const d = { x: -(wall.B.y - y), y: (wall.B.x - x), z: 0 };

  return linePlane3dIntersection(a, b, c, d, epsilon);
}

/**
 * Add two 3d points.
 * @param {Point3d} a
 * @param {Point3d} b
 * @return {Point3d}
 */
function add3dPoints(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/**
 * Subtract two 3d points.
 * @param {Point3d} a
 * @param {Point3d} b
 * @return {Point3d}
 */
function sub3dPoints(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/**
 * Dot product of two 3d points.
 * @param {Point3d} a
 * @param {Point3d} b
 * @return {number}
 */
function dot3dPoints(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

/**
 * Multiple 3d point by scalar.
 * @param {Point3d} a
 * @param {number} f
 * @return {Point3d}
 */
function mul3dPoint(a, f) {
  return { x: a.x * f, y: a.y * f, z: a.z * f };
}

/**
 * Key for 2d points
 */
export function point2dKey(p) {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  return (x << 16) ^ y;
}

/**
 * Key for 3d points
 */
export function point3dKey(p) {
  const z = Math.round(p.z);
  return (BigInt(point2dKey(p)) << 32n) ^ BigInt(z);
}
