/* globals
canvas,
foundry,
renderTemplate
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, TEMPLATES } from "./const.js";
import { DirectionalLightSource } from "./DirectionalLightSource.js";
import { Settings, getSceneSetting } from "./settings.js";

// Patches for the AmbientLightConfig class.
export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: WRAPS ----- //
/**
 * Wrap AmbientLightConfig#_prepareContext
 * Add in directional light data.
 * @param {RenderOptions} options                 Options which configure application rendering behavior
 * @returns {Promise<ApplicationRenderContext>}   Context data for the render operation
 * @protected
 */
async function _prepareContext(wrapped, options) {
  const data = await wrapped(options);
  calculateDirectionalData(this, data);
  return data;
}

/**
 * Wrap AmbientLightConfig#._renderHTML
 * Patch in the extra direction configs.
 * @param {ApplicationRenderContext} context        Context data for the render operation
 * @param {HandlebarsRenderOptions} options         Options which configure application rendering behavior
 * @returns {Promise<Record<string, HTMLElement>>}  A single rendered HTMLElement for each requested part
 */
async function _renderHTML(wrapped, context, options) {
  const rendered = await wrapped(context, options);
  const template = TEMPLATES.AMBIENT_SOURCE;
  const myHTML = await renderTemplate(template, context);
  const div = document.createElement("div");
  div.innerHTML = myHTML;

  // Place in the basic tab at the end of the form groups
  //const divs = context.basic.getElementsByClassName("form-group");
  //const parent = divs[divs.length - 1].parentElement.append(div);
  rendered.basic.append(div)

  activateLightConfigListeners(this, rendered);
  return rendered;
}

PATCHES.BASIC.WRAPS = { _prepareContext, _renderHTML };


/**
 * Helper to inject configuration html into the application config.
 */
// async function injectConfiguration(app, html, data, template, findString) {
//   const myHTML = await renderTemplate(template, data);
//   const form = html.find(findString);
//   form.append(myHTML);
//   app.setPosition(app.position);
// }

/**
 * Calculate directional data based on position.
 */
function calculateDirectionalData(app, data) {
  const { x, y } = app.document;
  const { azimuth, elevationAngle } = DirectionalLightSource.directionalParametersFromPosition({x, y});
  const isDirectional = Boolean(app.document.flags[MODULE_ID]?.directionalLight);
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
  foundry.utils.mergeObject(data, renderData, {inplace: true});
}

/**
 * Catch when the user selects directional wall to update the submenu options.
 */
function activateLightConfigListeners(app, rendered) {
  rendered.basic.addEventListener("click", onCheckDirectional.bind(app));
  rendered.basic.addEventListener("change", onChangeAzimuth.bind(app));
  rendered.basic.addEventListener("change", onChangeElevationAngle.bind(app));
}

/**
 * Update directional light location when azimuth changes.
 */
function onChangeAzimuth(event) {
  const azimuth = Math.toRadians(Number(event.target.value));
  const clone = this.document.object._preview;
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
  const clone = this.document.object._preview;
  if ( !clone ) return;

  const { x, y } = DirectionalLightSource.positionFromDirectionalParameters(clone.source.azimuth, elevationAngle);
  const newData = { x, y };
  newData[MODULE_ID] = { elevationAngle: Number(event.target.value) };
}

/**
 * Update submenu visibility
 */
function onCheckDirectional(event) {
  const elemAzimuth = document.getElementById("elevatedvision-config-azimuth");
  const elemElevationAngle = document.getElementById("elevatedvision-config-elevationAngle");
  const elemSolarAngle = document.getElementById("elevatedvision-config-solarAngle");
  const clone = this.document.object._preview;
  const directionalLightChecked = event.target.checked;

  if ( directionalLightChecked ) {
    if ( clone ) clone.convertToDirectionalLight();
    elemAzimuth.style.display = "block";
    elemElevationAngle.style.display = "block";
    elemSolarAngle.style.display = "block";

  } else {  // Point source
    if ( clone ) clone.convertFromDirectionalLight();
    elemAzimuth.style.display = "none";
    elemElevationAngle.style.display = "none";
    elemSolarAngle.style.display = "none";
  }
}
