/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { TilePixelCache } from "./PixelCache.js";

export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * Getter for Tile.mesh._evPixelCache
 */
export function evPixelCache() {
  return this._evPixelCache || (this._evPixelCache = TilePixelCache.fromOverheadTileAlpha(this));
}

PATCHES.BASIC.GETTERS = { evPixelCache };

/**
 * Resize tile cache on dimension change; reset the transform matrix for local coordinates
 * on other changes. Wipe the cache if the overhead status changes.
 * TODO: Is it possible to keep the cache when overhead status changes?
 */
export function updateTileHook(document, change, _options, _userId) {
  if ( change.overhead ) document.object._evPixelCache = undefined;
  const cache = document.object._evPixelCache;
  if ( !cache ) return;

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

PATCHES.BASIC.HOOKS = { updateTile: updateTileHook };
