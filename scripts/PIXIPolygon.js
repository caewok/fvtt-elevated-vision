/* globals
PIXI,
ClipperLib
*/

"use strict";

/* Additions to the PIXI.Polygon class */

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

  // ----------------  CLIPPER LIBRARY METHODS ------------------------
  Object.defineProperty(PIXI.Polygon.prototype, "clipperClip", {
    value: clipperClip,
    writable: true,
    configurable: true
  });
}
