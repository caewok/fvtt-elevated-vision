/* globals
Hooks,
foundry,
game,
canvas,
renderTemplate,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { log } from "./util.js";
import { SETTINGS, getSetting, getSceneSetting } from "./settings.js";
import { registerShadowPatches } from "./patching.js";

const FLY_CONTROL = {
  name: SETTINGS.FLY_BUTTON,
  title: `${MODULE_ID}.controls.${SETTINGS.FLY_BUTTON}.name`,
  icon: "fa-solid fa-plane-lock",
  toggle: true
};

Hooks.once("init", function() {
  // Cannot access localization until init.
  FLY_CONTROL.title = game.i18n.localize(FLY_CONTROL.title);
});

Hooks.on("getSceneControlButtons", getSceneControlButtonsHook);
Hooks.on("renderSceneConfig", renderSceneConfigHook);
Hooks.on("updateScene", updateSceneHook);


/**
 * Render the fly button if that setting is enabled and auto elevation is enabled.
 */
function getSceneControlButtonsHook(controls) {
  if ( !canvas.scene || !getSetting(SETTINGS.FLY_BUTTON) || !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return;
  const tokenTools = controls.find(c => c.name === "token");
  tokenTools.tools.push(FLY_CONTROL);
}

/**
 * Update data for pull-down algorithm menu for the scene config.
 */
async function renderSceneConfigHook(app, html, data) {
  log("SceneConfig", app, html, data);

  // Algorithm names for the pull down.
  const renderData = {};
  renderData[MODULE_ID] = { algorithms: SETTINGS.SHADING.LABELS };

  const scene = app.object;
  const sceneSettings = [
    SETTINGS.ELEVATION_MINIMUM,
    SETTINGS.ELEVATION_INCREMENT,
    SETTINGS.AUTO_ELEVATION,
    SETTINGS.SHADING.ALGORITHM
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

/**
 * Monitor whether EV has been enabled or disabled for a scene.
 */
async function updateSceneHook(document, change, _options, _userId) {
  if ( canvas.scene.id !== document.id ) return;

  // If the updated scene is currently the active scene, then update patches and fly controls.
  const autoelevate = change.flags?.[MODULE_ID]?.[SETTINGS.AUTO_ELEVATION];
  if ( typeof autoelevate !== "undefined" ) {
    updateFlyTokenControl(autoelevate);
    if ( autoelevate === true ) ui.notifications.notify("Elevated Vision autoelevate enabled for scene.");
    else if ( autoelevate === false ) ui.notifications.notify("Elevated Vision autoelevate disabled for scene.");
  }

  const algorithm = change.flags?.[MODULE_ID]?.[SETTINGS.SHADING.ALGORITHM];
  if ( algorithm ) {
    registerShadowPatches();
    await canvas.draw();
    const label = game.i18n.localize(SETTINGS.SHADING.LABELS[algorithm]);
    ui.notifications.notify(`Elevated Vision scene shadows switched to ${label}.`);
  }
}

export function updateFlyTokenControl(enable) {
  enable ??= getSceneSetting(SETTINGS.AUTO_ELEVATION);
  const tokenTools = ui.controls.controls.find(c => c.name === "token");
  const flyIndex = tokenTools.tools.findIndex(b => b.name === SETTINGS.FLY_BUTTON);
  if ( enable && !~flyIndex ) tokenTools.tools.push(FLY_CONTROL);
  else if ( ~flyIndex ) tokenTools.tools.splice(flyIndex, 1);
  ui.controls.render(true);
}
