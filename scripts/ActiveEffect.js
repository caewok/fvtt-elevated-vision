/* globals
CONFIG
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { getSceneSetting, Settings } from "./settings.js";

export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Wraps ----- //

/**
 * Monitor for the prone active effect and update vision for affected tokens.
 * This will cause shadows to change based on the changed token height.
 */
function createOrRemoveActiveEffectHook(effect, _opts, _userId) {
  if ( getSceneSetting(Settings.KEYS.SHADING.ALGORITHM) === Settings.KEYS.SHADING.TYPES.NONE ) return;
  if ( !effect.statuses.has(CONFIG.GeometryLib.proneStatusId) ) return;

  const tokens = effect.parent?.getActiveTokens();
  if ( !tokens) return;

  tokens.forEach(t => t.vision._updateEVShadowData({changedElevation: true}));
}

PATCHES.BASIC.HOOKS = {
  createActiveEffect: createOrRemoveActiveEffectHook,
  deleteActiveEffect: createOrRemoveActiveEffectHook
};
