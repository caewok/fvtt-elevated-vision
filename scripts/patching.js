/* globals
Hooks,
libWrapper
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */


import { MODULE_ID } from "./const.js";
import { getSetting, getSceneSetting, SETTINGS } from "./settings.js";

// Import objects of patch functions for each applicable Foundry class type
import { PATCHES as PATCHES_AmbientLight } from "./AmbientLight.js";
import { PATCHES as PATCHES_Canvas } from "./Canvas.js";
import { PATCHES as PATCHES_CanvasVisibility } from "./CanvasVisibility.js";
import { PATCHES as PATCHES_ClockwiseSweepPolygon } from "./ClockwiseSweepPolygon.js";
import { PATCHES as PATCHES_GlobalLightSource } from "./GlobalLightSource.js";
import { PATCHES as PATCHES_LightSource } from "./LightSource.js";
import { PATCHES as PATCHES_PIXI_Graphics } from "./PIXI_Graphics.js";
import { PATCHES as PATCHES_RenderedPointSource } from "./RenderedPointSource.js";
import { PATCHES as PATCHES_Tile } from "./Tile.js";
import { PATCHES as PATCHES_VisionSource } from "./VisionSource.js";
import { PATCHES as PATCHES_Wall } from "./Wall.js";
import { PATCHES as PATCHES_AdaptiveLightingShader } from "./glsl/AdaptiveLightingShader.js";

// Some patches are already grouped by class
import {
  PATCHES_DetectionMode,
  PATCHES_DetectionModeBasicSight,
  PATCHES_DetectionModeTremor } from "./detection_modes.js";

import {
  PATCHES_AmbientLightConfig,
  PATCHES_AmbientSoundConfig,
  PATCHES_TileConfig } from "./render_configs.js";

import {
  PATCHES_Token,
  PATCHES_ActiveEffect } from "./tokens.js";

// Different types of registrations, depending on function.
export const REG_TRACKER = {};


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
  AmbientSoundConfig: PATCHES_AmbientSoundConfig,
  Canvas: PATCHES_Canvas,
  CanvasVisibility: PATCHES_CanvasVisibility,
  ClockwiseSweepPolygon: PATCHES_ClockwiseSweepPolygon,
  DetectionMode: PATCHES_DetectionMode,
  DetectionModeBasicSight: PATCHES_DetectionModeBasicSight,
  DetectionModeTremor: PATCHES_DetectionModeTremor,
  GlobalLightSource: PATCHES_GlobalLightSource,
  LightSource: PATCHES_LightSource,
  PIXI_Graphics: PATCHES_PIXI_Graphics,
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
  const descriptor = { writable: true, configurable: true };
  if ( getter ) descriptor.get = fn;
  else descriptor.value = fn;
  Object.defineProperty(cl, name, descriptor);
  return `${cl.name ?? cl.constructor.name}.${cl.name ? "" : "prototype."}${name}`;
}

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
function deregisterPatches(map) { map.forEach((id, _args) => libWrapper.unregister(MODULE_ID, id, false)); }

function deregisterHooks(map) {
  map.forEach((id, args) => {
    const hookName = args[0];
    Hooks.off(hookName, id);
  });
}

function deregisterMethods(map) {
  map.forEach((_id, args) => {
    const cl = args[0];
    const name = args[1];
    delete cl[name];
  });
}

export const PATCH_GROUPS = {};
const GROUPINGS = new Set();
function initializeRegistrationTracker() {
  // Determine all the relevant groupings.
  Object.values(PATCHES).forEach(obj => Object.keys(obj).forEach(k => GROUPINGS.add(k)));

  // Right now, we have:
  // - CLASS
  //   - BASIC
  //     - WRAPS
  //     - METHODS
  //     - ...
  //   - WEBGL ...

  // Invert the patches so we have
  // - BASIC:
  //   - CLASS:
  //     - WRAPS
  //     - ...
  // - WEBGL ...
  //   for ( const key of GROUPINGS ) {
  //     PATCH_GROUPS[key] = {};
  //     for ( const [className, obj] of Object.entries(PATCHES) ) PATCH_GROUPS[key][className] = obj[key];
  //   }

  // Decorate each group type and create one per option.
  for ( const key of GROUPINGS ) {
    const regObj = REG_TRACKER[key] = {};
    regObj.PATCHES = new Map();
    regObj.METHODS = new Map();
    regObj.HOOKS = new Map();

    regObj.regWrap = regDec(wrap, regObj.PATCHES);
    regObj.regOverride = regDec(override, regObj.PATCHES);
    regObj.regMethod = regDec(addClassMethod, regObj.METHODS);
    regObj.regHook = regDec(Hooks.on, regObj.HOOKS);
  }
}


export function initalizePatching() {
  initializeRegistrationTracker();
  registerGroup("BASIC");
  registerPatchesForSettings();
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
  const {
    WRAPS, OVERRIDES, METHODS, GETTERS,
    HOOKS, STATIC_WRAPS, STATIC_METHODS } = PATCH_GROUPS[className][groupName];
  registerWraps(className, WRAPS, groupName);
  registerWraps(className, OVERRIDES, groupName, { override: true });
  registerWraps(className, STATIC_WRAPS, groupName, { prototype: false });
  registerMethods(className, METHODS, groupName);
  registerMethods(className, STATIC_METHODS, groupName, { prototype: false });
  registerMethods(className, GETTERS, groupName, { getter: true});
  registerHooks(className, HOOKS, groupName);
}

function deregisterGroup(groupName) {
  const regObj = REG_TRACKER[groupName];
  deregisterPatches(regObj.PATCHES);
  deregisterMethods(regObj.METHODS);
  deregisterHooks(regObj.HOOKS);
}

function registerWraps(className, wraps, grouping, { prototype = true, override = false } = {}) {
  const wrapFn = override ? "regOverride" : "regWrap";
  for ( const [name, fn] of wraps ) {
    const methodName = `${className}.${prototype ? "prototype." : ""}${name}`;
    REG_TRACKER[grouping][wrapFn](methodName, fn, { perf_mode: libWrapper.PERF_FAST });
  }
}

function registerMethods(className, methods, grouping, { prototype = true, getter = false } = {}) {
  for ( const [name, fn] of methods ) {
    const methodName = `${className}.${prototype ? "prototype." : ""}${name}`;
    REG_TRACKER[grouping].regMethod(methodName, fn, { getter });
  }
}

function registerHooks(name, hooks, grouping) {
  for ( const [name, fn] of hooks ) {
    REG_TRACKER[grouping].regHook(name, fn);
  }
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
    case TYPES.WEBGL: registerGroup("WEBGL"); break;
  }

  // TODO: Refresh wall data? Shader uniforms?
}

function unregisterPatchesForSceneSettings() {
  deregisterGroup("POLYGONS");
  deregisterGroup("WEBGL");
}
