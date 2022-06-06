/* globals
PIXI,
foundry,
Ray,
ClockwiseSweepPolygon,
*/

"use strict";

import { distanceSquared } from "./utilities.js";

/*
Intersect or union a polygon with a circle without immediately converting circle to a polygon.

Steps to find the points of a polygon representing the intersect or union:
- For each step below, always move clockwise around the polygon or circle.
- Locate the first intersection point between the polygon and circle.
  (Here, currently done simply by walking the polygon edges, testing each in turn.)
- At each intersection point, there are two valid directions to continue walking
  clockwise: circle or polygon. Select the one that is more clockwise (intersect) or
  more counterclockwise (union) relative to one another.
- If switching from polygon to circle, note the intersection location and continue
  walking clockwise around the polygon until the next intersection point.
- If switching from circle to polygon, add padding points representing the arc of the
  circle from the previous intersection to the current.
- If currently walking the polygon, add each vertex.

Obviously will not work if the polygon is shaped like an "E" and the circle does not
entirely encompass the E---the resulting polygon will have holes.

Hypothesis #1: A circle that shares the weighted center point (or, for sweep, origin)
               with a polygon can be intersect or union without creating holes.

Hypothesis #2: If the circle and polygon both encompass the center point or origin,
               the resulting intersect or union will not have holes.

So long as the conditions for Hypothesis #1 or #2 hold, the polygon intersect or union
can be done using a single walk around the polygon, which can be done relatively quickly.
This speed is increased with the circle, because its dimensions are easily known and thus
instead of walking it, a set of padding points can be quickly calculated and added.

Hypothesis #1 is the typical condition in Foundry for vision sweep,
in which a token has a limited radius circle of vision and a vision polygon is constructed
from a clockwise sweep around the center point of the token.

Exported methods are added to PIXI.Circle in PIXICircle.js.
*/

/**
 * Union of this circle with a polygon.
 * @param {PIXI.Polygon} poly
 * Options:
 * @param {number} density    How many points to use when converting circle arcs to
 *                            a polygon.
 * @return {PIXI.Polygon}
 */
export function circleUnion(poly, { density = 60 } = {}) {
  // When tracing a polygon in the clockwise direction:
  // - Union: pick the counter-clockwise choice at intersections
  // - Intersect: pick the clockwise choice at intersections
  return _combine(poly, this, { clockwise: false, density });
}

/**
 * Intersect of this circle with a polygon.
 * @param {PIXI.Polygon} poly
 * @param {number} density    How many points to use when converting circle arcs to
 *                            a polygon.
 * @return {PIXI.Polygon}
 */
export function circleIntersect(poly, { density = 60 } = {}) {
  const out = _combine(poly, this, { clockwise: true, density });

  // Intersection of two convex polygons is convex
  // Circle is always convex
  // Don't re-run convexity but add parameter if available
  if (poly._isConvex) { out._isConvex = true; }

  return out;
}

/**
 * Helper for union and intersect methods.
 * @param {PIXI.Polygon} poly
 * @param {PIXI.Circle}  circle
 * Options:
 * @param {boolean} clockwise  True if the trace should go clockwise at each
 *                             intersection; false to go counterclockwise.
 * @param {number} density    How many points to use when converting circle arcs to
 *                            a polygon.
 * @return {PIXI.Polygon}
 * @private
 */
function _combine(poly, circle, { clockwise = true, density = 60 } = {}) {
  const union = !clockwise;

  if (!poly) { return union ? circle.toPolygon({ density }) : null; }
  if (!circle) { return union ? poly : null; }

  const pts = _tracePolygon(poly, circle, { clockwise, density });

  if (pts.length === 0) {
    // If no intersections, then either the polygons do not overlap (return null)
    // or one encompasses the other (return the one that encompasses the other)

    if (_circleEncompassesPolygon(circle, poly)) {
      return union ? circle.toPolygon({ density }) : poly;
    }

    // Already know that the circle does not contain any polygon points
    // if circle center is within polygon, polygon must therefore contain the circle.
    // (recall that we already found no intersecting points)
    if (poly.contains(circle.x, circle.y)) {
      return union ? poly : circle.toPolygon({ density });
    }

    return null;
  }

  const new_poly = new PIXI.Polygon(pts);

  // Algorithm always outputs a clockwise polygon
  new_poly._isClockwise = true;
  return new_poly;
}

/**
 * Test whether circle could encompass the polygon
 * Only certain to encompass if you already know that the two do not intersect.
 * Equivalent to SimplePolygon.prototype.encompassesPolygon.
 * @param {PIXI.Circle}   circle
 * @param {PIXI.Polygon}  poly
 * @return {boolean}  True if circle could possibly encompass the polygon.
 */
function _circleEncompassesPolygon(circle, poly) {
  const iter = poly.iteratePoints();
  for (const pt of iter) {
    if (!circle.contains(pt.x, pt.y)) return false;
  }
  return true;
}


/**
 * Trace around a polygon in the clockwise direction. At each intersection with
 * the second polygon, select either the clockwise or counterclockwise direction
 * (based on the option). Return each vertex or intersection point encountered, as
 * well as padding points for the circle.
 *
 * Mark each time the trace jumps from the polygon to the circle, or back.
 * When returning to the polygon, add padding points representing the circle arc
 * from the starting intersection to this ending intersection.
 *
 * @param {PIXI.Circle}   circle
 * @param {PIXI.Polygon}  poly
 * @param {boolean} clockwise   True if the trace should go clockwise at each
 *                              intersection; false to go counterclockwise.
 * @param {number} density      How many points to use when converting circle arcs to
 *                              a polygon.
 * @return {number[]} Points array, in format [x0, y0, x1, y1, ...]
 */
export function _tracePolygon(poly, circle, { clockwise = true, density = 60 } = {}) {
  poly.close();
  if (!poly.isClockwise) poly.reverse();

  const center = { x: circle.x, y: circle.y };
  const radius = circle.radius;

  // Store the starting data
  const ix_data = {
    pts: [],
    clockwise,
    density,
    is_tracing_polygon: false,
    // Things added later
    ix: undefined,
    circle_start: undefined,
    aInside: undefined,
    bInside: undefined
  };

  const edges = [...poly.iterateEdges()];
  const ln = edges.length;
  const max_iterations = ln * 2;
  let first_intersecting_edge_idx = -1;
  let circled_back = false;
  for (let i = 0; i < max_iterations; i += 1) {
    const edge_idx = i % ln;
    const edge = edges[edge_idx];
    const ixs_result = foundry.utils.lineCircleIntersection(edge.A, edge.B, center, radius);

    if (ixs_result.intersections.length) {
      // Flag if we are back at the first intersecting edge.
      if (edge_idx === first_intersecting_edge_idx) { circled_back = true; }

      if (!~first_intersecting_edge_idx) {
        first_intersecting_edge_idx = edge_idx;
        ix_data.is_tracing_polygon = true;
      }

      if (ixs_result.intersections.length === 2) {
        // We must have a outside --> i0 ---> i1 ---> b outside
        ix_data.aInside = ixs_result.aInside;
        ix_data.aInside = ixs_result.aInside;

        // Process the intersections in order from edge.A
        if (distanceSquared(ixs_result.intersections[0], edge.A)
          > distanceSquared(ixs_result.intersections[1], edge.A)) {
          ixs_result.intersections.reverse();
        }

        ix_data.ix = ixs_result.intersections[0];
        processIntersection(circle, edge, ix_data, false);

        // Don't process the second intersection if circled back
        if (circled_back) { break; }

        ix_data.ix = ixs_result.intersections[1];
        processIntersection(circle, edge, ix_data, true);

      } else {

        ix_data.ix = ixs_result.intersections[0];
        ix_data.aInside = ixs_result.aInside;
        ix_data.bInside = ixs_result.bInside;

        processIntersection(circle, edge, ix_data, false);
      }
    }

    if (circled_back) { break; } // Back to first intersecting edge

    if (ix_data.is_tracing_polygon) {
      ix_data.pts.push(edge.B.x, edge.B.y);
    }
  }

  return ix_data.pts;
}

/**
 * Helper to process a single intersection. Used b/c it is possible for a circle to have
 * multiple intersections.
 */
function processIntersection(circle, edge, ix_data, is_second_ix) {
  const { aInside, bInside, clockwise, ix } = ix_data;

  const was_tracing_polygon = ix_data.is_tracing_polygon;
  // Determine whether we are now tracing the segment or the circle
  let is_tracing_polygon = false;
  if (aInside && bInside) {
    console.warn("processIntersection2: Both endpoints are inside the circle!");
  } else if (!aInside && !bInside) {
    // Two intersections
    // We must have a_outside --> i0 --> i1 --> b_outside
    is_tracing_polygon = is_second_ix ? !clockwise : clockwise;
  } else {
    // Either aInside or bInside are true, but not both
    is_tracing_polygon = aInside ? !clockwise : clockwise;
  }

  if (!was_tracing_polygon && is_tracing_polygon) {
    // We have moved from circle --> segment; pad the previous intersection to here.
    if (!ix_data.circle_start) {
      console.warn("processIntersection2: undefined circle start circle --> segment");
    }
    const padding = paddingPoints(ix_data.circle_start, ix, circle, { density: ix_data.density });

    // Convert padding {x, y} to points array
    for (const pt of padding) {
      ix_data.pts.push(pt.x, pt.y);
    }

  } else if (was_tracing_polygon && !is_tracing_polygon) {
    // We have moved from segment --> circle; remember the previous intersection
    ix_data.circle_start = ix;
  }

  // If we were tracing the segment or are now tracing the segment, add intersection
  // Skip if:
  // - we are just continuing the circle; or
  // - the intersection is equal to the line end
  if ((was_tracing_polygon || is_tracing_polygon)
     && !(edge.B.x.almostEqual(ix.x)
     && edge.B.y.almostEqual(ix.y))) {
    ix_data.pts.push(ix.x, ix.y);
  }

  ix_data.is_tracing_polygon = is_tracing_polygon;
}

/**
 * "Pad" by adding points representing a circle arc between fromPoint and toPoint.
 * Relies on ClockwiseSweepPolygon.prototype._getPaddingPoints.
 * @param {Point} fromPt
 * @param {Point} toPoint
 * @param {Point} center    Center of the circle
 * Options:
 * @param {number} density          How much padding (polygon points) to use?
 * @return {number[]} Points array, in format [x0, y0, x1, y1, ...]
 */
function paddingPoints(fromPoint, toPoint, center, { density = 60 } = {}) {
  const obj = { config: { density }};
  const r0 = new Ray(center, fromPoint);
  const r1 = new Ray(center, toPoint);

  return ClockwiseSweepPolygon.prototype._getPaddingPoints.call(obj, r0, r1);
}
