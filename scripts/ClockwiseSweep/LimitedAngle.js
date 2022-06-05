/*
Class to represent a limited angle in the ClockwiseSweep, as an extension of PIXI.Polygon.

The angle is essentially two rays shot from a point directly at or behind the origin.
Typically, behind the origin is desired so that the constructed object will include the
origin for the sweep.

Methods include:
- Constructor build method.
- Getting the calculated minimum (rMin) and maximum (rMax) rays.
- Calculating points along the canvas for the polygon.
- Whether a point is contained on or within the limited angle.
- union and intersect the limited angle with a polygon.

Union and intersect use the same algorithm as circle/polygon union and intersect.
The polygon is traced in clockwise direction, noting the intersection points with
the limited angle. Where tracing the limited angle would be the more clockwise (intersect)
or counterclockwise (union) direction, the points of the limited angle between the
two intersections are used. Otherwise, the polygon edge points are used. This is fast,
but requires that the polygon and limited angle both encompass the origin/weighted
center point.

*/

/* globals
Ray,
foundry,
canvas,
PIXI,
ClockwiseSweepPolygon,
*/

"use strict";

import { pixelLineContainsPoint, pointsEqual, pointFromAngle } from "./utilities.js";
import { SimplePolygonEdge } from "./SimplePolygonEdge.js";

export class LimitedAngleSweepPolygon extends PIXI.Polygon {

  // The new constructor is kept the same as PIXI.Polygon and
  // Thus should not be called directly. Use build instead.

  /**
   * @param { PIXI.Point } origin    Origin coordinate of the sweep
   * @param { number } angle         Desired angle of view, in degrees
   * @param { number } rotation      Center of the limited angle line, in degrees
   */
  static build(origin, angle, rotation, { contain_origin = true } = {}) {
    if (contain_origin) { origin = this.offsetOrigin(origin, rotation); }
    const { rMin, rMax } = this.constructLimitedAngleRays(origin, rotation, angle);
    const points = this.getBoundaryPoints(origin, angle, rMin, rMax);

    const poly = new this(points);
    poly.angle = angle;
    poly.rotation = rotation;
    poly.rMin = rMin;
    poly.rMax = rMax;

    // Set certain known polygon properties
    poly._isClosed = true;
    poly._isConvex = angle < 180;
    poly._isClockwise = true;

    return poly;
  }

  /**
   * @type {Point}
   */
  get origin() { return { x: this.points[0], y: this.points[1] }; }

  /**
   * Points between rMin.B and rMax.B along the canvas edge. May be length 0.
   * @type {Number[]}
   */
  get canvas_points() {
    // Points[0,1]: origin x,y
    // Points[2,3]: rMin.B x,y
    // Points[ln-4, ln-3]: rMax.B x,y
    // Points[ln-2, ln-1]: origin x.y
    const ln = this.points.length;
    if (ln < 8) return [];
    return this.points.slice(4, ln - 4);
  }

  /**
   * Point where rMin intersects the canvas edge.
   * @type {Point}
   */
  get rMin_ix() { return { x: this.points[2], y: this.points[3] }; }

  /**
   * Point where rMax intersects the canvas edge.
   * @type {Point}
   */
  get rMax_ix() {
    const ln = this.points.length;
    return { x: this.points[ln - 4], y: this.points[ln - 3] };
  }

  /**
   * Create the two limited rays from the origin extending outwards with angle in-between.
   * @param {Point} origin
   * @param {Number} rotation    In degrees
   * @param {Number} angle       In degrees
   * @return {Object} Returns two rays, { rMin, rMax }
   */
  static constructLimitedAngleRays(origin, rotation, angle) {
    const aMin = Math.normalizeRadians(Math.toRadians(rotation + 90 - (angle / 2)));
    const aMax = aMin + Math.toRadians(angle);

    const rMin = Ray.fromAngle(origin.x, origin.y, aMin, canvas.dimensions.maxR);
    const rMax = Ray.fromAngle(origin.x, origin.y, aMax, canvas.dimensions.maxR);

    return { rMin, rMax };
  }

  /**
   * Move the origin back one pixel to define the start point of the limited angle rays.
   * This ensures the actual origin is contained within the limited angle.
   * @param {Point} origin       Origin coordinate of the sweep.
   * @param {Number} rotation    Center of the limited angle line, in degrees.
   */
  static offsetOrigin(origin, rotation) {
    /* eslint-disable indent */
    const r = pointFromAngle(origin, Math.toRadians(rotation + 90), -1);
    return { x: Math.round(r.x), y: Math.round(r.y) };
  }

  /**
   * Determine where the limited angle rays intersect the canvas edge.
   * (Needed primarily to easily construct a bounding box, but also helpful for
   *  providing edges or a polygon.)
   *
   * To make it easier to use the tracePolygon algorithm, the points are arranged clockwise
   * origin --> rMin.B --> canvas only points -> rMax.B --> origin
   *
   * Two options for how to get intersection:
   * 1. use canvas.dimensions.rect and test _intersectsTop, etc., against rMin/rMax
   * 2. compare angle of rad to rays from each of the four corners
   * Going with (1) because we also may need the points in order and need
   * to know if some corners are included because the angle > 180º.
   * Easier to do by "walk" around canvas edges
   *
   * @param {Point} origin
   * @param {Ray}   rMin    Ray from origin on the left side of the "viewer."
   * @param {Ray}   rMax    Ray from origin on the right side of the "viewer."
   * @return {Points[]} Array of points representing the limited angle polygon.
   */
  static getBoundaryPoints(origin, angle, rMin, rMax) {
    const points = [origin.x, origin.y]; // All the points of the LimitedAngle polygon
    const boundaries = [...canvas.walls.boundaries];
    // Find the boundary that intersects rMin and add intersection point.
    // Store i, representing the boundary index.
    let i;
    const ln = boundaries.length;
    for (i = 0; i < ln; i += 1) {
      const boundary = boundaries[i];
      if (foundry.utils.lineSegmentIntersects(rMin.A, rMin.B, boundary.A, boundary.B)) {
        // LineLineIntersection should be slightly faster and we already confirmed
        // the segments intersect.
        const ix = foundry.utils.lineLineIntersection(rMin.A, rMin.B,
                                                   boundary.A, boundary.B); // eslint-disable indent
        points.push(ix.x, ix.y);
        break;
      }
    }

    // If angle is greater than 180º, we know we need at least one boundary.
    // So add the boundary with which rMin collides first.
    // This avoids the issue whereby an angle at, say 359º, would have rMin and rMax
    // intersect the same canvas border but first we need to add all border corners.
    if (angle > 180) {
      const boundary = boundaries[i];
      points.push(boundary.B.x, boundary.B.y);
      i = i + 1;
    }

    // "Walk" around the canvas edges.
    // Starting with the rMin canvas intersection, check for rMax.
    // If not intersected, than add the corner point.
    for (let j = 0; j < ln; j += 1) {
      const new_i = (i + j) % 4;
      const boundary = boundaries[new_i];
      if (foundry.utils.lineSegmentIntersects(rMax.A, rMax.B, boundary.A, boundary.B)) {
        const ix = foundry.utils.lineLineIntersection(rMax.A, rMax.B, boundary.A, boundary.B);
        points.push(ix.x, ix.y);
        break;

      } else {
        points.push(boundary.B.x, boundary.B.y);
      }
    }

    points.push(origin.x, origin.y);

    return points;
  }

  /**
   * Test whether a point lies within this limited angle.
   * Note: does not consider whether it is outside the canvas boundary.
   * @param {Point} pt   Point to test
   * @return {boolean}   True if the point is on or within the limited angle
   */
  containsPoint(pt) {
    // Keep points within a short distance of the ray, to avoid losing points on the ray
    return ClockwiseSweepPolygon.pointBetweenRays(pt, this.rMin, this.rMax, this.angle)
           || pixelLineContainsPoint(this.rMin, pt, 2)
           || pixelLineContainsPoint(this.rMax, pt, 2);
  }

  /**
   * Return two edges, one for each limited angle
   * @return { SimplePolygonEdge[2] }
   */
  getEdges() {
    return [
      new SimplePolygonEdge(this.origin, this.rMin.B),
      new SimplePolygonEdge(this.origin, this.rMax.B)
    ];
  }

  /**
   * Get the polygon representing the union between this limited angle and a polygon.
   * @param {PIXI.Polygon}  poly
   * @return {PIXI.Polygon}
   */
  unionPolygon(poly) {
    return _combine(poly, this, { clockwise: false });
  }

  /**
   * Get the polygon representing the intersect between this limited angle and a polygon.
   * @param {PIXI.Polygon}  poly
   * @return {PIXI.Polygon}
   */
  intersectPolygon(poly) {
    return _combine(poly, this, { clockwise: true });
  }

  /**
   * Determine whether an edge can be excluded (for purposes of ClockwiseSweep).
   * Edge is considered outside the limited angle if:
   * Angle < 180º (outside the "V" shape):
   *   - endpoints are both to the left (ccw) of rMin or
   *   - endpoints are both to the right (cw) of rMax or
   *   - endpoints are both "behind" the origin
   * Angle > 180º (inside the "V" shape):
   *   - endpoints are both to the left (ccw) of rMin and
   *   - endpoints are both to the right (cw) of rMax and
   *   - endpoints are both "behind" the origin
   * Angle = 180º:
   *   - endpoints are both to the left (ccw) of rMin and
   *   - endpoints are both to the right (cw) of rMax
   *
   * Note: these rules prevent treating as "outside" an edge that crosses
   *       the "V" either in part or in whole.
   *
   * @param {Segment} edge
   * @return {Boolean}
   */
  edgeIsOutside(edge) {
    /* eslint-disable no-multi-spaces */
    const origin = this.origin;
    const minB   = this.rMin.B;
    const maxB   = this.rMax.B;
    const edgeA  = edge.A;
    const edgeB  = edge.B;
    const angle  = this.angle;
    /* eslint-enable no-multi-spaces */

    // Remember, orientation > 0 if CCW (left)
    // The following ignores orientation = 0. In theory, if an endpoint is on
    // rMin or rMax, the edge can be ignored if it otherwise qualifies.
    // But the below code only does that in one direction (angle > 180º).
    // TO-DO: Are endpoints very near the rMin or rMax lines problematic because
    //        this code uses a fast floating point approximation for orient2d?

    const A_left_of_rMin = foundry.utils.orient2dFast(origin, minB, edgeA) > 0;
    const B_left_of_rMin = foundry.utils.orient2dFast(origin, minB, edgeB) > 0;
    const edge_left_of_rMin = A_left_of_rMin && B_left_of_rMin;
    if (angle < 180 && edge_left_of_rMin) return true;

    const A_right_of_rMax = foundry.utils.orient2dFast(origin, maxB, edgeA) < 0;
    const B_right_of_rMax = foundry.utils.orient2dFast(origin, maxB, edgeB) < 0;
    const edge_right_of_rMax = A_right_of_rMax && B_right_of_rMax;
    if (angle < 180 && edge_right_of_rMax) return true;

    if (angle === 180) { return edge_left_of_rMin && edge_right_of_rMax; }

    // If endpoints are "behind" the origin and angle < 180º, we know it is outside
    // This is tricky: what is "behind" the origin varies based on rotation
    // Luckily, we have the rotation.
    // rOrthogonal goes from origin to the right (similar to rMax)
    // test that origin --> orth.B --> pt is clockwise
    const rOrthogonal = this.orthogonalOriginRay();
    const A_behind_origin = foundry.utils.orient2dFast(rOrthogonal.A, rOrthogonal.B, edgeA) < 0;
    const B_behind_origin = foundry.utils.orient2dFast(rOrthogonal.A, rOrthogonal.B, edgeB) < 0;
    const edge_behind_origin = A_behind_origin && B_behind_origin;

    if (angle > 180) {
      return edge_left_of_rMin && edge_right_of_rMax && edge_behind_origin;
    }

    // Angle < 180
    // If one endpoint is behind the origin, then the other can be either left or right
    /* eslint-disable no-multi-spaces */
    const edge_sw_of_origin =    (A_behind_origin && B_left_of_rMin)
                              || (B_behind_origin && A_left_of_rMin);

    const edge_se_of_origin =    (A_behind_origin && B_right_of_rMax)
                              || (B_behind_origin && A_right_of_rMax);

    return    edge_sw_of_origin
           || edge_se_of_origin
           || edge_left_of_rMin
           || edge_right_of_rMax
           || edge_behind_origin;
    /* eslint-enable no-multi-spaces */
  }

  /**
   * Construct a ray orthogonal to the direction the token is facing, based
   * on origin and rotation.
   * See offsetOrigin for a similar calculation reversing the facing direction.
   * Used by edgeIsOutside.
   * @param {Number} d    Length or distance of the desired ray.
   * @return  A ray that extends from origin to the right (direction of rMax)
   *          from the perspective of the token.
   */
  orthogonalOriginRay(d = 100) {
    return Ray.fromAngle(this.origin.x, this.origin.y, Math.toRadians(this.rotation + 180), d);
  }
}

/**
 * Helper for union and intersect methods.
 * @param {PIXI.Polygon} poly
 * @param {LimitedAngle} limitedangle
 * Options:
 * @param {boolean} clockwise  True if the trace should go clockwise at each
 *                             intersection; false to go counterclockwise.
 * @return {PIXI.Polygon}
 * @private
 */
function _combine(poly, limitedAngle, { clockwise = true } = {}) {
  const union = !clockwise;

  if (!poly) { return union ? limitedAngle : null; }
  if (!limitedAngle) { return union ? poly : null; }

  const pts = _tracePolygon(poly, limitedAngle, { clockwise });

  if (pts.length === 0) {
    // If no intersections, then either the polygons do not overlap (return null)
    // or one encompasses the other

    if (polyContainsOther(poly, limitedAngle)) {
      return union ? poly : limitedAngle;
    }

    if (polyContainsOther(limitedAngle, poly)) {
      return union ? limitedAngle : poly;
    }

    return null;
  }

  const new_poly = new PIXI.Polygon(pts);
  new_poly.close();

  // Algorithm always outputs a clockwise polygon
  new_poly._isClockwise = true;
  return new_poly;
}


/**
 * Test whether all the points of other are contained with the polygon.
 * @param {PIXI.Polygon}  poly
 * @param {PIXI.Polygon}  other
 * @return {Boolean}  True if all points of other are within poly.
 */
function polyContainsOther(poly, other) {
  const iter = other.iteratePoints();
  for (const pt of iter) {
    if (!poly.contains(pt.x, pt.y)) return false;
  }
  return true;
}

/**
 * Basically the same algorithm as tracing a polygon with a circle.
 *
 * Trace around a polygon in the clockwise direction. At each intersection with
 * the LimitedAngle, select either the clockwise or counterclockwise direction
 * (based on the option). Return each vertex or intersection point encountered.
 *
 * Mark each time the trace jumps from the polygon to the limitedAngle, or back.
 * Note that this can only happen when one of the two angled lines intersect the
 * polygon.
 * When returning to the polygon, fill in the shape of the limited angle, including
 * any additions made by tracing the canvas edge.
 *
 * @param {PIXI.Circle}   circle
 * @param {PIXI.Polygon}  poly
 * @param {boolean} clockwise   True if the trace should go clockwise at each
 *                              intersection; false to go counterclockwise.
 * @return {number[]} Points array, in format [x0, y0, x1, y1, ...]
 */
function _tracePolygon(poly, limitedAngle, { clockwise = true } = {}) {
  poly.close();
  if (!poly.isClockwise) poly.reverse();

  const rMax = limitedAngle.rMax;
  const rMin = limitedAngle.rMin;

  // Store the starting data
  const ix_data = {
    pts: [],
    clockwise,
    is_tracing_polygon: undefined,
    canvas_points: limitedAngle.canvas_points,
    circled_back: false,
    started_at_rMin: undefined,
    prior_ix: undefined,
    origin: limitedAngle.origin,
    rMin_ix: limitedAngle.rMin_ix,
    rMax_ix: limitedAngle.rMax_ix
  };

  const edges = [...poly.iterateEdges()];
  const ln = edges.length;
  const max_iterations = ln * 2;
  let first_intersecting_edge_idx = -1;
  let circled_back = false;
  let i;
  for (i = 0; i < max_iterations; i += 1) {
    const edge_idx = i % ln;
    const next_edge_idx = (i + 1) % ln;
    const edge = edges[edge_idx];

    // Test each limited angle ray in turn for intersection with this segment.
    const rMax_intersects = foundry.utils.lineSegmentIntersects(edge.A, edge.B, rMax.A, rMax.B);
    const rMin_intersects = foundry.utils.lineSegmentIntersects(edge.A, edge.B, rMin.A, rMin.B);

    if (rMin_intersects || rMax_intersects) {
      // Flag if we are back at the first intersecting edge.
      (edge_idx === first_intersecting_edge_idx) && (circled_back = true); // eslint-disable-line no-unused-expressions

      if (!~first_intersecting_edge_idx) {
        first_intersecting_edge_idx = edge_idx;
        ix_data.is_tracing_polygon = true;
      }
    }

    // Require LimitedAngle to be constructed such that, moving clockwise,
    // origin --> rMin --> canvas --> rMax --> origin
    // For union, walk clockwise and turn counterclockwise at each intersection
    // For intersect, walk clockwise and turn clockwise at each intersection
    if (rMax_intersects && rMin_intersects) {
      // Start with the intersection closest to edge.A
      const ix_min = foundry.utils.lineLineIntersection(edge.A, edge.B, rMin.A, rMin.B);
      const ix_max = foundry.utils.lineLineIntersection(edge.A, edge.B, rMax.A, rMax.B);

      // Unclear if this additional check for null is necessary
      if (!ix_min) {
        ix_max && processRMaxIntersection(ix_max, edges, next_edge_idx, edge, ix_data); // eslint-disable-line no-unused-expressions
      } else if (!ix_max) {
        ix_min && processRMinIntersection(ix_min, edges, next_edge_idx, edge, ix_data); // eslint-disable-line no-unused-expressions
      } else if (pointsEqual(ix_min, ix_max)) {
        // Should only happen at origin
        // From origin, move to rMin
        processRMinIntersection(ix_min, edges, next_edge_idx, edge, ix_data);

      } else {
        const dx_min = ix_min.x - edge.A.x;
        const dy_min = ix_min.y - edge.A.y;
        const dx_max = ix_max.x - edge.A.x;
        const dy_max = ix_max.y - edge.A.y;

        const d2_min = (dx_min * dx_min) + (dy_min * dy_min);
        const d2_max = (dx_max * dx_max) + (dy_max * dy_max);

        if (d2_min < d2_max) {
          processRMinIntersection(ix_min, edges, next_edge_idx, edge, ix_data);
          if (circled_back) { break; }

          processRMaxIntersection(ix_max, edges, next_edge_idx, edge, ix_data);
        } else {
          processRMaxIntersection(ix_max, edges, next_edge_idx, edge, ix_data);
          if (circled_back) { break; }

          processRMinIntersection(ix_min, edges, next_edge_idx, edge, ix_data);
        }
      }

    } else if (rMin_intersects) {
      const ix = foundry.utils.lineLineIntersection(edge.A, edge.B, rMin.A, rMin.B);
      ix && processRMinIntersection(ix, edges, next_edge_idx, edge, ix_data); // eslint-disable-line no-unused-expressions

    } else if (rMax_intersects) {
      const ix = foundry.utils.lineLineIntersection(edge.A, edge.B, rMax.A, rMax.B);
      ix && processRMaxIntersection(ix, edges, next_edge_idx, edge, ix_data); // eslint-disable-line no-unused-expressions
    }

    if (circled_back) { break; } // Back to first intersecting edge

    // Only if not circled back
    if (ix_data.is_tracing_polygon) { ix_data.pts.push(edge.B.x, edge.B.y); }
  }
  if (!circled_back && i >= (max_iterations - 1)) { console.warn(`LimitedAngle trace is at max_iterations ${i}`); }

  return ix_data.pts;
}


/* Intersection options:

1. The polygon is along the canvas border, and it intersects rMax.B or rMin.B.
   a. intersects rMin.B --> follow the polygon
   b. intersects rMax.B --> choose the polygon or rMax based on orientation
2. The polygon intersects somewhere along rMax or rMin.
   -- follow rMin/rMax or polygon based on orientation
3. The polygon intersects at origin (rMax.A/rMin.A)
   -- follow rMin or polygon based on orientation

*/

/**
 * Process an intersection that occurs on the minimum (left) ray.
 * @param {Point}     ix            Intersection point.
 * @param {Segment[]} edges         Array of polygon edges.
 * @param {Number}    next_edge_idx Index of the next edge after edge.
 * @param {Segment}   edge          Edge that intersects the ray.
 * @param {Object}    ix_data       Data tracked in the trace algorithm.
 */
function processRMinIntersection(ix, edges, next_edge_idx, edge, ix_data) {
  const { clockwise, rMin_ix, rMax_ix, origin, canvas_points } = ix_data;
  const was_tracing_polygon = ix_data.is_tracing_polygon;

  if (!ix_data.is_tracing_polygon && ix_data.started_at_rMin) { ix_data.circled_back = true; }

  if (pointsEqual(ix, rMin_ix)) {
    ix_data.is_tracing_polygon = true;
  } else {
    const a = ix;
    const b = pointsEqual(ix, edge.B) ? edges[next_edge_idx].B : edge.B;
    const c = rMin_ix;

    // Orientation < 0: rMin.B is CW from the edge
    // Orientation > 0: rMin.B is CCW from the edge
    let orientation = foundry.utils.orient2dFast(a, b, c);
    if (orientation.almostEqual(0)) { // AlmostEqual is important here, where the edge and rMin are colinear
      // Could be that the edge is in line with the ray and rMin_ix.
      // Particularly likely if angle = 180º
      // Try edge.A --> ix --> rMin_ix
      orientation = foundry.utils.orient2dFast(edge.A, ix, rMin_ix);
      if (!orientation) return; // Stick with the current path
    }

    // Switch to other polygon?
    // If we are tracing one polygon and moving to the other would move
    //   CW/CCW (depending on union/intersect) then move.
    // Note desired orientation flips when we are tracing the limitedAngle instead of the poly
    let change_direction = false;
    change_direction ||= ix_data.is_tracing_polygon
      && ((orientation > 0 && !clockwise) || (orientation < 0 && clockwise));

    change_direction ||= !ix_data.is_tracing_polygon
      && ((orientation < 0 && !clockwise) || (orientation > 0 && clockwise));

    change_direction && (ix_data.is_tracing_polygon = !was_tracing_polygon); // eslint-disable-line no-unused-expressions
  }

  if (!(was_tracing_polygon ^ ix_data.is_tracing_polygon)) return;
  if (was_tracing_polygon && !ix_data.is_tracing_polygon) {
    // We moved from polygon --> limitedAngle
    // Store the intersection and whether this is rMin or rMax
    ix_data.prior_ix = ix;
    ix_data.started_at_rMin = true;
    ix_data.circled_back = false;
    return;
  }

  // We moved from limitedAngle --> polygon
  // Get the points from the previous intersection to the current
  // Options:
  // 1. both previous and current ix are on the same ray: no points to add in between
  // 2. moved from rMax --> origin/rMin.A --> rMin. Add origin point
  // 3. moved from rMin --> rMin.B --> canvas --> rMax.B. Add canvas edge point(s)\
  // 4. both previous and current ix are on the same ray but we circled back around:
  //    need to add all points between. e.g.,
  //    (a) rMax --> origin/rMin.A --> rMin.B --> canvas --> rMax.B
  //    (b) rMin --> rMin.B --> canvas --> rMax.B --> origin/rMin.A
  ix_data.pts.push(ix_data.prior_ix.x, ix_data.prior_ix.y);

  if (ix_data.started_at_rMin) {
    if (ix_data.circled_back) {
      // (4)(b) rMin --> rMin.B --> canvas --> rMax.B --> origin/rMin.A
      if (!pointsEqual(ix, rMin_ix)) { ix_data.pts.push(rMin_ix.x, rMin_ix.y); }
      ix_data.pts.push(...canvas_points);
      ix_data.pts.push(rMax_ix.x, rMax_ix.y);
      ix_data.pts.push(origin.x, origin.y);
    }
    // Otherwise: (1) previous and current ix on the same ray; do nothing

  } else if (!pointsEqual(ix, origin)) { // Started at rMax
    // (2) rMax --> origin/rMin.A --> rMin
    ix_data.pts.push(origin.x, origin.y);
  }

  ix_data.prior_ix = undefined;
  ix_data.circled_back = false;
  ix_data.pts.push(ix.x, ix.y);
}

/**
 * Process an intersection that occurs on the maximum (right) ray.
 * @param {Point}     ix            Intersection point.
 * @param {Segment[]} edges         Array of polygon edges.
 * @param {Number}    next_edge_idx Index of the next edge after edge.
 * @param {Segment}   edge          Edge that intersects the ray.
 * @param {Object}    ix_data       Data tracked in the trace algorithm.
 */
function processRMaxIntersection(ix, edges, next_edge_idx, edge, ix_data) {
  const { clockwise, rMin_ix, rMax_ix, origin, canvas_points } = ix_data;
  const was_tracing_polygon = ix_data.is_tracing_polygon;

  if (!ix_data.is_tracing_polygon && !ix_data.started_at_rMin) { ix_data.circled_back = true; }

  const a = ix;
  const b = pointsEqual(edge.B, ix) ? edges[next_edge_idx].B : edge.B;
  const c = origin;
  let orientation = foundry.utils.orient2dFast(a, b, c);
  if (orientation.almostEqual(0)) { // AlmostEqual is important here, if the edge and rMin are colinear
    // Could be that the edge is in line with the ray and origin.
    // Particularly likely if angle = 180º
    // Try edge.A --> ix --> origin
    orientation = foundry.utils.orient2dFast(edge.A, ix, origin);
    if (!orientation) return; // Stick with the current path
  }

  let change_direction = false;
  change_direction ||= ix_data.is_tracing_polygon
    && ((orientation > 0 && !clockwise) || (orientation < 0 && clockwise));

  change_direction ||= !ix_data.is_tracing_polygon
    && ((orientation < 0 && !clockwise) || (orientation > 0 && clockwise));

  change_direction && (ix_data.is_tracing_polygon = !was_tracing_polygon); // eslint-disable-line no-unused-expressions

  if (!(was_tracing_polygon ^ ix_data.is_tracing_polygon)) return;
  if (was_tracing_polygon && !ix_data.is_tracing_polygon) {
    // We moved from polygon --> limitedAngle
    // store the intersection and whether this is rMin or rMax
    ix_data.prior_ix = ix;
    ix_data.started_at_rMin = false;
    ix_data.circled_back = false;
    return;
  }

  // We moved from limitedAngle --> polygon
  // Get the points from the previous intersection to the current
  // Options:
  // 1. both previous and current ix are on the same ray: no points to add in between
  // 2. moved from rMax --> rMax.A/origin --> rMin.B Add origin point
  // 3. moved from rMin --> rMin.B --> canvas --> rMax.B Add canvas edge point(s)\
  // 4. both previous and current ix are on the same ray but we circled back around:
  //    need to add all points between. e.g.,
  //    (a) rMax --> origin/rMin.A --> rMin.B --> canvas --> rMax.B
  //    (b) rMin --> rMin.B --> canvas --> rMax.B --> origin/rMin.A
  ix_data.pts.push(ix_data.prior_ix.x, ix_data.prior_ix.y);

  if (!ix_data.started_at_rMin) {
    if (ix_data.circled_back) {
      // (4)(a) rMax --> origin/rMin.A --> rMin.B --> canvas --> rMax.B
      if (!pointsEqual(ix, origin)) { ix_data.pts.push(origin.x, origin.y); }
      ix_data.pts.push(rMin_ix.x, rMin_ix.y);
      ix_data.pts.push(...canvas_points);
      ix_data.pts.push(rMax_ix.x, rMax_ix.y);
    }
    // Otherwise (1) previous and current ix on the same ray

  } else { // Started at rMin
    // (3) rMin.B --> canvas --> rMax.B
    if (!pointsEqual(ix, rMin_ix)) {
      ix_data.pts.push(rMin_ix.x, rMin_ix.y);
    }
    ix_data.pts.push(...canvas_points);
    ix_data.pts.push(rMax_ix.x, rMax_ix.y);
  }

  ix_data.prior_ix = undefined;
  ix_data.circled_back = false;

  ix_data.pts.push(ix.x, ix.y);
}
