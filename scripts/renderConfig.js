/* globals
canvas,
flattenObject,
FormDataExtended,
foundry,
game,
renderTemplate
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
import { MODULE_ID, FLAGS } from "./const.js";

/**
 * Inject html to add controls to the ambient light configuration to allow user to set elevation.
 */
export async function renderAmbientLightConfigHook(app, html, data) {
  const template = `modules/${MODULE_ID}/templates/elevatedvision-ambient-source-config.html`;
  const findString = "div[data-tab='basic']:last";
  await injectConfiguration(app, html, data, template, findString);
}

/**
 * Inject html to add controls to the ambient sound configuration to allow user to set elevation.
 */
export async function renderAmbientSoundConfigHook(app, html, data) {
  const template = `modules/${MODULE_ID}/templates/elevatedvision-ambient-source-config.html`;
  const findString = ".form-group:last";
  await injectConfiguration(app, html, data, template, findString);
}

/**
 * Inject html to add controls to the tile configuration to allow user to set elevation.
 */
export async function renderTileConfigHook(app, html, data) {
  const template = `modules/${MODULE_ID}/templates/elevatedvision-tile-config.html`;
  const findString = "div[data-tab='basic']:last";
  await injectConfiguration(app, html, data, template, findString);
}


/**
 * Hook when the elevation flag is changed in the AmbientLightDocument.
 * Used below to update the underlying source elevation.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
export function updateAmbientLightHook(doc, data, _options, _userId) {
  const changeFlag = `flags.${MODULE_ID}.${FLAGS.ELEVATION}`;
  const flatData = flattenObject(data);
  const changed = new Set(Object.keys(flatData));
  if ( !changed.has(changeFlag) ) return;

  doc.object.renderFlags.set({
    refreshElevation: true
  });
}

/**
 * Hook when the elevation flag is changed in the AmbientSoundDocument.
 * Used below to update the underlying source elevation.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
export function updateAmbientSoundHook(doc, data, _options, _userId) {
  const changeFlag = `flags.${MODULE_ID}.${FLAGS.ELEVATION}`;
  const flatData = flattenObject(data);
  const changed = new Set(Object.keys(flatData));
  if ( !changed.has(changeFlag) ) return;

  doc.object.renderFlags.set({
    refreshElevation: true
  });
}

/**
 * Hook ambient light refresh to address the refreshElevation renderFlag.
 * Update the source elevation.
 * See AmbientLight.prototype._applyRenderFlags.
 * @param {PlaceableObject} object    The object instance being refreshed
 * @param {RenderFlags} flags
 */
export function refreshAmbientLightHook(light, flags) {
  // if ( flags.refreshElevation ) {}
}

/**
 * Hook ambient sound refresh to address the refreshElevation renderFlag.
 * Update the source elevation.
 * See AmbientSound.prototype._applyRenderFlags.
 * @param {PlaceableObject} object    The object instance being refreshed
 * @param {RenderFlags} flags
 */
export function refreshAmbientSoundHook(sound, flags) {
  // if ( flags.refreshElevation ) {}
}


/**
 * Helper to inject configuration html into the application config.
 */
async function injectConfiguration(app, html, data, template, findString) {
  const myHTML = await renderTemplate(template, data);
  const form = html.find(findString);
  form.append(myHTML);
  app.setPosition(app.position);
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


