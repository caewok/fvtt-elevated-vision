/* globals
ClockwiseSweepPolygon
*/
"use strict";

import { getSceneSetting, SETTINGS } from "./settings.js";

export const PATCHES = {};
PATCHES.POLYGONS = {};

/**
 * Wrap PIXI.Graphics.drawShape.
 * If passed a polygon with an array of polygons property, use that to draw with holes.
 */
function drawShape(wrapped, shape) {
  if ( !(shape instanceof ClockwiseSweepPolygon) ) return wrapped(shape);

  const { ALGORITHM, TYPES } = SETTINGS.SHADING;
  const shaderAlgorithm = getSceneSetting(ALGORITHM) ?? TYPES.NONE;
  if ( (shaderAlgorithm === TYPES.POLYGONS || shaderAlgorithm === TYPES.WEBGL) && Object.hasOwn(shape, "_evPolygons") ) {
    for ( const poly of shape._evPolygons ) {
      if ( poly.isHole ) {
        this.beginHole();
        this.drawShape(poly);
        this.endHole();
      } else this.drawShape(poly);
    }
  } else {
    return wrapped(shape);
  }

  return this;
}

PATCHES.POLYGONS.WRAPS = { drawShape };
