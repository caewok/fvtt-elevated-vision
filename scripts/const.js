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
  BLOCKS_VISION: "blocksVision",
  ELEVATION_IMAGE: "elevationImage",
  ELEVATION: "elevation",
  LIGHT_SIZE: "lightSize",
  DIRECTIONAL_LIGHT: {
    ENABLED: "directionalLight",
    SOLAR_ANGLE: "solarAngle"
  },
  ELEVATION_MEASUREMENT: {
    ALGORITHM: "elevationMeasurement",
    TYPES: {
      POINT: "elevation_point",
      POINTS_CLOSE: "elevation_points_close",
      POINTS_SPREAD: "elevation_points_spread",
      AVERAGE: "elevation_average"
    },
    LABELS: {
      elevation_point: "elevatedvision.tokenconfig.elevation-algorithm.elevation_point",
      elevation_points_close: "elevatedvision.tokenconfig.elevation-algorithm.elevation_points_close",
      elevation_points_spread: "elevatedvision.tokenconfig.elevation-algorithm.elevation_points_spread",
      elevation_average: "elevatedvision.tokenconfig.elevation-algorithm.elevation_average"
    }
  }
};

export const TEMPLATES = {
  TOKEN: `modules/${MODULE_ID}/templates/token-config.html`,
  AMBIENT_SOURCE: `modules/${MODULE_ID}/templates/ambient-source-config.html`,
  AMBIENT_SOURCE_PARTIAL: `modules/${MODULE_ID}/templates/ambient-source-config-partial.html`,
  ELEVATION_STEP: `modules/${MODULE_ID}/templates/elevation-step-controls.html`,
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
