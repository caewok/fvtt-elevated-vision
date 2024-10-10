/* globals
canvas,
ColorPicker,
game
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";

export const SETTINGS = {
  SHADOWS: {
    LIGHTING: "use-shadow-lighting",
    VISION: "use-shadow-vision"
  },

  LIGHTING: {
    LIGHT_SIZE: "point-light-size"
  },

  TEST_VISIBILITY: "test-visibility",
  LIGHTS_FULL_PENUMBRA: "lights-full-penumbra",
  CHANGELOG: "changelog"
};

export function getSceneSetting(settingName, scene) {
  scene ??= canvas.scene;
  return scene.flags[MODULE_ID]?.[settingName] ?? Settings.get(settingName);
}

export async function setSceneSetting(settingName, value, scene) {
  scene ??= canvas.scene;
  return await scene.setFlag(MODULE_ID, settingName, value);
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

    register(KEYS.SHADOWS.LIGHTING, {
      name: localize(`${KEYS.SHADOWS.LIGHTING}.name`),
      hint: localize(`${KEYS.SHADOWS.LIGHTING}.hint`),
      scope: "world",
      config: true,
      default: true,
      requiresReload: true,
      type: Boolean
    });

    register(KEYS.SHADOWS.VISION, {
      name: localize(`${KEYS.SHADOWS.VISION}.name`),
      hint: localize(`${KEYS.SHADOWS.VISION}.hint`),
      scope: "world",
      config: true,
      default: true,
      requiresReload: true,
      type: Boolean
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
  }
}


