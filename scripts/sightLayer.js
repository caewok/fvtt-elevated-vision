import { log } from "./module.js";

 /**
   * Restrict the visibility of certain canvas assets (like Tokens or DoorControls) based on the visibility polygon
   * These assets should only be displayed if they are visible given the current player's field of view
   */

// no args, no return
export function evRestrictVisiblity(wrapped, ...args) {
  const res = wrapped(...args)
  log("evRestrictVisiblity", ...args, res);
  // no return
}

 /**
   * Test whether a point on the Canvas is visible based on the current vision and LOS polygons
   *
   * @param {Point} point           The point in space to test, an object with coordinates x and y.
   * @param {number} tolerance      A numeric radial offset which allows for a non-exact match. For example, if
   *                                tolerance is 2 then the test will pass if the point is within 2px of a vision
   *                                polygon.
   * @param {PIXI.DisplayObject} [object]   An optional reference to the object whose visibility is being tested
   *
   * @return {boolean}              Whether the point is currently visible.
   */
   
/*
point: 
x: 1610
​
y: 1890

tolerance: 35

object: looks like a token. e.g., Randal token. (only other token on the map)
// iterates through each object (token) on the map

return: false
*/   
export function evTestVisibility(wrapped, ...args) {
  const res = wrapped(...args)
  log("evTestVisibility", ...args, res);
  return res;
}