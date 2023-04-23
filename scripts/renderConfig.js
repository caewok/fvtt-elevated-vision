/* globals
renderTemplate,
Hooks,
foundry,
canvas,
game,
FormDataExtended
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { autoTokenHeight } from "./elevation.js";

Hooks.on("renderAmbientLightConfig", renderAmbientLightConfigHook);
Hooks.on("renderAmbientSoundConfig", renderAmbientSoundConfigHook);
Hooks.on("renderTileConfig", renderTileConfigHook);
Hooks.on("renderWallConfig", renderWallConfigHook);
Hooks.on("renderTokenConfig", renderTokenConfigHook);

/**
 * Inject html to add controls to the ambient light configuration to allow user to set elevation.
 */
async function renderAmbientLightConfigHook(app, html, data) {
  const template = `modules/${MODULE_ID}/templates/elevatedvision-ambient-source-config.html`;
  const findString = "div[data-tab='basic']:last";
  await injectConfiguration(app, html, data, template, findString);
}

/**
 * Inject html to add controls to the ambient sound configuration to allow user to set elevation.
 */
async function renderAmbientSoundConfigHook(app, html, data) {
  const template = `modules/${MODULE_ID}/templates/elevatedvision-ambient-source-config.html`;
  const findString = ".form-group:last";
  await injectConfiguration(app, html, data, template, findString);
}

/**
 * Inject html to add controls to the tile configuration to allow user to set elevation.
 */
async function renderTileConfigHook(app, html, data) {
  const template = `modules/${MODULE_ID}/templates/elevatedvision-tile-config.html`;
  const findString = "div[data-tab='basic']:last";
  await injectConfiguration(app, html, data, template, findString);
}

/**
 * Inject html to add controls to the wall configuration to allow user to set elevation.
 */
async function renderWallConfigHook(app, html, data) {
  const template = `modules/${MODULE_ID}/templates/elevatedvision-wall-config.html`;
  const findString = ".form-group:last";
  const myHTML = await renderTemplate(template, data);
  const form = html.find(findString).closest(".form-group");
  form.after(myHTML); // append fails here for mysterious reasons.
  app.setPosition({ height: "auto" });
}

/**
 * Inject html to add controls to the token configuration to allow user to set height.
 */
async function renderTokenConfigHook(app, html, data) {
  const template = `modules/${MODULE_ID}/templates/elevatedvision-token-config.html`;
  const findString = "div[data-tab='character']:last";
  await injectConfiguration(app, html, data, template, findString);
}

/**
 * Helper to inject configuration html into the application config.
 */
async function injectConfiguration(app, html, data, template, findString) {
  const myHTML = await renderTemplate(template, data);
  const form = html.find(findString);
  form.append(myHTML);
  app.setPosition({ height: "auto" });
}

/**
 * Wrapper for AmbientSoundConfig.defaultOptions
 * Make the sound config window resize height automatically, to accommodate
 * the elevation config.
 * @param {Function} wrapper
 * @return {Object} See AmbientSoundConfig.defaultOptions.
 */
export function defaultOptionsAmbientSoundConfig(wrapper) {
  const options = wrapper();
  return foundry.utils.mergeObject(options, {
    height: "auto"
  });
}

/**
 * Wrapper for TileConfig.prototype.getData.
 * Add gridUnits value so units appear with the elevation setting.
 */
export function getDataTileConfig(wrapper, options={}) {
  const data = wrapper(options);
  data.gridUnits = canvas.scene.grid.units || game.i18n.localize("GridUnits");
  return data;
}

/**
 * Wrapper for WallConfig.prototype.getData.
 * Add gridUnits value so units appear with the elevation setting.
 */
export function getDataWallConfig(wrapper, options={}) {
  const data = wrapper(options);
  data.gridUnits = canvas.scene.grid.units || game.i18n.localize("GridUnits");
  return data;
}

/**
 * Wrapper for TokenConfig.prototype.getData.
 * Add the auto-calculated token height.
 */
export async function getDataTokenConfig(wrapper, options={}) {
  const data = await wrapper(options);
  data.evTokenHeightPlaceholder = autoTokenHeight(this.object.object);
  data.evGridUnits = canvas.scene.grid.units || game.i18n.localize("GridUnits");
  return data;
}

/**
 * Wrapper for TileConfig.prototype._onChangeInput.
 * Link Levels bottom elevation with EV elevation of the tile
 * If one changes, the other should change.
 */
export async function _onChangeInputTileConfig(wrapper, event) {
  await wrapper(event);

  // If EV elevation or levels bottom elevation updated, update the other.
  // Update preview object
  const fdo = new FormDataExtended(this.form).object;
  if ( Object.hasOwn(fdo, "flags.elevatedvision.elevation") ) {
    fdo["flags.levels.rangeBottom"] = fdo["flags.elevatedvision.elevation"];
  } else if ( Object.hasOwn(fdo, "flags.levels.rangeBottom") ) {
    fdo["flags.elevatedvision.elevation"] = fdo["flags.levels.rangeBottom"];
  } else return;

  // To allow a preview without glitches
  fdo.width = Math.abs(fdo.width);
  fdo.height = Math.abs(fdo.height);

  // Handle tint exception
  let tint = fdo["texture.tint"];
  if ( !foundry.data.validators.isColorString(tint) ) fdo["texture.tint"] = null;

  // Update preview object
  foundry.utils.mergeObject(this.document, foundry.utils.expandObject(fdo));
  this.document.object.refresh();
}
