/* globals
canvas,
ColorPicker,
game
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";

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

  BRUSH: {
    SIZE: "brush-size",
    DEFAULT_SIZE: 100,
    MAX_SIZE: 500,
    MIN_SIZE: 1
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
  FLY_BUTTON_ENABLED: "fly-button-enabled",
  ELEVATION_MINIMUM: "elevationmin",
  ELEVATION_INCREMENT: "elevationstep",
  CHANGELOG: "changelog"
};

export function getSceneSetting(settingName, scene) {
  scene ??= canvas.scene;
  // TODO: Do we still need this?
  // if ( canvas.performance.mode === CONST.CANVAS_PERFORMANCE_MODES.LOW ) return Settings.KEYS.SHADING.NONE;
  return scene.flags[MODULE_ID]?.[settingName] ?? defaultSceneSetting(settingName);
}

export async function setSceneSetting(settingName, value, scene) {
  scene ??= canvas.scene;
  return await scene.setFlag(MODULE_ID, settingName, value);
}

export function defaultSceneSetting(value) {
  switch ( value ) {
    case Settings.KEYS.ELEVATION_MINIMUM: return Settings.get(value) ?? 0;
    case Settings.KEYS.ELEVATION_INCREMENT: return Settings.get(value) ?? 1;
    case Settings.KEYS.AUTO_ELEVATION: return Settings.get(value) ?? true;
    case Settings.KEYS.SHADING.ALGORITHM: return Settings.get(value) ?? Settings.KEYS.SHADING.TYPES.POLYGONS;
  }
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

export class Settings extends ModuleSettingsAbstract {

  /** @type {object} */
  static KEYS = SETTINGS;

  static registerAll() {
    const { KEYS, register, localize } = this;

    const STYPES = KEYS.SHADING.TYPES;
    register(KEYS.SHADING.ALGORITHM, {
      name: localize(`${KEYS.SHADING.ALGORITHM}.name`),
      hint: localize(`${KEYS.SHADING.ALGORITHM}.hint`),
      scope: "world",
      config: true,
      default: STYPES.WEBGL,
      type: String,
      requiresReload: false,
      choices: {
        [STYPES.NONE]: localize(`${STYPES.NONE}`),
        [STYPES.POLYGONS]: localize(`${STYPES.POLYGONS}`),
        [STYPES.WEBGL]: localize(`${STYPES.WEBGL}`)
      }
    });

    register(KEYS.ELEVATION_MINIMUM, {
      name: localize(`${KEYS.ELEVATION_MINIMUM}.name`),
      hint: localize(`${KEYS.ELEVATION_MINIMUM}.hint`),
      scope: "world",
      config: true,
      default: 0,
      requiresReload: false,
      type: Number
    });

    register(KEYS.ELEVATION_INCREMENT, {
      name: localize(`${KEYS.ELEVATION_INCREMENT}.name`),
      hint: localize(`${KEYS.ELEVATION_INCREMENT}.hint`),
      scope: "world",
      config: true,
      default: 5,
      requiresReload: false,
      type: Number
    });

    register(KEYS.LIGHTING.LIGHT_SIZE, {
      name: localize(`${KEYS.LIGHTING.LIGHT_SIZE}.name`),
      hint: localize(`${KEYS.LIGHTING.LIGHT_SIZE}.hint`),
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

    register(KEYS.BRUSH.SIZE, {
      name: localize(`${KEYS.BRUSH.SIZE}.name`),
      hint: localize(`${KEYS.BRUSH.SIZE}.hint`),
      scope: "world",
      config: true,
      range: {
        min: 1,
        step: 1,
        max: KEYS.BRUSH.MAX_SIZE
      },
      default: KEYS.BRUSH.DEFAULT_SIZE,
      requiresReload: false,
      type: Number
    });

    register(KEYS.AUTO_ELEVATION, {
      name: localize(`${KEYS.AUTO_ELEVATION}.name`),
      hint: localize(`${KEYS.AUTO_ELEVATION}.hint`),
      scope: "world",
      config: true,
      default: true,
      type: Boolean,
      requiresReload: false,
      onChange: reloadTokenControls
    });

    register(KEYS.FLY_BUTTON, {
      name: localize(`${KEYS.FLY_BUTTON}.name`),
      hint: localize(`${KEYS.FLY_BUTTON}.hint`),
      scope: "user",
      config: true,
      default: true,
      type: Boolean,
      requiresReload: false,
      onChange: reloadTokenControls
    });

    const ELEV_TYPES = KEYS.ELEVATION_MEASUREMENT.TYPES;
    register(KEYS.ELEVATION_MEASUREMENT.ALGORITHM, {
      name: localize(`${KEYS.ELEVATION_MEASUREMENT.ALGORITHM}.name`),
      hint: localize(`${KEYS.ELEVATION_MEASUREMENT.ALGORITHM}.hint`),
      scope: "world",
      config: true,
      default: ELEV_TYPES.POINTS_CLOSE,
      type: String,
      requiresReload: false,
      choices: {
        [ELEV_TYPES.POINT]: localize(`${ELEV_TYPES.POINT}`),
        [ELEV_TYPES.POINTS_CLOSE]: localize(`${ELEV_TYPES.POINTS_CLOSE}`),
        [ELEV_TYPES.POINTS_SPREAD]: localize(`${ELEV_TYPES.POINTS_SPREAD}`),
        [ELEV_TYPES.AVERAGE]: localize(`${ELEV_TYPES.AVERAGE}`)
      }
    });

    if ( game.modules.get("color-picker")?.active ) {
      ColorPicker.register(KEYS.COLOR.MIN, {
        name: localize(`${KEYS.COLOR.MIN}.name`),
        hint: localize(`${KEYS.COLOR.MIN}.hint`),
        scope: "world",
        config: true,
        default: KEYS.COLOR.DEFAULT_MIN,
        format: "hexa",
        mode: "HVS",
        onChange: value => canvas.elevation._elevationColorsMesh.shader.updateMinColor(value)
      });

      ColorPicker.register(KEYS.COLOR.MAX, {
        name: localize(`${KEYS.COLOR.MAX}.name`),
        hint: localize(`${KEYS.COLOR.MAX}.hint`),
        scope: "world",
        config: true,
        default: KEYS.COLOR.DEFAULT_MAX,
        format: "hexa",
        mode: "HVS",
        onChange: value => canvas.elevation._elevationColorsMesh.shader.updateMaxColor(value)
      });

    } else {
      register(KEYS.COLOR.MIN, {
        name: localize(`${KEYS.COLOR.MIN}.name`),
        hint: localize(`${KEYS.COLOR.MIN}.string_hint`),
        scope: "world",
        config: true,
        default: KEYS.COLOR.DEFAULT_MIN,
        type: String,
        requiresReload: false,
        onChange: value => canvas.elevation._elevationColorsMesh.shader.updateMinColor(value)
      });

      register(KEYS.COLOR.MAX, {
        name: localize(`${KEYS.COLOR.MAX}.name`),
        hint: localize(`${KEYS.COLOR.MAX}.string_hint`),
        scope: "world",
        config: true,
        default: KEYS.COLOR.DEFAULT_MAX,
        type: String,
        requiresReload: false,
        onChange: value => canvas.elevation._elevationColorsMesh.shader.updateMaxColor(value)
      });
    }

    register(KEYS.TEST_VISIBILITY, {
      name: localize(`${KEYS.TEST_VISIBILITY}.name`),
      hint: localize(`${KEYS.TEST_VISIBILITY}.hint`),
      scope: "world",
      config: true,
      default: true,
      requiresReload: true,
      type: Boolean
    });

    register(KEYS.LIGHTS_FULL_PENUMBRA, {
      name: localize(`${KEYS.LIGHTS_FULL_PENUMBRA}.name`),
      hint: localize(`${KEYS.LIGHTS_FULL_PENUMBRA}.hint`),
      scope: "world",
      config: true,
      default: true,
      requiresReload: true,
      type: Boolean
    });

    register(KEYS.CLOCKWISE_SWEEP, {
      name: localize(`${KEYS.CLOCKWISE_SWEEP}.name`),
      hint: localize(`${KEYS.CLOCKWISE_SWEEP}.hint`),
      scope: "world",
      config: true,
      default: false,
      requiresReload: true,
      type: Boolean
    });

    register(KEYS.FLY_BUTTON_ENABLED, {
      scope: "user",
      config: false,
      default: false,
      requiresReload: false,
      type: Boolean
    });
  }
}


