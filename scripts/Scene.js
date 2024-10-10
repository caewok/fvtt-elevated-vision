/* globals
Hooks,
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, TEMPLATES } from "./const.js";
import { log, renderTemplateSync } from "./util.js";
import { Settings, getSceneSetting } from "./settings.js";

// Patches for the Scene class
export const PATCHES = {};
PATCHES.BASIC = {};

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

PATCHES.BASIC.HOOKS = { renderSceneConfig };
