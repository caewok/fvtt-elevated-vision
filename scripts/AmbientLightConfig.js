/* globals
canvas,
CONFIG,
document,
foundry,
Hooks
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, TEMPLATES, ICONS } from "./const.js";
import { DirectionalLightSource } from "./DirectionalLightSource.js";
import { Settings, getSceneSetting } from "./settings.js";

// Patches for the AmbientLightConfig class.
export const PATCHES = {};
PATCHES.BASIC = {};

// Hook init to update the PARTS of the light config
Hooks.once("init", function() {
  const { footer, ...other } = foundry.applications.sheets.AmbientLightConfig.PARTS;
  foundry.applications.sheets.AmbientLightConfig.PARTS = {
    ...other, // Includes tabs
    [MODULE_ID]: { template: TEMPLATES.AMBIENT_SOURCE },
    footer
  };
});


// ----- NOTE: WRAPS ----- //

/**
 * Wrap AmbientLightConfig#_prepareContext
 * Add additional module tab to the config.
 * Add in directional light data.
 */
async function _prepareContext(wrapper, options) {
  const context = await wrapper(options);
  context.tabs[MODULE_ID] = {
    id: MODULE_ID,
    group: "sheet",
    icon: ICONS.MODULE,
    label: `${MODULE_ID}.name` };

  // From #getTabs
  for ( const v of Object.values(context.tabs) ) {
    v.active = this.tabGroups[v.group] === v.id;
    v.cssClass = v.active ? "active" : "";
  }
  return context;
}


/**
 * Wrap AmbientLightConfig#_preparePartContext
 * Add in lightmask specific data to the lightmask tab.
 * @param {string} partId                         The part being rendered
 * @param {ApplicationRenderContext} context      Shared context provided by _prepareContext
 * @param {HandlebarsRenderOptions} options       Options which configure application rendering behavior
 * @returns {Promise<ApplicationRenderContext>}   Context data for a specific part
 */
async function _preparePartContext(wrapper, partId, context, options) {
  context = await wrapper(partId, context, options);
  if ( partId !== MODULE_ID ) return context;
  calculateDirectionalData(this, context);
  return context;
}

/**
 * Wrap AmbientLightConfig#_attachPartListeners
 * Monitor for selecting directional light, changing directional parameters for light preview.
 * @param {string} partId                       The id of the part being rendered
 * @param {HTMLElement} htmlElement             The rendered HTML element for the part
 * @param {ApplicationRenderOptions} options    Rendering options passed to the render method
 * @protected
 */
function _attachPartListeners(wrapper, partId, htmlElement, options) {
  wrapper(partId, htmlElement, options);
  if ( partId !== MODULE_ID ) return;
  activateLightConfigListeners(this, htmlElement);
}


PATCHES.BASIC.WRAPS = {
  _prepareContext,
  _preparePartContext,
  _attachPartListeners
};


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
function calculateDirectionalData(app, context) {
  const { x, y } = app.document;
  const { azimuth, elevationAngle } = DirectionalLightSource.directionalParametersFromPosition({x, y});
  const isDirectional = Boolean(app.document.flags[MODULE_ID]?.directionalLight);
  const { ALGORITHM, TYPES } = Settings.KEYS.SHADING;
  const algorithm = getSceneSetting(ALGORITHM);

  context[MODULE_ID] = {
    directionalDisabled: algorithm !== TYPES.WEBGL,
    defaultLightSize: Settings.get(Settings.KEYS.LIGHTING.LIGHT_SIZE),
    pixelsDistance: (1 / canvas.dimensions.distancePixels).toPrecision(1),
    azimuth: Math.normalizeDegrees(Math.toDegrees(azimuth)).toFixed(1),
    elevationAngle: Math.normalizeDegrees(Math.toDegrees(elevationAngle)).toFixed(1),
    isDirectional
  };
  return context;
}

/**
 * Catch when the user selects directional wall to update the submenu options.
 */
function activateLightConfigListeners(app, html) {
  const directionalCheckbox = html.querySelector("#elevatedvisionDirectionalLightCheckbox");
  directionalCheckbox.addEventListener("click", onCheckDirectional.bind(app));

  const azimuthInput = html.querySelector("#elevatedvisionAzimuthConfig");
  azimuthInput.addEventListener("change", onChangeAzimuth.bind(app));

  const elevationAngleInput = html.querySelector("#elevatedvisionElevationAngleConfig");
  azimuthInput.addEventListener("change", onChangeElevationAngle.bind(app));
}

/**
 * Update directional light location when azimuth changes.
 */
function onChangeAzimuth(event) {
  const azimuth = Math.toRadians(Number(event.target.value));
  const clone = this.document.object._preview;
  if ( !clone ) return;

  const { x, y} = DirectionalLightSource.positionFromDirectionalParameters(azimuth, clone.lightSource.elevationAngle);
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

  const { x, y } = DirectionalLightSource.positionFromDirectionalParameters(clone.lightSource.azimuth, elevationAngle);
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
