/* globals
PIXI,
foundry,
ClipperLib
*/

"use strict";

/* Additions to the PIXI.Polygon class
*/


// ---------------- Clipper JS library ---------------------------------------------------


/**
 * Point contained in polygon
 * Returns 0 if false, -1 if pt is on poly and +1 if pt is in poly.
 */
function clipperContains(pt) {
  const path = this.toClipperCoordinates;
  return ClipperLib.Clipper.PointInPolygon(new ClipperLib.FPoint(pt.x, pt.y), path);
}

/**
 * Are the polygon points oriented clockwise?
 */
function clipperIsClockwise() {
  const path = this.toClipperCoordinates;
  return ClipperLib.Clipper.Orientation(path);
}

/**
 * Get bounding box
 * @return {PIXI.Rectangle}
 */
function clipperBounds() {
  const path = this.toClipperCoordinates();
  const bounds = ClipperLib.JS.BoundsOfPath(path); // Returns ClipperLib.FRect

  return new NormalizedRectangle(
    bounds.left,
    bounds.top,
    bounds.right - bounds.left,
    bounds.bottom - bounds.top);
}

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

/**
 * Area of polygon
 */
function area() {
  const path = this.toClipperPoints;
  return Math.abs(ClipperLib.Clipper.Area(path));
}

// ----------------  ADD METHODS TO THE PIXI.POLYGON PROTOTYPE --------------------------
export function registerPIXIPolygonMethods() {

  // ----------------  CLIPPER LIBRARY METHODS ------------------------
  Object.defineProperty(PIXI.Polygon.prototype, "clipperContains", {
    value: clipperContains,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "clipperIsClockwise", {
    value: clipperIsClockwise,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "clipperBounds", {
    value: clipperBounds,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "clipperClip", {
    value: clipperClip,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "area", {
    value: area,
    writable: true,
    configurable: true
  });
}
