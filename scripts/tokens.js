/* globals
canvas
*/
"use strict";

import { log } from "./util.js";
import { getSetting, SETTINGS } from "./settings.js";

/*
Adjustments for token visibility.

token cube = visibility test points for a token at bottom and top of token size
 - so if elevation is 10 and token height is 5, test points at 10 and 15

1. Testing visibility of a token
If not visible due to los/fov:
- visible if direct line of sight to token cube
- token may need to be within illuminated area or fov

*/

// Rule:
// If token elevation currently equals the terrain elevation, then assume
// moving the token should update the elevation.
// E.g. Token is flying at 30' above terrain elevation of 0'
// Token moves to 25' terrain. No auto update to elevation.
// Token moves to 35' terrain. No auto update to elevation.
// Token moves to 30' terrain. Token & terrain elevation now match.
// Token moves to 35' terrain. Auto update, b/c previously at 30' (Token "landed.")

export function _refreshToken(wrapper, options) {
  if ( !getSetting(SETTINGS.AUTO_ELEVATION) ) return wrapper(options);

  // Old position: this.position
  // New position: this.document

  // Drag starts with position set to 0, 0 (likely, not yet set).
  log(`token _refresh at ${this.document.x},${this.document.y} with elevation ${this.document.elevation} animate: ${Boolean(this._animation)}`);
  if ( !this.position.x && !this.position.y ) return wrapper(options);

  if ( !this._elevatedVision || !this._elevatedVision.tokenAdjustElevation ) return wrapper(options);

  if ( this._original ) {
    log("token _refresh is clone");
    // This token is a clone in a drag operation.
    // Adjust elevation of the clone

  } else {
    const hasAnimated = this._elevatedVision.tokenHasAnimated;
    if ( !this._animation && hasAnimated ) {
      // Reset flag on token to prevent further elevation adjustments
      this._elevatedVision.tokenAdjustElevation = false;
      return wrapper(options);
    } else if ( !hasAnimated ) this._elevatedVision.tokenHasAnimated = true;
  }

  // Adjust the elevation
  this.document.elevation = tokenElevationAt(this, this.document);

  log(`token _refresh at ${this.document.x},${this.document.y} from ${this.position.x},${this.position.y} to elevation ${this.document.elevation}`, options, this);

  return wrapper(options);
}

/**
 * Wrap Token.prototype.clone
 * Determine if the clone should adjust elevation
 */
export function cloneToken(wrapper) {
  log(`cloneToken ${this.name} at elevation ${this.document?.elevation}`);
  const clone = wrapper();

  clone._elevatedVision ??= {};
  clone._elevatedVision.tokenAdjustElevation = false; // Just a placeholder

  if ( !getSetting(SETTINGS.AUTO_ELEVATION) ) return clone;

  const tokenOrigin = { x: this.x, y: this.y };
  if ( !isTokenOnGround(this, tokenOrigin) ) return clone;

  clone._elevatedVision.tokenAdjustElevation = true;
  return clone;
}

/**
 * Determine whether a token is "on the ground", meaning that the token is in contact
 * with the ground layer according to elevation of the background terrain.
 * @param {Token} token
 * @param {Point} position    Position to use for the token position.
 *   Should be a grid position (a token x,y).
 * @return {boolean}
 */
export function isTokenOnGround(token, position) {
  const currTerrainElevation = tokenElevationAt(token, position);
  return currTerrainElevation.almostEqual(token.document?.elevation);
}

/**
 * Determine whether a token is "on a tile", meaning the token is at the elevation of the
 * bottom of a tile.
 * @param {Token} token
 * @param {Point} position    Position to use for the token position.
 *   Should be a grid position (a token x,y). Defaults to current token position.
 * @return {number|null} Return the tile elevation or null otherwise.
 */
export function tokenTileElevation(token, position = { x: token.x, y: token.y }) {
  const tokenE = token.document.elevation;
  const bounds = token.bounds;
  bounds.x = position.x;
  bounds.y = position.y;

  const tiles = canvas.tiles.quadtree.getObjects(token.bounds);
  if ( !tiles.size ) return null;

  for ( const tile of tiles ) {
    // In theory, the elevation flag should get updated if the levels bottom is changed, but...
    const tileE = tile.document.flags?.elevatedvision?.elevation
      ?? tile.document.flags?.levels?.rangeBottom ?? Number.NEGATIVE_INFINITY;
    if ( isFinite(tileE) && tokenE.almostEqual(tileE) ) return tileE;
  }
  return null;
}

/**
 * Determine token elevation for a give grid position.
 * Will be either the tile elevation, if the token is on the tile, or the terrain elevation.
 * @param {Token} token
 * @param {Point} position     Position to use for the token position.
 *   Should be a grid position (a token x,y).
 * @param {object} [options]
 * @param {boolean} [useAveraging]    Use averaging versus use the exact center point of the token at the position.
 *   Defaults to the GM setting.
 * @param {boolean} [considerTiles]   If false, skip testing tile elevations; return the underlying terrain elevation.
 * @returns {number} Elevation in grid units.
 */
export function tokenElevationAt(token, position, {
  useAveraging = getSetting(SETTINGS.AUTO_AVERAGING),
  considerTiles = true } = {}) {

  if ( considerTiles ) {
    const tileE = tokenTileElevation(token, position);
    if ( tileE !== null ) return tileE;
  }

  if ( useAveraging ) return averageElevationForToken(position.x, position.y, token.w, token.h);

  const center = token.getCenter(position.x, position.y);
  return canvas.elevation.elevationAt(center.x, center.y);
}

function averageElevationForToken(x, y, w, h) {
  const tokenShape = canvas.elevation._tokenShape(x, y, w, h);
  return canvas.elevation.averageElevationWithinShape(tokenShape);
}
