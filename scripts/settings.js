/* globals
game
*/
"use strict";

import { log } from "./util.js";
import { MODULE_ID } from "./const.js";

export const SETTINGS = {
  SHADING: {
    ALGORITHM: "shading-algorithm",
    TYPES: {
      NONE: "shading-none",
      POLYGONS: "shading-polygons",
      WEBGL: "shading-webgl"
    }
  },

  VISION_USE_SHADER: "vision-use-shader",  // Deprecated
  AUTO_ELEVATION: "auto-change-elevation",
  AUTO_AVERAGING: "auto-change-elevation.averaging",
  CLOCKWISE_SWEEP: "enhance-cw-sweep",

  WELCOME_DIALOG: {
    v020: "welcome-dialog-v0-20"
  }
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

  const STYPES = SETTINGS.SHADING.TYPES;

  // The old value was a boolean to turn on WebGL.
  // New default should be polygons unless WebGL is expressly turned on.
  const prior_setting = [...game.settings.storage.get("world").values()].find(v => v.key === `${MODULE_ID}.${SETTINGS.VISION_USE_SHADER}`);
  const prior_default = prior_setting?.value ? STYPES.WEBGL : STYPES.POLYGONS;

  game.settings.register(MODULE_ID, SETTINGS.SHADING.ALGORITHM, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.SHADING.ALGORITHM}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.SHADING.ALGORITHM}.hint`),
    scope: "world",
    config: true,
    default: prior_default,
    type: String,
    requiresReload: true,
    choices: {
      [STYPES.NONE]: game.i18n.localize(`${MODULE_ID}.settings.${STYPES.NONE}`),
      [STYPES.POLYGONS]: game.i18n.localize(`${MODULE_ID}.settings.${STYPES.POLYGONS}`),
      [STYPES.WEBGL]: game.i18n.localize(`${MODULE_ID}.settings.${STYPES.WEBGL}`)
    }
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

  game.settings.register(MODULE_ID, SETTINGS.AUTO_AVERAGING, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.AUTO_AVERAGING}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.AUTO_AVERAGING}.hint`),
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
    requiresReload: false
  });

  game.settings.register(MODULE_ID, SETTINGS.CLOCKWISE_SWEEP, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.CLOCKWISE_SWEEP}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.CLOCKWISE_SWEEP}.hint`),
    scope: "world",
    config: false,
    default: false,
    requiresReload: true,
    type: Boolean
  })

  game.settings.register(MODULE_ID, SETTINGS.WELCOME_DIALOG.v020, {
    scope: "world",
    config: false,
    default: false,
    type: Boolean
  });


}
