/* globals
Hooks,
foundry,
renderTemplate
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { log } from "./util.js";
import { Settings, getSceneSetting } from "./settings.js";


Hooks.on("renderSceneConfig", renderSceneConfigHook);

/**
 * Update data for pull-down algorithm menu for the scene config.
 */
async function renderSceneConfigHook(app, html, data) {
  log("SceneConfig", app, html, data);

  // Algorithm names for the pull down.
  const renderData = {};
  renderData[MODULE_ID] = { algorithms: Settings.KEYS.SHADING.LABELS };

  const scene = app.object;
  const sceneSettings = [
    Settings.KEYS.ELEVATION_MINIMUM,
    Settings.KEYS.ELEVATION_INCREMENT,
    Settings.KEYS.SHADOWS.LIGHTING,
    Settings.KEYS.SHADOWS.VISION
  ];

  for ( const setting of sceneSettings ) {
    renderData[`data.flags.${MODULE_ID}.${setting}`] = getSceneSetting(setting, scene);
  }

  foundry.utils.mergeObject(data, renderData, {inplace: true});

  const form = html.find(`input[name="initial.scale"]`).closest(".form-group"); // eslint-disable-line quotes
  const snippet = await renderTemplate(`modules/${MODULE_ID}/templates/scene-elevation-config.html`, data);
  form.append(snippet);
  app.setPosition({ height: "auto" });
}
