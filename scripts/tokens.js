/* globals
*/
"use strict";

/*
Adjustments for token visibility.

token cube = visibility test points for a token at bottom and top of token size
 - so if elevation is 10 and token height is 5, test points at 10 and 15

1. Testing visibility of a token
If not visible due to los/fov:
- visible if direct line of sight to token cube
- token may need to be within illuminated area or fov

*/

/**
 * Wrap of Token.prototype.isVisible getter.
 *
 */
function EVTokenIsVisible(wrapped) {
  if ( wrapped() ) return true;

  // Only GM users can see hidden tokens
  const gm = game.user.isGM;
  if ( this.data.hidden && !gm ) return false;

  // If we get here, canvas.sight.testVisibility returned false.
  // Will need to redo the tests in testVisibility with some alterations.
  const visionSources = canvas.sight.sources;
  if ( !visionSources.size ) return game.user.isGM;

  // Determine the array of offset points to test
  const t = Math.min(this.w, this.h) / 4;;
  const offsets = t > 0 ? [[0, 0],[-t,-t],[-t,t],[t,t],[t,-t],[-t,0],[t,0],[0,-t],[0,t]] : [[0,0]];
  const points = offsets.map(o => new PIXI.Point(point.x + o[0], point.y + o[1]));

  // If the point is entirely inside the buffer region, it may be hidden from view
  const d = canvas.dimensions;
  if ( !canvas.sight._inBuffer && !points.some(p => d.sceneRect.contains(p.x, p.y)) ) return false;

  // If we get here, we know:
  // (a) If !requireFOV:
  //     (1) no visionSource LOS contained any of the points and
  //     (2) no lightSource contained any of the points (or the lightSource was inactive)
  // (b) If requireFOV:
  //     (1) no visionSource LOS contained any of the points or the source FOV did not
  //         contain the points and
  //      (2) same as (a)(2).
  const lightSources = canvas.lighting.sources;

}


