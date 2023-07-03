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
  DIRECTIONAL_LIGHT: "directionalLight"
}

// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  MODULES_ACTIVE.WALL_HEIGHT = game.modules.get("wall-height")?.active;
  MODULES_ACTIVE.PERFECT_VISION = game.modules.get("perfect-vision")?.active;
});
