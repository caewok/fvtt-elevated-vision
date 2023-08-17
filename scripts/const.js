/* globals
*/
"use strict";

export const MODULE_ID = "elevatedvision";
export const WALL_HEIGHT_MODULE_ID = "wall-height";
export const LEVELS_MODULE_ID = "levels";

// Minimum absolute difference of floats before they are considered equal
export const EPSILON = 1e-08;

export const MODULES_ACTIVE = {
  WALL_HEIGHT: false,
  PERFECT_VISION: false
};

export const FLAGS = {
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
      "elevation_point": "elevatedvision.tokenconfig.elevation-algorithm.elevation_point",
      "elevation_points_close": "elevatedvision.tokenconfig.elevation-algorithm.elevation_points_close",
      "elevation_points_spread": "elevatedvision.tokenconfig.elevation-algorithm.elevation_points_spread",
      "elevation_average": "elevatedvision.tokenconfig.elevation-algorithm.elevation_average"
    }
  }
};

export const TEMPLATES = {
  TOKEN: `modules/${MODULE_ID}/templates/${MODULE_ID}-token-config.html`,
  AMBIENT_SOURCE: `modules/${MODULE_ID}/templates/${MODULE_ID}-ambient-source-config.html`,
  TILE: `modules/${MODULE_ID}/templates/${MODULE_ID}-tile-config.html`,
  ELEVATION_STEP: `modules/${MODULE_ID}/templates/elevation-step-controls.html`,
  SCENE: `modules/${MODULE_ID}/templates/scene-elevation-config.html`
}

// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  MODULES_ACTIVE.WALL_HEIGHT = game.modules.get("wall-height")?.active;
  MODULES_ACTIVE.PERFECT_VISION = game.modules.get("perfect-vision")?.active;
});
