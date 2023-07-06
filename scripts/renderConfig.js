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
import { DirectionalLightSource } from "./directional_lights.js";

/**
 * Inject html to add controls to the ambient light configuration to allow user to set elevation.
 */
export async function renderAmbientLightConfigHook(app, html, data) {
  const template = `modules/${MODULE_ID}/templates/elevatedvision-ambient-source-config.html`;
  const findString = "div[data-tab='basic']:last";
  calculateDirectionalData(app, data);
  await injectConfiguration(app, html, data, template, findString);
  activateLightConfigListeners(app, html);
}

/**
 * Calculate directional data based on position.
 */
function calculateDirectionalData(app, data) {
  const { x, y } = app.object;
  const { azimuth, elevationAngle } = DirectionalLightSource.directionalParametersFromPosition({x, y});
  const isDirectional = app.object.flags[MODULE_ID].directionalLight;
  const renderData = {};
  renderData[MODULE_ID] = { azimuth: Math.toDegrees(azimuth), elevationAngle: Math.toDegrees(elevationAngle), isDirectional };
  foundry.utils.mergeObject(data.data, renderData, {inplace: true});
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
 * Catch when the user selects directional wall to update the submenu options.
 */
function activateLightConfigListeners(app, html) {
  html.on("click", "#elevatedvisionDirectionalLightCheckbox", onCheckDirectional.bind(app));
  html.on("change", "#elevatedvisionAzimuthConfig", onChangeAzimuth.bind(app));
  html.on("change", "#elevatedvisionElevationAngleConfig", onChangeElevationAngle.bind(app));
}

/**
 * Update directional light location when azimuth changes.
 */
function onChangeAzimuth(event) {
  const azimuth = Math.toRadians(Number(event.target.value));
  const clone = this.object.object._preview;
  if ( !clone ) return;

//   const { x, y} = DirectionalLightSource.positionFromDirectionalParameters(azimuth, clone.source.elevationAngle);
//   const newData = { x, y };
//   const previewData = this._getSubmitData(newData);
//   this._previewChanges(previewData);
//   this.render();
}

/**
 * Update directional light location when elevationAngle changes.
 */
function onChangeElevationAngle(event) {
  const elevationAngle = Math.toRadians(Number(event.target.value));
  const clone = this.object.object._preview;
  if ( !clone ) return;

//   const { x, y } = DirectionalLightSource.positionFromDirectionalParameters(clone.source.azimuth, elevationAngle);
//   const newData = { x, y };
//   const previewData = this._getSubmitData(newData);
//   this._previewChanges(previewData);
//   this.render();
}

/**
 * Update submenu visibility
 */
function onCheckDirectional(event) {
  const elemElevation = document.getElementById("elevatedvision-config-elevation");
  const elemAzimuth = document.getElementById("elevatedvision-config-azimuth");
  const elemElevationAngle = document.getElementById("elevatedvision-config-elevationAngle");
  const elemSolarAngle = document.getElementById("elevatedvision-config-solarAngle");
  const clone = this.object.object._preview;
  const directionalLightChecked = event.target.checked;

  if ( directionalLightChecked ) {
    if ( clone ) clone.convertToDirectionalLight();
    elemElevation.style.display = "none";
    elemAzimuth.style.display = "block";
    elemElevationAngle.style.display = "block";
    elemSolarAngle.style.display = "block";

  } else {  // Point source
    if ( clone ) clone.convertFromDirectionalLight();
    elemElevation.style.display = "block";
    elemAzimuth.style.display = "none";
    elemElevationAngle.style.display = "none";
    elemSolarAngle.style.display = "none";
  }
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
  const elevChangeFlag = `flags.${MODULE_ID}.${FLAGS.ELEVATION}`;
  const dimRadiusChangeFlag = "config.dim";
  const brightRadiusChangeflag = "config.bright";

  const flatData = flattenObject(data);
  const changed = new Set(Object.keys(flatData));
  if ( changed.has(elevChangeFlag) ) {
    doc.object.renderFlags.set({
      refreshElevation: true
    });
  }

  if ( changed.has(dimRadiusChangeFlag) || changed.has(brightRadiusChangeflag) ) {
    doc.object.renderFlags.set({
      refreshRadius: true
    });
  }
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
// export function refreshAmbientLightHook(light, flags) {
  // if ( flags.refreshElevation ) {}
// }

/**
 * Hook ambient sound refresh to address the refreshElevation renderFlag.
 * Update the source elevation.
 * See AmbientSound.prototype._applyRenderFlags.
 * @param {PlaceableObject} object    The object instance being refreshed
 * @param {RenderFlags} flags
 */
// export function refreshAmbientSoundHook(sound, flags) {
  // if ( flags.refreshElevation ) {}
// }


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


