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
    },
    LABELS: {
      "shading-none": `${MODULE_ID}.shading-none`,
      "shading-polygons": `${MODULE_ID}.shading-polygons`,
      "shading-webgl": `${MODULE_ID}.shading-webgl`,
    }
  },

  VISION_USE_SHADER: "vision-use-shader",  // Deprecated
  AUTO_ELEVATION: "auto-change-elevation",
  AUTO_AVERAGING: "auto-change-elevation.averaging",
  CLOCKWISE_SWEEP: "enhance-cw-sweep",
  FLY_BUTTON: "add-fly-button",
  ELEVATION_MINIMUM: "elevationmin",
  ELEVATION_INCREMENT: "elevationstep",

  WELCOME_DIALOG: {
    v020: "welcome-dialog-v0-20"
  }
};

export function getSetting(settingName) {
  return game.settings.get(MODULE_ID, settingName);
}

export async function setSetting(settingName, value) {
  return await game.settings.set(MODULE_ID, settingName, value);
}

export function getSceneSetting(settingName) {
  return canvas.scene.flags[MODULE_ID]?.[settingName];
}

export async function setSceneSetting(settingName, value) {
  return await canvas.scene.setFlag(MODULE_ID, settingName, value);
}


export function registerSettings() {
  log("Registering elevated vision settings");

  const STYPES = SETTINGS.SHADING.TYPES;
  game.settings.register(MODULE_ID, SETTINGS.SHADING.ALGORITHM, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.SHADING.ALGORITHM}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.SHADING.ALGORITHM}.hint`),
    scope: "world",
    config: true,
    default: STYPES.WEBGL,
    type: String,
    requiresReload: false,
    choices: {
      [STYPES.NONE]: game.i18n.localize(`${MODULE_ID}.settings.${STYPES.NONE}`),
      [STYPES.POLYGONS]: game.i18n.localize(`${MODULE_ID}.settings.${STYPES.POLYGONS}`),
      [STYPES.WEBGL]: game.i18n.localize(`${MODULE_ID}.settings.${STYPES.WEBGL}`)
    }
  });

  game.settings.register(MODULE_ID, SETTINGS.ELEVATION_MINIMUM, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.ELEVATION_MINIMUM}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.ELEVATION_MINIMUM}.hint`),
    scope: "world",
    config: true,
    default: 0,
    requiresReload: false,
    type: Number
  });

  game.settings.register(MODULE_ID, SETTINGS.ELEVATION_INCREMENT, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.ELEVATION_INCREMENT}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.ELEVATION_INCREMENT}.hint`),
    scope: "world",
    config: true,
    default: 5,
    requiresReload: false,
    type: Number
  });

  game.settings.register(MODULE_ID, SETTINGS.AUTO_ELEVATION, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.AUTO_ELEVATION}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.AUTO_ELEVATION}.hint`),
    scope: "world",
    config: true,
    default: true,
    type: Boolean,
    requiresReload: false,
    onChange: reloadTokenControls
  });

  game.settings.register(MODULE_ID, SETTINGS.FLY_BUTTON, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.FLY_BUTTON}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.FLY_BUTTON}.hint`),
    scope: "user",
    config: true,
    default: true,
    type: Boolean,
    requiresReload: false,
    onChange: reloadTokenControls
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
    config: true,
    default: false,
    requiresReload: true,
    type: Boolean
  });


  game.settings.register(MODULE_ID, SETTINGS.WELCOME_DIALOG.v020, {
    scope: "world",
    config: false,
    default: false,
    type: Boolean
  });
}

/**
 * Force a reload of token controls layer.
 * Used to force the added control to appear/disappear.
 */
export function reloadTokenControls() {
  if ( !canvas.tokens.active ) return;
  canvas.tokens.deactivate();
  canvas.tokens.activate();
}

/**
 * Get setting to average tiles
 * @returns {number} 0 if not averaging; 1+ for testing every N pixels for average.
 */
export function averageTilesSetting() {
  return getSetting(SETTINGS.AUTO_AVERAGING) ? (CONFIG[MODULE_ID]?.averageTiles ?? 1) : 0;
}

/**
 * Get setting to average terrain
 * @returns {number} 0 if not averaging; 1+ for testing every N pixels for average.
 */
export function averageTerrainSetting() {
  return getSetting(SETTINGS.AUTO_AVERAGING) ? (CONFIG[MODULE_ID]?.averageTerrain ?? 1) : 0;
}
