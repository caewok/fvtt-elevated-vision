/* globals
canvas
*/
"use strict";

import { log } from "./util.js";
import { getSetting, SETTINGS } from "./settings.js";
import { CanvasPixelValueMatrix } from "./pixel_values.js";

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
  this.document.elevation = tokenGroundElevation(this, { position: this.document });

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
 * @param {object} [options]
 * @param {Point} [options.position]    Position to use for the token position.
 *   Should be a grid position (a token x,y).
 * @return {boolean}
 */
export function isTokenOnGround(token, { position } = {}) {
  const currTerrainElevation = tokenGroundElevation(token, { position });
  return currTerrainElevation.almostEqual(token.document?.elevation);
}

/**
 * Determine token elevation for a give canvas location
 * Will be either the tile elevation, if the token is on the tile, or the terrain elevation.
 * @param {Token} token
 * @param {object} [options]    Options that affect the calculation.
 * @param {Point} [options.position]          Canvas coordinates to use for token position.
 *                                            Defaults to token center.
 * @param {boolean} [options.useAveraging]    Use averaging instead of exact center point of the token.
 *                                            Defaults to SETTINGS.AUTO_AVERAGING.
 * @param {boolean} [options.considerTiles]   First consider tiles under the token?
 * @returns {number} Elevation in grid units.
 */
export function tokenGroundElevation(token, { position, useAveraging, considerTiles = true } = {}) {
  let elevation = null;
  if ( considerTiles ) elevation = tokenTileGroundElevation(token, { position, useAveraging });
  if ( elevation === null ) elevation = tokenTerrainGroundElevation(token, { position, useAveraging });
  return elevation;
}

/**
 * Determine token elevation for a give canvas location
 * Will be either the tile elevation, if the token is on the tile, or the terrain elevation.
 * @param {Token} token
 * @param {object} [options]    Options that affect the calculation.
 * @param {Point} [options.position]          Canvas coordinates to use for token position.
 *                                            Defaults to token center.
 * @param {boolean} [options.useAveraging]    se averaging instead of exact center point of the token.
 *                                            Defaults to SETTINGS.AUTO_AVERAGING.
 * @returns {number} Elevation in grid units.
 */
export function tokenTerrainGroundElevation(token, { position, useAveraging } = {}) {
  position ??= { x: token.x, y: token.y };
  useAveraging ??= getSetting(SETTINGS.AUTO_AVERAGING);

  if ( useAveraging ) return averageElevationForToken(position.x, position.y, token.w, token.h);

  const center = token.getCenter(position.x, position.y);
  return canvas.elevation.elevationAt(center.x, center.y);
}

function averageElevationForToken(x, y, w, h) {
  const tokenShape = canvas.elevation._tokenShape(x, y, w, h);
  return canvas.elevation.averageElevationWithinShape(tokenShape);
}

/**
 * Determine ground elevation of a token, taking into account tiles.
 * @param {Token} token
 * @param {object} [options]          Options that affect the tile elevation calculation
 * @param {Point} [options.position]  Position to use for the token position.
 *                                    Should be a grid position (a token x,y).
 *                                    Defaults to current token position.
 * @param {boolean} [options.useAveraging]    Token at tileE only if 50% of the token is over the tile.
 * @param {object} [options.selectedTile]     Object (can be empty) in which "tile" property will
 *                                            be set to the tile found, if any. Primarily for debugging.
 * @return {number|null} Return the tile elevation or null otherwise.
 */
export function tokenTileGroundElevation(token, { position, useAveraging = false, selectedTile = {} } = {} ) {
  position ??= { x: token.center.x, y: token.center.y };

  const tokenZ = token.bottomZ;
  const bounds = token.bounds;
  bounds.x = position.x;
  bounds.y = position.y;

  // Filter tiles that potentially serve as ground.
  const tiles = [...canvas.tiles.quadtree.getObjects(bounds)].filter(tile => {
    if ( !tile.document.isOverhead ) return false;
    const tileZ = tile.elevationZ;
    return isFinite(tileZ) && (tileZ.almostEqual(tokenZ) || tileZ < tokenZ);
  });

  // Take the tiles in order, from the top.
  // No averaging:
  // - Elevation is the highest tile that contains the position (alpha-excluded).
  // Averaging:
  // - Tile > 50% of the token shape: tileE.
  // - Tile < 50% of token shape: fall to tile below.
  // - Only non-transparent tile portions count.
  tiles.sort((a, b) => b.elevationZ - a.elevationZ);
  if ( useAveraging ) {
    let tokenShape = canvas.elevation._tokenShape(token.x, token.y, token.w, token.h);
    const targetArea = tokenShape.area * 0.5;

    for ( const tile of tiles ) {
      const mat = CanvasPixelValueMatrix.fromOverheadTileAlpha(tile);
      const intersect = mat.intersectShape(tokenShape);
      if ( intersect.areaAboveThreshold(0.99) > targetArea ) {
        selectedTile.tile = tile;
        return tile.elevationE;
      }
    }

  } else {
    for ( const tile of tiles ) {
      if ( tile.containsPixel(position.x, position.y, 0.99) ) {
        selectedTile.tile = tile;
        return tile.elevationE;
      }
    }
  }

  // No tile matches the criteria
  return null;
}
