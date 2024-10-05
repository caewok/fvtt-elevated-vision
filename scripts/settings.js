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

  LIGHTING: {
    LIGHT_SIZE: "point-light-size"
  },

  TEST_VISIBILITY: "test-visibility",
  LIGHTS_FULL_PENUMBRA: "lights-full-penumbra",
  CLOCKWISE_SWEEP: "enhance-cw-sweep",
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
  }
}


