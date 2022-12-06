/* globals
renderTemplate
*/

"use strict";

import { log } from "./util.js";
import { MODULE_ID } from "./const.js";

/**
 * Inject html to add controls to the drawing configuration.
 * If Levels module is active, allow the user to set drawings as holes for Area2d and Area3d.
 */
export async function renderAmbientSoundConfigHook(app, html, data) {
  const template = `modules/${MODULE_ID}/templates/elevatedvision-ambient-source-config.html`;

  const myHTML = await renderTemplate(template, data);
  log("config rendered HTML", myHTML);
  html.find("div[data-tab='position']").find(".form-group").last().after(myHTML);
}
