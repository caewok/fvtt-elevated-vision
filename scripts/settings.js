/* globals
game
*/
"use strict";

import { log } from "./util.js";
import { MODULE_ID } from "./const.js";

export const SETTINGS = {
  VISION_USE_SHADER: "vision-use-shader",
  AUTO_ELEVATION: "auto-change-elevation"
};

export function getSetting(settingName) {
  return game.settings.get(MODULE_ID, settingName);
}

export async function toggleSetting(settingName) {
  const curr = getSetting(settingName);
  return await game.settings.set(MODULE_ID, settingName, !curr);
}

export async function setSetting(settingName, value) {
  return await game.settings.set(MODULE_ID, settingName, value);
}

export function registerSettings() {
  log("Registering elevated vision settings");

  game.settings.register(MODULE_ID, SETTINGS.VISION_USE_SHADER, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.VISION_USE_SHADER}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.VISION_USE_SHADER}.hint`),
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
    requiresReload: true
  });

  game.settings.register(MODULE_ID, SETTINGS.AUTO_ELEVATION, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.AUTO_ELEVATION}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.AUTO_ELEVATION}.hint`),
    scope: "world",
    config: true,
    default: true,
    type: Boolean,
    requiresReload: false
  });
}
