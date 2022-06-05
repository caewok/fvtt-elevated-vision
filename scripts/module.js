import * as drawing from "./drawing.js";
import { ClipperLib } from "./ClockwiseSweep/clipper_unminified.js";
import { EVClockwisePolygonSweep } from "./ClockwiseSweep/ClockwisePolygonSweep.js";


export const MODULE_ID = 'elevated-vision';
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

Hooks.once('init', async function() {
  game.modules.get(MODULE_ID).api = {
    EVClockwiseSweepPolygon,
    ClipperLib,
    drawing
  };
});

Hooks.once('ready', async function() {
  registerPatches();
});

// https://github.com/League-of-Foundry-Developers/foundryvtt-devMode
Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(MODULE_ID);
});

