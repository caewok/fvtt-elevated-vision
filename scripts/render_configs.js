/* globals
canvas,
DefaultTokenConfig,
FormDataExtended,
foundry,
game,
renderTemplate
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, TEMPLATES, FLAGS } from "./const.js";
import { DirectionalLightSource } from "./DirectionalLightSource.js";
import { SETTINGS, getSetting, getSceneSetting } from "./settings.js";

export const PATCHES_AmbientLightConfig = {};
export const PATCHES_AmbientSoundConfig = {};
export const PATCHES_TileConfig = {};
export const PATCHES_TokenConfig = {};

PATCHES_AmbientLightConfig.BASIC = {};
PATCHES_AmbientSoundConfig.BASIC = {};
PATCHES_TileConfig.BASIC = {};
PATCHES_TokenConfig.BASIC = {};

async function renderTokenConfigHook(app, html, data) {
  const template = TEMPLATES.TOKEN;
  const findString = "div[data-tab='character']:last";
  addTokenConfigData(app, data);
  await injectConfiguration(app, html, data, template, findString);
}

function addTokenConfigData(app, data) {
  // If default token config, make sure the default flags are set if not already.
  // Setting flags directly fails, so do manually.
  const isDefaultConfig = app.isPrototype || app instanceof DefaultTokenConfig; // PrototypeToken or DefaultToken
  if ( isDefaultConfig ) {
    const { ALGORITHM, TYPES } = FLAGS.ELEVATION_MEASUREMENT;
    data.object.flags ??= {};
    data.object.flags[MODULE_ID] ??= {};
    data.object.flags[MODULE_ID][ALGORITHM] = TYPES.POINTS_CLOSE;
  }

  const renderData = {};
  renderData[MODULE_ID] = {
    elevationAlgorithms: FLAGS.ELEVATION_MEASUREMENT.LABELS
  };
  foundry.utils.mergeObject(data, renderData, {inplace: true});
}

PATCHES_TokenConfig.BASIC.HOOKS = {
  renderTokenConfig: renderTokenConfigHook
};

/**
 * Inject html to add controls to the ambient light configuration to allow user to set elevation.
 */
async function renderAmbientLightConfigHook(app, html, data) {
  const template = TEMPLATES.AMBIENT_SOURCE;
  const findString = "div[data-tab='basic']:last";
  calculateDirectionalData(app, data);
  await injectConfiguration(app, html, data, template, findString);
  activateLightConfigListeners(app, html);
}

PATCHES_AmbientLightConfig.BASIC.HOOKS = {
  renderAmbientLightConfig: renderAmbientLightConfigHook
};

/**
 * Calculate directional data based on position.
 */
function calculateDirectionalData(app, data) {
  const { x, y } = app.object;
  const { azimuth, elevationAngle } = DirectionalLightSource.directionalParametersFromPosition({x, y});
  const isDirectional = Boolean(app.object.flags[MODULE_ID]?.directionalLight);
  const { ALGORITHM, TYPES } = SETTINGS.SHADING;
  const algorithm = getSceneSetting(ALGORITHM);
  const renderData = {};
  renderData[MODULE_ID] = {
    directionalDisabled: algorithm !== TYPES.WEBGL,
    defaultLightSize: getSetting(SETTINGS.LIGHTING.LIGHT_SIZE),
    pixelsDistance: (1 / canvas.dimensions.distancePixels).toPrecision(1),
    azimuth: Math.normalizeDegrees(Math.toDegrees(azimuth)).toFixed(1),
    elevationAngle: Math.normalizeDegrees(Math.toDegrees(elevationAngle)).toFixed(1),
    isDirectional };
  foundry.utils.mergeObject(data.data, renderData, {inplace: true});
}

/**
 * Inject html to add controls to the ambient sound configuration to allow user to set elevation.
 */
async function renderAmbientSoundConfigHook(app, html, data) {
  const template = TEMPLATES.AMBIENT_SOURCE;
  const findString = ".form-group:last";
  await injectConfiguration(app, html, data, template, findString);
}

PATCHES_AmbientSoundConfig.BASIC.HOOKS = {
  renderAmbientSoundConfig: renderAmbientSoundConfigHook
};

/**
 * Inject html to add controls to the tile configuration to allow user to set elevation.
 */
async function renderTileConfigHook(app, html, data) {
  const template = TEMPLATES.TILE;
  const findString = "div[data-tab='basic']:last";
  await injectConfiguration(app, html, data, template, findString);
}

PATCHES_TileConfig.BASIC.HOOKS = {
  renderTileConfig: renderTileConfigHook
};


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

  const { x, y} = DirectionalLightSource.positionFromDirectionalParameters(azimuth, clone.source.elevationAngle);
  const newData = { x, y };
  newData[MODULE_ID] = { azimuth: Number(event.target.value) };
}

/**
 * Update directional light location when elevationAngle changes.
 */
function onChangeElevationAngle(event) {
  const elevationAngle = Math.toRadians(Number(event.target.value));
  const clone = this.object.object._preview;
  if ( !clone ) return;

  const { x, y } = DirectionalLightSource.positionFromDirectionalParameters(clone.source.azimuth, elevationAngle);
  const newData = { x, y };
  newData[MODULE_ID] = { elevationAngle: Number(event.target.value) };
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
function defaultOptionsAmbientSoundConfig(wrapper) {
  const options = wrapper();
  return foundry.utils.mergeObject(options, {
    height: "auto"
  });
}

PATCHES_AmbientSoundConfig.BASIC.STATIC_WRAPS = {
  defaultOptions: defaultOptionsAmbientSoundConfig
};

/**
 * Wrapper for TileConfig.prototype.getData.
 * Add gridUnits value so units appear with the elevation setting.
 */
function getDataTileConfig(wrapper, options={}) {
  const data = wrapper(options);
  data.gridUnits = canvas.scene.grid.units || game.i18n.localize("GridUnits");
  return data;
}

/**
 * Wrapper for TileConfig.prototype._onChangeInput.
 * Link Levels bottom elevation with EV elevation of the tile
 * If one changes, the other should change.
 */
async function _onChangeInputTileConfig(wrapper, event) {
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

PATCHES_TileConfig.BASIC.WRAPS = {
  getData: getDataTileConfig,
  _onChangeInput: _onChangeInputTileConfig
};
