import { registerPatches } from "./patching.js";

export const MODULE_ID = 'elevated-vision';
const FORCE_DEBUG = false; // used for logging before dev mode is set up


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

Hooks.on('updateToken', (args) => {
  log("updateToken", args);
  if(args[1].elevation) {
    log(`Token ${args[3]} elevation updated.`);
    canvas.tokens.get(args[3]).updateSource();
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