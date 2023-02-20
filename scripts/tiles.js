/* globals
Hooks,
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { TilePixelCache } from "./PixelCache.js";

// Hook when a tile changes elevation or dimensions.
// Track dimensions for the tile cache.
// Link tile elevation to Levels tile elevation.
Hooks.on("preUpdateTile", preUpdateTileHook);
Hooks.on("updateTile", updateTileHook);

/**
 * If Levels tile elevation changes, set EV elevation flag or vice-versa.
 * Prefer Levels elevation.
 */
function preUpdateTileHook(document, changes, _options, _userId) {
  const updateData = {};
  if ( changes.flags?.levels?.rangeBottom ) updateData[`flags.${MODULE_ID}.elevation`] = changes.flags.levels.rangeBottom;
  else if ( changes.flags?.[MODULE_ID]?.elevation) updateData["flags.levels.rangeBottom"] = changes.flags[MODULE_ID].elevation;
  foundry.utils.mergeObject(changes, updateData, {inplace: true});
}

/**
 * Resize tile cache on dimension change; reset the transform matrix for local coordinates
 * on other changes.
 */
function updateTileHook(document, change, _options, _userId) {
  if ( change.overhead ) {
    document.object._textureData._evPixelCache = TilePixelCache.fromOverheadTileAlpha(document.object);
  } else if ( document.overhead ) {
    const cache = document.object._textureData._evPixelCache;

    if ( Object.hasOwn(change, "x")
      || Object.hasOwn(change, "y")
      || Object.hasOwn(change, "width")
      || Object.hasOwn(change, "height") ) {
      cache._resize();
    }

    if ( Object.hasOwn(change, "rotation")
      || Object.hasOwn(change, "texture")
      || (change.texture
        && (Object.hasOwn(change.texture, "scaleX")
        || Object.hasOwn(change.texture, "scaleY"))) ) {

      cache.clearTransforms();
    }
  }
}
