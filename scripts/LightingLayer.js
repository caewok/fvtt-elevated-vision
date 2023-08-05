/* globals
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */


// Management of mouse events, namely the scroll wheel.
export const PATCHES = {};
PATCHES.WEBGL = {};

// ---- NOTE: WebGL Wraps ----- //

/**
 * Wrap LightingLayer.prototype._onWheel
 * If hovering over a directional light, adjust the elevation angle
 */
function _onMouseWheel(wrapped, event) {
  const light = this.hover;
  if ( !light || !light.source.isDirectional ) return wrapped(event);

  // Determine the increment change in elevation angle from event data
  let snap = Math.toRadians(event.shiftKey ? 0.1 : 1);
  let delta = snap * Math.sign(event.delta);

  console.debug(`Mouse wheel: updating elevationAngle to ${light.source.elevationAngle} + ${delta}`);

}

PATCHES.WEBGL.MIXES = { _onMouseWheel };
