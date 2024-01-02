/* globals
canvas,
foundry,
renderTemplate
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, TEMPLATES, FLAGS } from "./const.js";
import { DirectionalLightSource } from "./DirectionalLightSource.js";
import { Settings, getSceneSetting } from "./settings.js";

export const PATCHES_AmbientLightConfig = {};
export const PATCHES_TokenConfig = {};

PATCHES_AmbientLightConfig.BASIC = {};
PATCHES_TokenConfig.BASIC = {};

async function renderTokenConfigHook(app, html, data) {
  const template = TEMPLATES.TOKEN;
  const findString = "div[data-tab='character']:last";
  addTokenConfigData(app, data);
  await injectConfiguration(app, html, data, template, findString);
}

function addTokenConfigData(app, data) {
  const { ALGORITHM, TYPES, LABELS } = FLAGS.ELEVATION_MEASUREMENT;
  data.object.flags ??= {};
  data.object.flags[MODULE_ID] ??= {};
  data.object.flags[MODULE_ID][ALGORITHM] ??= TYPES.POINTS_CLOSE;

  const renderData = {};
  renderData[MODULE_ID] = {
    elevationAlgorithms: LABELS
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
  const { ALGORITHM, TYPES } = Settings.KEYS.SHADING;
  const algorithm = getSceneSetting(ALGORITHM);
  const renderData = {};
  renderData[MODULE_ID] = {
    directionalDisabled: algorithm !== TYPES.WEBGL,
    defaultLightSize: Settings.get(Settings.KEYS.LIGHTING.LIGHT_SIZE),
    pixelsDistance: (1 / canvas.dimensions.distancePixels).toPrecision(1),
    azimuth: Math.normalizeDegrees(Math.toDegrees(azimuth)).toFixed(1),
    elevationAngle: Math.normalizeDegrees(Math.toDegrees(elevationAngle)).toFixed(1),
    isDirectional };
  foundry.utils.mergeObject(data.data, renderData, {inplace: true});
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
