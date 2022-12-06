/* globals
renderTemplate,
Hooks
*/

"use strict";

import { log } from "./util.js";
import { MODULE_ID } from "./const.js";

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
