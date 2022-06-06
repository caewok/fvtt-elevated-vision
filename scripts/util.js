/* globals
*/
"use strict";

import { WALL_HEIGHT_MODULE_ID, MODULE_ID } from "./const.js";

/**
 * @param {AmbientLight} l
 * @return {number}
 */
export function ambientLightElevation(l) {
  return l.document.getFlag(WALL_HEIGHT_MODULE_ID, "rangeTop") ?? 0;
}

/**
 * @param {LightSource} s
 * @return {number}
 */
export function lightSourceElevation(s) { return ambientLightElevation(s.object); }

/**
 * @param {Wall}
 * @return {number}   The topmost point of the wall.
 */
export function wallTop(w) {
  return w.document.getFlag(WALL_HEIGHT_MODULE_ID, "top") ?? Number.POSITIVE_INFINITY;
}

/**
 * @param {Wall}
 * @return {number}   The bottommost point of the wall.
 */
export function wallBottom(w) {
  return w.document.getFlag(WALL_HEIGHT_MODULE_ID, "bottom") ?? Number.NEGATIVE_INFINITY
}

/**
 * Log message only when debug flag is enabled from DevMode module.
 * @param {Object[]} args  Arguments passed to console.log.
 */
export function log(...args) {
  try {
    const isDebugging = game.modules.get("_dev-mode")?.api?.getPackageDebugValue(MODULE_ID);
    if ( isDebugging ) {
      console.log(MODULE_ID, "|", ...args);
    }
  } catch(e) {
    // Empty
  }
}
