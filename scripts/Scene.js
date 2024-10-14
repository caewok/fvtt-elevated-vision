/* globals
Hooks,
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, TEMPLATES, FLAGS } from "./const.js";
import { log, renderTemplateSync } from "./util.js";
import { Settings, getSceneSetting } from "./settings.js";
import { registerPatchesForSceneSettings } from "./patching.js";

// Patches for the Scene class
export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * Hook scene config updates so lighting/vision shadows can be modified.
 */
function updateScene(scene, changes, options, userId) {
  if ( scene !== canvas.scene ) return;
  const lightingValue = changes.flags?.elevatedvision?.[FLAGS.SHADOWS.LIGHTING];
  const shadowsValue = changes.flags?.elevatedvision?.[FLAGS.SHADOWS.VISION];
  if ( typeof lightingValue === "undefined" && typeof lightingValue === "undefined" ) return;
  registerPatchesForSceneSettings();
}

/**
 * Update data for pull-down algorithm menu for the scene config.
 */
function renderSceneConfig(app, html, data) {
  log("SceneConfig", app, html, data);

  // Algorithm names for the pull down.
//   const renderData = {};
//   const scene = app.object;
//   [
//     Settings.KEYS.ELEVATION_MINIMUM,
//     Settings.KEYS.ELEVATION_INCREMENT,
//     Settings.KEYS.SHADOWS.LIGHTING,
//     Settings.KEYS.SHADOWS.VISION
//   ].forEach(s => renderData[`data.flags.${MODULE_ID}.${s}`] = getSceneSetting(s, scene));
//
//   foundry.utils.mergeObject(data, renderData, {inplace: true});
  const form = html.find(`input[name="initial.scale"]`).closest(".form-group"); // eslint-disable-line quotes
  const snippet = renderTemplateSync(TEMPLATES.SCENE, data);
  form.append(snippet);
  app.setPosition({ height: "auto" });
}

PATCHES.BASIC.HOOKS = { renderSceneConfig, updateScene };
