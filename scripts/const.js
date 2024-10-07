/* globals
game,
Hooks
*/
"use strict";

export const MODULE_ID = "elevatedvision";
export const WALL_HEIGHT_MODULE_ID = "wall-height";
export const LEVELS_MODULE_ID = "levels";

// Minimum absolute difference of floats before they are considered equal
export const EPSILON = 1e-08;

export const FLAGS = {
  BLOCKS_VISION: "blocksVision",  // For regions
  LIGHT_SIZE: "lightSize",  // How large is this light for purposes of penumbra
  DIRECTIONAL_LIGHT: {
    ENABLED: "directionalLight",
    SOLAR_ANGLE: "solarAngle"
  }
};

export const TEMPLATES = {
  AMBIENT_SOURCE: `modules/${MODULE_ID}/templates/ambient-source-config.html`,
  AMBIENT_SOURCE_PARTIAL: `modules/${MODULE_ID}/templates/ambient-source-config-partial.html`,
  SCENE: `modules/${MODULE_ID}/templates/scene-elevation-config.html`,
  REGION: `modules/${MODULE_ID}/templates/region-config.html`
};

// Icons displayed in config tabs.
export const ICONS = {
  MODULE: "fa-solid fa-hurricane"
};

// Track certain modules that complement features of this module.
export const OTHER_MODULES = {
  TERRAIN_MAPPER: { ACTIVE: false, KEY: "terrainmapper", BACKGROUND_ELEVATION: "backgroundElevation" }
};

// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  for ( const obj of Object.values(OTHER_MODULES) ) obj.ACTIVE = game.modules.get(obj.KEY)?.active;
});
