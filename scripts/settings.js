/* globals
canvas,
ColorPicker,
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
      "shading-webgl": `${MODULE_ID}.shading-webgl`
    }
  },

  COLOR: {
    MIN: "color-min",
    MAX: "color-max",
    DEFAULT_MIN: "#03000003",
    DEFAULT_MAX: "#80000080"
  },

  LIGHTING: {
    LIGHT_SIZE: "point-light-size"
  },

  ELEVATION_MEASUREMENT: {
    ALGORITHM: "elevation-measurement",
    TYPES: {
      POINT: "elevation_point",
      POINTS_CLOSE: "elevation_points_close",
      POINTS_SPREAD: "elevation_points_spread",
      AVERAGE: "elevation_average"
    }
  },

  TEST_VISIBILITY: "test-visibility",
  LIGHTS_FULL_PENUMBRA: "lights-full-penumbra",
  // VISION_USE_SHADER: "vision-use-shader",  // Deprecated
  AUTO_ELEVATION: "auto-change-elevation",
  // AUTO_AVERAGING: "auto-change-elevation.averaging", // Deprecated
  CLOCKWISE_SWEEP: "enhance-cw-sweep",
  FLY_BUTTON: "add-fly-button",
  ELEVATION_MINIMUM: "elevationmin",
  ELEVATION_INCREMENT: "elevationstep",
  CHANGELOG: "changelog"
};

export function getSetting(settingName) {
  return game.settings.get(MODULE_ID, settingName);
}

export async function setSetting(settingName, value) {
  return await game.settings.set(MODULE_ID, settingName, value);
}

export function getSceneSetting(settingName, scene) {
  scene ??= canvas.scene;
  // TODO: Do we still need this?
  // if ( canvas.performance.mode === CONST.CANVAS_PERFORMANCE_MODES.LOW ) return SETTINGS.SHADING.NONE;
  return scene.flags[MODULE_ID]?.[settingName] ?? defaultSceneSetting(settingName);
}

export async function setSceneSetting(settingName, value, scene) {
  scene ??= canvas.scene;
  return await scene.setFlag(MODULE_ID, settingName, value);
}

export function defaultSceneSetting(value) {
  switch ( value ) {
    case SETTINGS.ELEVATION_MINIMUM: return getSetting(value) ?? 0;
    case SETTINGS.ELEVATION_INCREMENT: return getSetting(value) ?? 1;
    case SETTINGS.AUTO_ELEVATION: return getSetting(value) ?? true;
    case SETTINGS.SHADING.ALGORITHM: return getSetting(value) ?? SETTINGS.SHADING.TYPES.POLYGONS;
  }
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

  game.settings.register(MODULE_ID, SETTINGS.LIGHTING.LIGHT_SIZE, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.LIGHTING.LIGHT_SIZE}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.LIGHTING.LIGHT_SIZE}.hint`),
    scope: "world",
    config: true,
    range: {
      min: 0,
      step: 1
    },
    default: 0,
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

  const ELEV_TYPES = SETTINGS.ELEVATION_MEASUREMENT.TYPES;
  game.settings.register(MODULE_ID, SETTINGS.ELEVATION_MEASUREMENT.ALGORITHM, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.ELEVATION_MEASUREMENT.ALGORITHM}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.ELEVATION_MEASUREMENT.ALGORITHM}.hint`),
    scope: "world",
    config: true,
    default: ELEV_TYPES.POINTS_CLOSE,
    type: String,
    requiresReload: false,
    choices: {
      [ELEV_TYPES.POINT]: game.i18n.localize(`${MODULE_ID}.settings.${ELEV_TYPES.POINT}`),
      [ELEV_TYPES.POINTS_CLOSE]: game.i18n.localize(`${MODULE_ID}.settings.${ELEV_TYPES.POINTS_CLOSE}`),
      [ELEV_TYPES.POINTS_SPREAD]: game.i18n.localize(`${MODULE_ID}.settings.${ELEV_TYPES.POINTS_SPREAD}`),
      [ELEV_TYPES.AVERAGE]: game.i18n.localize(`${MODULE_ID}.settings.${ELEV_TYPES.AVERAGE}`)
    }
  });

  if ( game.modules.get("color-picker")?.active ) {
    ColorPicker.register(MODULE_ID, SETTINGS.COLOR.MIN, {
      name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.COLOR.MIN}.name`),
      hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.COLOR.MIN}.hint`),
      scope: "world",
      config: true,
      default: SETTINGS.COLOR.DEFAULT_MIN,
      format: "hexa",
      mode: "HVS",
      onChange: value => canvas.elevation._elevationColorsMesh.shader.updateMinColor(value)
    });

    ColorPicker.register(MODULE_ID, SETTINGS.COLOR.MAX, {
      name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.COLOR.MAX}.name`),
      hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.COLOR.MAX}.hint`),
      scope: "world",
      config: true,
      default: SETTINGS.COLOR.DEFAULT_MAX,
      format: "hexa",
      mode: "HVS",
      onChange: value => canvas.elevation._elevationColorsMesh.shader.updateMaxColor(value)
    });

  } else {
    game.settings.register(MODULE_ID, SETTINGS.COLOR.MIN, {
      name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.COLOR.MIN}.name`),
      hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.COLOR.MIN}.string_hint`),
      scope: "world",
      config: true,
      default: SETTINGS.COLOR.DEFAULT_MIN,
      type: String,
      requiresReload: false,
      onChange: value => canvas.elevation._elevationColorsMesh.shader.updateMinColor(value)
    });

    game.settings.register(MODULE_ID, SETTINGS.COLOR.MAX, {
      name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.COLOR.MAX}.name`),
      hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.COLOR.MAX}.string_hint`),
      scope: "world",
      config: true,
      default: SETTINGS.COLOR.DEFAULT_MAX,
      type: String,
      requiresReload: false,
      onChange: value => canvas.elevation._elevationColorsMesh.shader.updateMaxColor(value)
    });
  }

  game.settings.register(MODULE_ID, SETTINGS.TEST_VISIBILITY, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.TEST_VISIBILITY}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.TEST_VISIBILITY}.hint`),
    scope: "world",
    config: true,
    default: true,
    requiresReload: true,
    type: Boolean
  });

  game.settings.register(MODULE_ID, SETTINGS.LIGHTS_FULL_PENUMBRA, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.LIGHTS_FULL_PENUMBRA}.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.LIGHTS_FULL_PENUMBRA}.hint`),
    scope: "world",
    config: true,
    default: true,
    requiresReload: true,
    type: Boolean
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
