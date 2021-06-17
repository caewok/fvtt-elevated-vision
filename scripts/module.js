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


