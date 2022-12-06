/* globals
*/
"use strict";

export const MODULE_ID = "elevatedvision";
export const WALL_HEIGHT_MODULE_ID = "wall-height";
export const LEVELS_MODULE_ID = "levels";
export const FLAG_ELEVATION_IMAGE = "elevationImage";

// Minimum absolute difference of floats before they are considered equal
export const EPSILON = 1e-08;

export const MODULES_ACTIVE = {
  WALL_HEIGHT: game.modules.get("wall-height")?.active,
  PERFECT_VISION: game.modules.get("perfect-vision")?.active
}
