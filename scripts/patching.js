/* globals
canvas,
CONFIG,
GlobalLightSource,
Hooks,
libWrapper
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Patches

import { MODULE_ID } from "./const.js";
import { getSetting, getSceneSetting, SETTINGS } from "./settings.js";
import { DirectionalLightSource } from "./DirectionalLightSource.js";

import { PATCHES as PATCHES_AdaptiveLightingShader } from "./glsl/AdaptiveLightingShader.js";
import { PATCHES as PATCHES_AmbientLight } from "./AmbientLight.js";
import { PATCHES as PATCHES_AmbientSound } from "./AmbientSound.js";
import { PATCHES as PATCHES_Canvas } from "./Canvas.js";
import { PATCHES as PATCHES_CanvasVisibility } from "./CanvasVisibility.js";
import { PATCHES as PATCHES_ClockwiseSweepPolygon } from "./ClockwiseSweepPolygon.js";
import { PATCHES as PATCHES_PIXI_LegacyGraphics } from "./PIXI_LegacyGraphics.js";
import { PATCHES as PATCHES_GlobalLightSource } from "./GlobalLightSource.js";
import { PATCHES as PATCHES_LightSource } from "./LightSource.js";
import { PATCHES as PATCHES_RenderedPointSource } from "./RenderedPointSource.js";
import { PATCHES as PATCHES_Tile } from "./Tile.js";
import { PATCHES as PATCHES_VisionSource } from "./VisionSource.js";
import { PATCHES as PATCHES_Wall } from "./Wall.js";

import {
  PATCHES_DetectionMode,
  PATCHES_DetectionModeBasicSight,
  PATCHES_DetectionModeTremor } from "./detection_modes.js";

import {
  PATCHES_AmbientLightConfig,
  PATCHES_AmbientSoundConfig,
  PATCHES_TileConfig } from "./render_configs.js";

import { PATCHES_Token, PATCHES_ActiveEffect } from "./Token.js";


/**
 * Groupings:
 * - BASIC        Always in effect
 * - POLYGON      When Polygon shadow setting is selected
 * - WEBGL        When WebGL shadow setting is selected
 * - SWEEP        When Sweep enhancement setting is selected
 * - VISIBILITY   When EV is responsibility for testing visibility
 *
 * Patching options:
 * - WRAPS
 * - OVERRIDES
 * - METHODS
 * - GETTERS
 * - STATIC_WRAPS
 */
export const PATCHES = {
  ActiveEffect: PATCHES_ActiveEffect,
  AdaptiveLightingShader: PATCHES_AdaptiveLightingShader,
  AmbientLight: PATCHES_AmbientLight,
  AmbientLightConfig: PATCHES_AmbientLightConfig,
  AmbientSound: PATCHES_AmbientSound,
  AmbientSoundConfig: PATCHES_AmbientSoundConfig,
  Canvas: PATCHES_Canvas,
  CanvasVisibility: PATCHES_CanvasVisibility,
  ClockwiseSweepPolygon: PATCHES_ClockwiseSweepPolygon,
  DetectionMode: PATCHES_DetectionMode,
  DetectionModeBasicSight: PATCHES_DetectionModeBasicSight,
  DetectionModeTremor: PATCHES_DetectionModeTremor,
  GlobalLightSource: PATCHES_GlobalLightSource,
  LightSource: PATCHES_LightSource,
  "PIXI.LegacyGraphics": PATCHES_PIXI_LegacyGraphics,
  RenderedPointSource: PATCHES_RenderedPointSource,
  Tile: PATCHES_Tile,
  TileConfig: PATCHES_TileConfig,
  Token: PATCHES_Token,
  VisionSource: PATCHES_VisionSource,
  Wall: PATCHES_Wall
};


/**
 * Helper to wrap methods.
 * @param {string} method       Method to wrap
 * @param {function} fn         Function to use for the wrap
 * @param {object} [options]    Options passed to libWrapper.register. E.g., { perf_mode: libWrapper.PERF_FAST}
 * @returns {number} libWrapper ID
 */
function wrap(method, fn, options = {}) {
  return libWrapper.register(MODULE_ID, method, fn, libWrapper.WRAPPER, options);
}

// Currently unused
// function mixed(method, fn, options = {}) {
//   return libWrapper.register(MODULE_ID, method, fn, libWrapper.MIXED, options);
// }

function override(method, fn, options = {}) {
  return libWrapper.register(MODULE_ID, method, fn, libWrapper.OVERRIDE, options);
}

/**
 * Helper to add a method or a getter to a class.
 * @param {class} cl      Either Class.prototype or Class
 * @param {string} name   Name of the method
 * @param {function} fn   Function to use for the method
 * @param {object} [opts] Optional parameters
 * @param {boolean} [opts.getter]     True if the property should be made a getter.
 * @param {boolean} [opts.optional]   True if the getter should not be set if it already exists.
 * @returns {undefined|string} Either undefined if the getter already exists or the cl.prototype.name.
 */
function addClassMethod(cl, name, fn, { getter = false, optional = false } = {}) {
  if ( optional && Object.hasOwn(cl, name) ) return undefined;
  const descriptor = { configurable: true };
  if ( getter ) descriptor.get = fn;
  else {
    descriptor.writable = true;
    descriptor.value = fn;
  }
  Object.defineProperty(cl, name, descriptor);

  const prototypeName = cl.constructor?.name;
  return `${prototypeName ?? cl.name }.${prototypeName ? "prototype." : ""}${name}`; // eslint-disable-line template-curly-spacing
}


/**
 * Wrapper to add a hook, b/c calling Hooks.on directly with a decorator does not work.
 */
function addHook(hookName, hookFn) { return Hooks.on(hookName, hookFn); }

// ----- NOTE: Track libWrapper patches, method additions, and hooks ----- //
/**
 * Decorator to register and record a patch, method, or hook.
 * @param {function} fn   A registration function that returns an id. E.g., libWrapper or Hooks.on.
 * @param {Map} map       The map in which to store the id along with the arguments used when registering.
 * @returns {number} The id
 */
function regDec(fn, map) {
  return function() {
    const id = fn.apply(this, arguments);
    map.set(id, arguments);
    return id;
  };
}

/**
 * Deregister shading wrappers.
 * Used when switching shadow algorithms. Deregister all, then re-register needed wrappers.
 */
function deregisterPatches(map) {
  map.forEach((_args, id) => libWrapper.unregister(MODULE_ID, id, false));
  map.clear();
}

function deregisterHooks(map) {
  map.forEach((args, id) => {
    const hookName = args[0];
    Hooks.off(hookName, id);
  });
  map.clear();
}

function deregisterMethods(map) {
  map.forEach((args, _id) => {
    const cl = args[0];
    const name = args[1];
    delete cl[name];
  });
  map.clear();
}

/**
 * Register all of a given group of patches.
 */
function registerGroup(groupName) {
  for ( const className of Object.keys(PATCHES) ) registerGroupForClass(className, groupName);
}

/**
 * For a given group of patches, register all of them.
 */
function registerGroupForClass(className, groupName) {
  const grp = PATCHES[className][groupName];
  if ( !grp ) return;
  const {
    WRAPS,
    OVERRIDES,
    METHODS,
    GETTERS,
    HOOKS,
    STATIC_WRAPS,
    STATIC_METHODS } = grp;
  registerWraps(WRAPS, groupName, className);
  registerWraps(OVERRIDES, groupName, className, { override: true });
  registerWraps(STATIC_WRAPS, groupName, className, { prototype: false });
  registerMethods(METHODS, groupName, className);
  registerMethods(STATIC_METHODS, groupName, className, { prototype: false });
  registerMethods(GETTERS, groupName, className, { getter: true});
  registerHooks(HOOKS, groupName);
}

function deregisterGroup(groupName) {
  const regObj = REG_TRACKER[groupName];
  deregisterPatches(regObj.PATCHES);
  deregisterMethods(regObj.METHODS);
  deregisterHooks(regObj.HOOKS);
}

function registerWraps(wraps, groupName, className, { prototype = true, override = false } = {}) {
  if ( !wraps ) return;
  className = lookupByClassName(className, { returnPathString: true });
  if ( prototype ) className = `${className}.prototype`;
  const wrapFn = override ? "regOverride" : "regWrap";
  for ( const [name, fn] of Object.entries(wraps) ) {
    const methodName = `${className}.${name}`;
    REG_TRACKER[groupName][wrapFn](methodName, fn, { perf_mode: libWrapper.PERF_FAST });
  }
}

function registerMethods(methods, groupName, className, { prototype = true, getter = false } = {}) {
  if ( !methods ) return;
  let cl = lookupByClassName(className);
  if ( prototype ) cl = cl.prototype;
  for ( const [name, fn] of Object.entries(methods) ) {
    REG_TRACKER[groupName].regMethod(cl, name, fn, { getter });
  }
}

function registerHooks(hooks, groupName) {
  if ( !hooks ) return;
  for ( const [name, fn] of Object.entries(hooks) ) {
    REG_TRACKER[groupName].regHook(name, fn);
  }
}

/**
 * A thorough lookup method to locate Foundry classes by name.
 * Relies on CONFIG where possible, falling back on eval otherwise.
 * @param {string} className
 * @param {object} [opts]
 * @param {boolean} [opts.returnPathString]   Return a string path to the object, for libWrapper.
 * @returns {class}
 */
function lookupByClassName(className, { returnPathString = false } = {}) {
  let isDoc = className.endsWith("Document");
  let isConfig = className.endsWith("Config");
  let baseClass = isDoc ? className.replace("Document", "") : isConfig ? className.replace("Config", "") : className;

  const configObj = CONFIG[baseClass];
  if ( !configObj || isConfig ) return returnPathString ? className : eval?.(`"use strict";(${className})`);

  // Do this the hard way to catch inconsistencies
  switch ( className ) {
    case "Actor":
    case "ActiveEffect":
    case "Item":
      isDoc = true; break;
  }

  if ( isDoc && configObj.documentClass ) {
    return returnPathString ? `CONFIG.${baseClass}.documentClass` : configObj.documentClass;
  }

  if ( configObj.objectClass ) return returnPathString ? `CONFIG.${baseClass}.objectClass` : configObj.objectClass;
  return returnPathString ? className : eval?.(`"use strict";(${className})`);
}

export const REG_TRACKER = {};
const GROUPINGS = new Set();
export function initializeRegistrationTracker() {
  // Determine all the relevant groupings.
  GROUPINGS.clear();
  Object.values(PATCHES).forEach(obj => Object.keys(obj).forEach(k => GROUPINGS.add(k)));

  // Decorate each group type and create one per option.
  for ( const key of GROUPINGS ) {
    const regObj = REG_TRACKER[key] = {};
    regObj.PATCHES = new Map();
    regObj.METHODS = new Map();
    regObj.HOOKS = new Map();

    regObj.regWrap = regDec(wrap, regObj.PATCHES);
    regObj.regOverride = regDec(override, regObj.PATCHES);
    regObj.regMethod = regDec(addClassMethod, regObj.METHODS);
    regObj.regHook = regDec(addHook, regObj.HOOKS);
  }
}

export function initializePatching() {
  initializeRegistrationTracker();
  registerGroup("BASIC");
  registerPatchesForSettings();
}

/**
 * Register patches for the current settings
 */
export function registerPatchesForSettings() {
  const visibility = getSetting(SETTINGS.TEST_VISIBILITY);
  const sweep = getSetting(SETTINGS.CLOCKWISE_SWEEP);
  unregisterPatchesForSettings();
  if ( visibility ) registerGroup("VISIBILITY");
  if ( sweep ) registerGroup("SWEEP");
}

function unregisterPatchesForSettings() {
  deregisterGroup("VISIBILITY");
  deregisterGroup("SWEEP");
}

/**
 * Register patches for the current scene settings
 */
export function registerPatchesForSceneSettings() {
  const { ALGORITHM, TYPES } = SETTINGS.SHADING;
  const algorithm = getSceneSetting(ALGORITHM);
  unregisterPatchesForSceneSettings();
  switch ( algorithm ) {
    case TYPES.POLYGONS: registerGroup("POLYGONS"); break;
    case TYPES.WEBGL: {
      registerGroup("WEBGL");
      canvas.effects.lightSources.forEach(src => src._initializeEVShadows());
      break;
    }
  }

  if ( algorithm !== TYPES.WEBGL ) {
    canvas.effects.lightSources.forEach(src => {
      Object.values(src.layers).forEach(layer => layer.shader.uniforms.uEVShadows = false);
    });
  }

  // Trigger initialization of all lights when switching so that the visibility cache is updated.
  for ( const lightSource of canvas.effects.lightSources ) {
    if ( lightSource instanceof GlobalLightSource ) continue;
    if ( lightSource instanceof DirectionalLightSource
      && algorithm !== TYPES.WEBGL ) lightSource.object.convertFromDirectionalLight();

    lightSource.initialize(lightSource.data);
  }

  canvas.perception.update({refreshLighting: true, refreshVision: true});
}

function unregisterPatchesForSceneSettings() {
  deregisterGroup("POLYGONS");
  deregisterGroup("WEBGL");
}
