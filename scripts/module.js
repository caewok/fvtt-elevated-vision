import { registerPatches } from "./patching.js";
import { orient2d } from "./lib/orient2d.min.js";

export const MODULE_ID = 'elevated-vision';
const FORCE_DEBUG = false; // used for logging before dev mode is set up
export const FORCE_TOKEN_VISION_DEBUG = false;
export const FORCE_FOV_DEBUG = true
export const FORCE_SEGMENT_TYPE_DEBUG = true;


export function log(...args) {
  try {
    const isDebugging = window.DEV?.getPackageDebugValue(MODULE_ID);
    //console.log(MODULE_ID, '|', `isDebugging: ${isDebugging}.`);

    if (FORCE_DEBUG || isDebugging) {
      console.log(MODULE_ID, '|', ...args);
    }
  } catch (e) {}
}

Hooks.once('init', async function() {
  window[MODULE_ID] = { orient2d: orient2d };
});

Hooks.once('ready', async function() {
  registerPatches();
});

// https://github.com/League-of-Foundry-Developers/foundryvtt-devMode
Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(MODULE_ID);
});

Hooks.on('sightRefresh', (obj) => {
  log("sightRefresh", obj);
  
  // called on load (twice?)
});

Hooks.on('updateToken', (scene, data, update, options) => {
  log("updateToken", scene, data, update, options);
  if(data.elevation) {
    log(`Token ${options} elevation updated.`);
    // canvas.tokens.get(options._id).updateSource(); // throws error
    scene._object.updateSource();
  }

});

// Need hook for updating elevation?
// DEBUG | Calling updateToken hook with args: foundry.js:147:15
// Array(4) [ {…}, {…}, {…}, "eXzk9tB2nubjuVL3" ]
// ​
// 0: Object { apps: {}, _sheet: null, _object: {…}, … }
// ​
// 1: Object { elevation: 20, _id: "RiuUZYvERLIZ17ex" }
// ​
// 2: Object { diff: true, render: true }
// ​
// 3: "eXzk9tB2nubjuVL3"
// ​
// length: 4
