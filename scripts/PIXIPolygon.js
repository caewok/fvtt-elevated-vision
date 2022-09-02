/* globals
PIXI,
ClipperLib
*/

"use strict";

/* Additions to the PIXI.Polygon class */



/**
 * Test if a segment is enclosed by the polygon.
 * @param {Segment} segment      Segment denoted by A and B points.
 * @param {object} [options]  Options that affect the test
 * @param {number} [options.epsilon]      Tolerance when testing for equality
 * @returns {boolean} True is segment is enclosed by the polygon
 */
function isSegmentEnclosed(segment, { epsilon = 1e-08 } = {}) {
  const { A, B } = segment;
  const aInside = this.contains(A.x, A.y);
  const bInside = this.contains(B.x, B.y);

  // If either point outside, then not enclosed
  if ( !aInside || !bInside ) return false;

  // Could still (a) have an endpoint on an edge or (b) be an edge or (c) cross the polygon edge 2+ times.
  const points = this.points;
  const ln = points.length - 2;
  for ( let i = 0; i < ln; i += 2 ) {
    const edgeA = { x: points[i], y: points[i+1] };
    if ( edgeA.x.almostEqual(A.x, epsilon) && edgeA.y.almostEqual(A.y, epsilon) ) return false;
    if ( edgeA.x.almostEqual(B.x, epsilon) && edgeA.y.almostEqual(B.y, epsilon) ) return false;

    const edgeB = { x: points[i+2], y: points[i+3] };
    if ( edgeB.x.almostEqual(A.x, epsilon) && edgeB.y.almostEqual(A.y, epsilon) ) return false;
    if ( edgeB.x.almostEqual(B.x, epsilon) && edgeB.y.almostEqual(B.y, epsilon) ) return false;

    if ( foundry.utils.lineSegmentIntersects(edgeA, edgeB, A, B) ) return false;
  }

  return true;
}


// ---------------- Clipper JS library ---------------------------------------------------

/**
 * Clip a polygon with another.
 * Union, Intersect, diff, x-or
 * @param {PIXI.Polygon} poly   Polygon to clip against this one.
 * @param {object} [options]
 * @param {ClipperLib.ClipType} [options.cliptype]  Type of clipping
 * @return [ClipperLib.Paths[]] Array of Clipper paths
 */
function clipperClip(poly, { cliptype = ClipperLib.ClipType.ctUnion } = {}) {
  const subj = this.toClipperPoints();
  const clip = poly.toClipperPoints();

  const solution = new ClipperLib.Paths();
  const c = new ClipperLib.Clipper();
  c.AddPath(subj, ClipperLib.PolyType.ptSubject, true); // True to be considered closed
  c.AddPath(clip, ClipperLib.PolyType.ptClip, true);
  c.Execute(cliptype, solution);

  return solution;
}


// ----------------  ADD METHODS TO THE PIXI.POLYGON PROTOTYPE --------------------------
export function registerPIXIPolygonMethods() {

  Object.defineProperty(PIXI.Polygon.prototype, "isSegmentEnclosed", {
    value: isSegmentEnclosed,
    writable: true,
    configurable: true
  });

  // ----------------  CLIPPER LIBRARY METHODS ------------------------
  Object.defineProperty(PIXI.Polygon.prototype, "clipperClip", {
    value: clipperClip,
    writable: true,
    configurable: true
  });
}
