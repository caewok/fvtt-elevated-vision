/* globals
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, TEMPLATES, FLAGS, OTHER_MODULES } from "./const.js";
import { log, renderTemplateSync } from "./util.js";
import { registerPatchesForSceneSettings } from "./patching.js";

// Patches for the Scene class
export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * Hook scene config updates so lighting/vision shadows can be modified.
 */
function updateScene(scene, changes, _options, _userId) {
  if ( scene !== canvas.scene ) return;
  const lightingValue = changes.flags?.[MODULE_ID]?.[FLAGS.SHADOWS.LIGHTING];
  const shadowsValue = changes.flags?.[MODULE_ID]?.[FLAGS.SHADOWS.VISION];
  if ( !(typeof lightingValue === "undefined"
      && typeof shadowsValue === "undefined") ) registerPatchesForSceneSettings();

  const TM = OTHER_MODULES.TERRAIN_MAPPER;
  if ( changes.flags?.[TM.KEY]?.[TM.BACKGROUND_ELEVATION] !== "undefined" ) {
    canvas.scene[MODULE_ID].updateSceneBackgroundElevation(); // Really unneeded if reloading canvas.
    SettingsConfig.reloadConfirm({world: true}); // TODO: Redo the elevation without the canvas reload
  }
}

/**
 * Update data for pull-down algorithm menu for the scene config.
 */
function renderSceneConfig(app, html, data) {
  log("SceneConfig", app, html, data);
  const form = html.find(`input[name="initial.scale"]`).closest(".form-group"); // eslint-disable-line quotes
  const snippet = renderTemplateSync(TEMPLATES.SCENE, data);
  form.append(snippet);
  app.setPosition({ height: "auto" });
}

PATCHES.BASIC.HOOKS = { renderSceneConfig, updateScene };
