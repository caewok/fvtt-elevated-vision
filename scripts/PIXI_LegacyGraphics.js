/* globals
ClockwiseSweepPolygon
*/
"use strict";

import { getSceneSetting, Settings } from "./settings.js";

export const PATCHES = {};
PATCHES.POLYGONS = {};

/**
 * Wrap PIXI.Graphics.drawShape.
 * If passed a polygon with an array of polygons property, use that to draw with holes.
 */
function drawShape(wrapped, shape) {
  if ( !(shape instanceof ClockwiseSweepPolygon) ) return wrapped(shape);

  const { ALGORITHM, TYPES } = Settings.KEYS.SHADING;
  const shaderAlgorithm = getSceneSetting(ALGORITHM) ?? TYPES.NONE;
  const hasPolyArray = (shaderAlgorithm === TYPES.POLYGONS || shaderAlgorithm === TYPES.WEBGL) && Object.hasOwn(shape, "_evPolygons");
  if ( !hasPolyArray ) return wrapped(shape);

  // Sort so holes are last.
  const polys = shape._evPolygons;
  polys.sort((a, b) => a.isHole - b.isHole);
  if ( !polys.length || polys[0].isHole ) return this; // All the polys are holes.
  for ( const poly of polys ) {
    if ( poly.isHole ) {
      this.beginHole();
      this.drawShape(poly);
      this.endHole();
    } else this.drawShape(poly);
  }
  return this;
}

PATCHES.POLYGONS.WRAPS = { drawShape };
