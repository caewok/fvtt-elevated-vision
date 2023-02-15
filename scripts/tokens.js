/* globals
canvas,
Ray,
PIXI,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { log } from "./util.js";
import { MODULE_ID } from "./const.js";
import { getSetting, getSceneSetting, SETTINGS } from "./settings.js";
import { CanvasPixelValueMatrix } from "./pixel_values.js";
import { Draw } from "./geometry/Draw.js";


/* Token movement flow:

I. Arrow keys:

1. preUpdateToken hook (args: tokenDoc, changes obj, {diff: true, render: true}, id)
2. token.prototype._refresh (animate: false)
3. (2) may repeat
4. refreshToken hook (args: token, empty object)
5. updateToken hook (args: tokenDoc, changes obj, {diff: true, render: true}, id)

6. token.prototype._refresh (animate: true)
7. refreshToken hook (args: token,  {bars: false, border: true, effects: false, elevation: false, nameplate: false})
8. (6) and (7) may repeat, a lot. In between, lighting and sight updated

II. Dragging:

1. token.prototype.clone
2. token.prototype._refresh (animate: false)
3. refreshToken hook (args: token, empty object)
4. token.prototype._refresh (animate: false, clone)
5. refreshToken hook (args: token, empty object) (token is probably the clone)
(this cycle repeats for awhile)
...
6. destroyToken hook (args: token) (token is probably the clone)
7. token.prototype._refresh (animate: false)
8. preUpdateToken hook (args: tokenDoc, changes obj, {diff: true, render: true}, id)
9. sight & lighting refresh
10. token.prototype._refresh (animate: false) (this is the entire dragged move, origin --> destination)
11. refreshToken hook (args: token, empty object)
12. updateToken hook (args: tokenDoc, changes obj, {diff: true, render: true}, id)

13. token.prototype._refresh (animate: true) (increments vary)
14.refreshToken hook (args: token,  {bars: false, border: true, effects: false, elevation: false, nameplate: false})
15. (13) and (14) may repeat, a lot. In between, lighting and sight updated

*/

/* Token move segment elevation
What is needed in order to tell final token elevation in a line from origin --> destination?
Assume a token that walks "off" a tile is now "flying" and stops elevation changes.

1. If token origin is not on the ground, no automated elevation changes.

2. If no tiles present in the line, this is easy: token changes elevation.

3. Tile(s) present. For each tile:
Line through tile.
Start elevation is the point immediately prior to the tile start on the line.
If tile is above start elevation, ignore.
Each pixel of the tile on the line:
- If transparent, automation stops unless ground at this point is at or above tile.
- If terrain above, current elevation changes. Check for new tiles between this point and destination.

Probably need:
a. Terrain elevation array for a given line segment.
b. Tile alpha array for a given line segment.
c. Tile - line segment intersection; get ground and tile elevation at that point.
d. Locate tiles along a line segment, and filter according to elevations.
*/

// Automatic elevation Rule:
// If token elevation currently equals the terrain elevation, then assume
// moving the token should update the elevation.
// E.g. Token is flying at 30' above terrain elevation of 0'
// Token moves to 25' terrain. No auto update to elevation.
// Token moves to 35' terrain. No auto update to elevation.
// Token moves to 30' terrain. Token & terrain elevation now match.
// Token moves to 35' terrain. Auto update, b/c previously at 30' (Token "landed.")


/*
Fly-mode:
Origination   Destination   Lower       Same (§)    Higher
terrain       terrain       fly         terrain     terrain
terrain       tile          fly         tile        NA (stays on origination terrain)
tile          tile          fly         tile        NA (stays on origination tile)
tile          terrain       fly         terrain     terrain
fly           terrain       fly         terrain     terrain

No-fly-mode:
Origination   Destination   Lower       Same (§)    Higher
terrain       terrain       terrain     terrain     terrain
terrain       tile          tile        tile        NA (stays on origination terrain)
tile          tile          tile        tile        NA (stays on origination tile)
tile          terrain       terrain     terrain     terrain

§ Within 1 elevation unit in either direction, treated as Same.
*/

/*
Programming by testing a position for the token:
- Need to know the straight-line path taken.
- Locate tile-terrain intersections and tile-tile intersections.
- At each intersection, pick terrain or tile. Remember the tile elevation.
- If fly is enabled, can pick "fly" as the third transition. Remember fly elevation

Animating for any given location:
- Check against segment spans. Point between:
  - tile: use tile elevation
  - terrain: get current terrain elevation
  - fly: use fly elevation
*/

/**
 * Wrap Token.prototype._refresh
 * Adjust elevation as the token moves.
 */
export function _refreshToken(wrapper, options) {
  if ( !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return wrapper(options);

  // Old position: this.position
  // New position: this.document

  // Drag starts with position set to 0, 0 (likely, not yet set).
  log(`token _refresh at ${this.document.x},${this.document.y} (center ${this.center.x},${this.center.y}) with elevation ${this.document.elevation} animate: ${Boolean(this._animation)}`);
  if ( !this.position.x && !this.position.y ) return wrapper(options);

  const ev = this._elevatedVision;
  if ( !ev || !ev.tokenAdjustElevation ) return wrapper(options);

  if ( this._original ) {
    log("token _refresh is clone.");
    // This token is a clone in a drag operation.
    // Adjust elevation of the clone by calculating the elevation from origin to line.
    const { tokenCenter, tokenElevation } = ev;
    const travelRay = new Ray(tokenCenter, this.center);
    const travel = elevationForTokenTravel(this, travelRay, { tokenElevation });
    log(`{x: ${travelRay.A.x}, y: ${travelRay.A.y}, e: ${tokenElevation} } --> {x: ${travelRay.B.x}, y: ${travelRay.B.y}, e: ${travel.finalElevation} }`, travel);
    this.document.elevation = travel.finalElevation;

  } else if ( this._animation ) {
  //   const hasAnimated = ev.tokenHasAnimated;
//     if ( !this._animation && hasAnimated ) {
//       // Reset flag on token to prevent further elevation adjustments
//       ev.tokenAdjustElevation = false;
//       return wrapper(options);
//     } else if ( !hasAnimated ) ev.tokenHasAnimated = true;

    // Adjust the elevation as the token is moved by locating where we are on the travel ray.
    const tokenCenter = this.center;
    const { travelRay, elevationChanges } = ev.travel;
    const currT = travelRay.tConversion(tokenCenter);
    const ln = elevationChanges.length;
    let change = elevationChanges[ln - 1];
    for ( let i = 1; i < ln; i += 1 ) {
     if ( elevationChanges[i].ix.t0 > currT ) {
       change = elevationChanges[i-1];
       break;
     }
    }

    change ??= { currState: TOKEN_ELEVATION_STATE.TERRAIN };
    if ( change.currState === TOKEN_ELEVATION_STATE.TERRAIN )
      change.currE = tokenTerrainElevation(this, { tokenCenter });

    options.elevation ||= this.document.elevation !== change.currE;

    this.document.elevation = change.currE;
    log(`{x: ${tokenCenter.x}, y: ${tokenCenter.y}, e: ${change.currE} }`, ev.travel);
  }

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

  if ( !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return clone;

  const tokenCenter = { x: this.center.x, y: this.center.y };
  if ( !isTokenOnGround(this, { tokenCenter }) && !autoElevationFly() ) return clone;

  clone._elevatedVision.tokenAdjustElevation = true;
  clone._elevatedVision.tokenCenter = tokenCenter;
  clone._elevatedVision.tokenElevation = this.bottomE;
  return clone;
}

/**
 * Determine whether a token is "on the ground", meaning that the token is in contact
 * with the ground layer according to elevation of the background terrain.
 * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
 * @param {object} [options]  Options that affect the calculation
 * @param {Point} [options.tokenCenter]       Canvas coordinates to use for token center
 * @param {boolean} [options.useAveraging]    Use averaging instead of exact center point of the token.
 *                                            Defaults to SETTINGS.AUTO_AVERAGING.
 * @param {boolean} [options.considerTiles]   First consider tiles under the token?
 * @return {boolean}
 */
export function isTokenOnGround(token, { tokenCenter, tokenElevation, useAveraging, considerTiles } = {}) {
  tokenElevation ??= token.bottomE;
  const currTerrainElevation = tokenGroundElevation(token,
    { tokenCenter, tokenElevation, useAveraging, considerTiles });
  return currTerrainElevation.almostEqual(tokenElevation);
}

export function isTokenOnTerrain(token, { tokenCenter, tokenElevation, useAveraging, considerTiles = true } = {}) {
  if ( considerTiles && isTokenOnTile(token, { tokenCenter, tokenElevation, useAveraging }) ) return false;
  return isTokenOnGround(token, { tokenCenter, useAveraging, considerTiles: false });
}

/**
 * Determine whether a token is on a tile, meaning the token is in contact with the tile.
 * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
 * @param {object} [options]  Options that affect the calculation
 * @param {Point} [options.tokenCenter]       Canvas coordinates to use for token top center.
 * @param {boolean} [options.useAveraging]    Use averaging instead of exact center point of the token.
 *                                            Defaults to SETTINGS.AUTO_AVERAGING.
 * @param {boolean} [options.considerTiles]   First consider tiles under the token?
 * @return {boolean}
 */
export function isTokenOnTile(token, { tokenCenter, tokenElevation, useAveraging }) {
  tokenElevation ??= token.bottomE;
  const tileElevation = tokenTileElevation(token, { tokenCenter, tokenElevation, useAveraging, checkTopOnly: true });
  return tileElevation !== null && tileElevation.almostEqual(tokenElevation);
}

/**
 * Determine token elevation for a give canvas location
 * Will be either the tile elevation, if the token is on the tile, or the terrain elevation.
 * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
 * @param {object} [options]  Options that affect the calculation.
 * @param {Point} [options.tokenCenter]       Canvas coordinates to use for token center
 * @param {boolean} [options.useAveraging]    Use averaging instead of exact center point of the token.
 *                                            Defaults to SETTINGS.AUTO_AVERAGING.
 * @param {boolean} [options.considerTiles]   First consider tiles under the token?
 * @returns {number} Elevation in grid units.
 */
export function tokenGroundElevation(token, { tokenCenter, tokenElevation, useAveraging, considerTiles = true } = {}) {
  let elevation = null;
  if ( considerTiles ) elevation = tokenTileElevation(token, { tokenCenter, tokenElevation, useAveraging });

  // If the terrain is above the tile, use the terrain elevation. (Math.max(null, 5) returns 5.)
  return Math.max(elevation, tokenTerrainElevation(token, { tokenCenter, useAveraging }));
}

/**
 * Determine token elevation for a give canvas location
 * Will be either the tile elevation, if the token is on the tile, or the terrain elevation.
 * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
 * @param {object} [options]  Options that affect the calculation.
 * @param {Point} [options.tokenCenter]       Canvas coordinates to use for token center.
 * @param {boolean} [options.useAveraging]    se averaging instead of exact center point of the token.
 *                                            Defaults to SETTINGS.AUTO_AVERAGING.
 * @returns {number} Elevation in grid units.
 */
export function tokenTerrainElevation(token, { tokenCenter, useAveraging } = {}) {
  useAveraging ??= getSetting(SETTINGS.AUTO_AVERAGING);
  tokenCenter ??= token.center;
  if ( useAveraging ) return averageElevationForTokenShape(
    token.getTopLeft(tokenCenter.x, tokenCenter.y), token.w, token.h);
  return canvas.elevation.elevationAt(tokenCenter);
}

/**
 * Determine if token elevation should be preferred
 * @returns {boolean}
 */
export function autoElevationFly() {
  if ( !getSetting(SETTINGS.FLY_BUTTON) ) return false;
  const token_controls = ui.controls.controls.find(elem => elem.name === "token");
  const fly = token_controls.tools.find(elem => elem.name === SETTINGS.FLY_BUTTON);
  return fly.active;
}


function averageElevationForTokenShape(tokenTLCorner, w, h) {
  const tokenShape = canvas.elevation._tokenShape(tokenTLCorner, w, h);
  return canvas.elevation.averageElevationWithinShape(tokenShape);
}

/**
 * Determine ground elevation of a token, taking into account tiles.
 * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
 * @param {object} [options]  Options that affect the tile elevation calculation
 * @param {Point} [options.tokenCenter]       Position to use for the token center.
 * @param {boolean} [options.useAveraging]    Token at tileE only if 50% of the token is over the tile.
 * @param {object} [options.selectedTile]     Object (can be empty) in which "tile" property will
 *                                            be set to the tile found, if any. Primarily for debugging.
 * @param {boolean} [options.checkTopOnly]    Should all tiles under the token be checked, or only the top-most tile?
 * @return {number|null} Return the tile elevation or null otherwise.
 */
export function tokenTileElevation(token,
  { tokenCenter, tokenElevation, useAveraging, selectedTile = {}, checkTopOnly = false } = {} ) {
  tokenCenter ??= token.center;
  useAveraging ??= getSetting(SETTINGS.AUTO_AVERAGING);
  tokenElevation ??= token.bottomE;

  const bounds = token.bounds;
  const tokenTL = token.getTopLeft(tokenCenter.x, tokenCenter.y);
  bounds.x = tokenTL.x;
  bounds.y = tokenTL.y;

  // Filter tiles that potentially serve as ground.
  let tiles = [...canvas.tiles.quadtree.getObjects(bounds)].filter(tile => {
    if ( !tile.document.overhead ) return false;
    const tileE = tile.elevationE;
    return isFinite(tileE) && (tileE.almostEqual(tokenElevation) || tileE < tokenElevation);
  });
  if ( !tiles.length ) return null;

  // Take the tiles in order, from the top.
  // No averaging:
  // - Elevation is the highest tile that contains the position (alpha-excluded).
  // Averaging:
  // - Tile > 50% of the token shape: tileE.
  // - Tile < 50% of token shape: fall to tile below.
  // - Only non-transparent tile portions count.
  tiles.sort((a, b) => b.elevationZ - a.elevationZ);
  if ( checkTopOnly ) tiles = [tiles[0]];

  if ( useAveraging ) {
    let tokenShape = canvas.elevation._tokenShape(tokenTL.x, tokenTL.y, token.w, token.h);
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
      if ( tile.containsPixel(tokenCenter.x, tokenCenter.y, 0.99) ) {
        selectedTile.tile = tile;
        return tile.elevationE;
      }
    }
  }

  // No tile matches the criteria
  return null;
}

/**
 * Find overhead elevation tiles along a line segment (ray).
 * @param {Ray} ray
 * @returns {Set<Tile>}
 */
function elevationTilesOnRay(ray) {
  const collisionTest = (o, _rect) => o.t.document.overhead && isFinite(o.t.elevationZ);
  return canvas.tiles.quadtree.getObjects(ray.bounds, { collisionTest });
}

/**
 * Determine the first point along a ray that is opaque with respect to a tile.
 * The number of tests is based on the grid precision (see getSnappedPosition).
 * Does not test the alpha bounding box, which is assumed to be done separately.
 * @param {Tile} tile
 * @param {Ray} ray                 Ray, in texture coordinates.
 * @param {number} alphaThreshold   Percentage between 0 and 1 above which is deemed "opaque".
 * @param {number} percentStep      Percentage between 0 and 1 to step along ray.
 * @returns {Point|null}
 */
function findOpaqueTilePointAlongRay(ray, tile, { alphaThreshold = 0.75, stepT = 0.1, debug = false } = {}) {
  if ( !tile._textureData?.pixels || !tile.mesh ) return null;

  if ( debug ) {
    const canvasRay = textureRayToCanvas(ray, tile);
    Draw.segment(canvasRay, { color: Draw.COLORS.orange });
  }

  // Confirm constants.
  const aw = Math.roundFast(Math.abs(tile._textureData.aw));
  alphaThreshold = alphaThreshold * 255;

  // Step along the ray until we hit the threshold or run out of ray.
  let t = stepT;
  while ( t <= 1 ) {
    const pt = ray.project(t);
    const px = (Math.floor(pt.y) * aw) + Math.floor(pt.x);
    const value = tile._textureData.pixels[px];

    if ( debug ) {
      const canvasPt = getCanvasCoordinate(tile, pt.x, pt.y);
      Draw.point(canvasPt, { radius: 1 });
    }

    if ( value > alphaThreshold ) return pt;
    t += stepT;
  }
  return null;
}

// Ray is a tile texture ray
function findTransparentTilePointAlongRay(ray, tile, { alphaThreshold = 0.75, stepT = 0.1, debug = false } = {}) {
  if ( !tile._textureData?.pixels || !tile.mesh ) return null;

  if ( debug ) {
    const canvasRay = textureRayToCanvas(ray, tile);
    Draw.segment(canvasRay, { color: Draw.COLORS.orange });
  }

  // Confirm constants.
  const aw = Math.roundFast(Math.abs(tile._textureData.aw));
  alphaThreshold = alphaThreshold * 255;

  // Step along the ray until we hit the threshold or run out of ray.
  let t = stepT;
  while ( t <= 1 ) {
    const pt = ray.project(t);
    const px = (Math.floor(pt.y) * aw) + Math.floor(pt.x);
    const value = tile._textureData.pixels[px];

//     if ( debug ) {
//       const canvasPt = getCanvasCoordinate(tile, pt.x, pt.y);
//       Draw.point(canvasPt, { radius: 1 });
//     }

    if ( value < alphaThreshold ) return pt;
    t += stepT;
  }
  return null;
}

/* Bench
[tile] = canvas.tiles.placeables;
A = _token.center
B = _token.center
ray = new Ray(A, B)
r = new Ray(getTextureCoordinate(tile, ray.A.x, ray.A.y), getTextureCoordinate(tile, ray.B.x, ray.B.y))
N = 10000
await foundry.utils.benchmark(findTransparentTilePointAlongRay, N, r, tile)
await foundry.utils.benchmark(findTransparentTilePointAlongRay2, N, r, tile)
*/

/**
 * Given an array of numbers (e.g., pixels) arranged in a rectangle of given width,
 * locate the next value along a ray that meets a comparison test.
 * Ray must be in local coordinates.
 * Uses dx and dy of ray to move along the coordinates.
 */
function nextPixelValueAlongRay(ray, pixels, width, cmp, { stepT = 0.1, startT = stepT } = {}) {
  // Step along the ray until we hit the threshold
  let t = startT;
  while ( t <= 1 ) {
    const pt = ray.project(t);
    const px = ((~~pt.y) * width) + (~~pt.x); // Floor the point coordinates.
    const value = pixels[px];
    if ( cmp(value) ) {
      pt.t0 = t;
      return pt;
    }
    t += stepT;
  }
  return null;
}

function findTransparentTilePointAlongRay2(ray, tile, { alphaThreshold = 0.75, stepT = 0.1, debug = false } = {}) {
  if ( !tile._textureData?.pixels || !tile.mesh ) return null;

  if ( debug ) {
    const canvasRay = textureRayToCanvas(ray, tile);
    Draw.segment(canvasRay, { color: Draw.COLORS.orange });
  }

  // Confirm constants.
  const aw = Math.roundFast(Math.abs(tile._textureData.aw));
  alphaThreshold = alphaThreshold * 255;

  const cmp = value => value < alphaThreshold;
  return nextPixelValueAlongRay(ray, tile._textureData.pixels, aw, cmp, { stepT });
}

/**
 * Find elevated terrain along a ray.
 * @param {Ray} ray       Ray using canvas coordinates
 * @param {Token} token   Token to get elevation values for
 * @param {object} [options]
 * @param {number} [options.elevationThreshold=0]   If elevation over this threshold,
 *                                                  return the point on the ray.
 * @param {number} [options.percentStep=0.1]        Percent between 0 and 1 to move along the ray.
 * @param {boolean} [options.debug=true]            Debug using drawings.
 * @returns {Point|null}
 */
function findElevatedTerrainForTokenAlongRay(ray, token,
  { elevationThreshold = 0, stepT = 0.1, startT = stepT, debug = false } = {}) {
  if ( debug ) Draw.segment(ray, { color: Draw.COLORS.green });

  // Step along the ray until we hit the threshold or run out of ray.
  let t = startT;
  while ( t <= 1 ) {
    const pt = ray.project(t);
    if ( debug ) Draw.point(pt, { radius: 1 });
    const value = tokenTerrainElevation(token, { tokenCenter: pt });
    if ( value > elevationThreshold ) {
      pt.t0 = t;
      return pt;
    }
    t += stepT;
  }
  return null;
}

function findElevatedTerrainForTokenAlongRay2(ray, token,
 { elevationThreshold = 0, stepT = 0.1, startT = stepT, debug = false } = {}) {

  if ( debug ) Draw.segment(ray, { color: Draw.COLORS.green });

  const toLocal = canvas.elevation._fromCanvasCoordinates;
  const textureRay = new Ray(toLocal(ray.A), toLocal(ray.B));
  const pixelThreshold = canvas.elevation.elevationToPixelValue(elevationThreshold);
  const cmp = value => value > pixelThreshold;
  const pixels = canvas.elevation.elevationPixelValues;
  const width = canvas.elevation.cacheWidth;
  let pt = nextPixelValueAlongRay(textureRay, pixels, width, cmp, { stepT, startT });
  if ( pt ) {
    const t0 = pt.t0;
    pt = canvas.elevation._toCanvasCoordinates(pt);
    pt.t0 = t0;
  }
  return pt;
}

function findTerrainElevationJumpsForTokenAlongRay(ray, token,
  { maxJump = canvas.elevation.elevationStep, stepT = 0.1, startT = stepT, debug = false } = {}) {
  if ( debug ) Draw.segment(ray, { color: Draw.COLORS.green });

  // Step along the ray until we hit the threshold or run out of ray.
  let t = startT;
  let pt = ray.project(t);
  let currValue = tokenTerrainElevation(token, { tokenCenter: pt });
  while ( t <= 1 ) {
    if ( debug ) Draw.point(pt, { radius: 1 });
    pt = ray.project(t);
    const value = tokenTerrainElevation(token, { tokenCenter: pt });
    if ( almostBetween(value, currValue - maxJump, currValue + maxJump) ) currValue = value;
    else {
      pt.t0 = t;
      return pt;
    }
    currValue = value;
    t += stepT;
  }
  return null;
}

function findTerrainElevationJumpsForTokenAlongRay2(ray, token,
  { maxJump = canvas.elevation.elevationStep, stepT = 0.1, startT = stepT, debug = false } = {}) {
  if ( debug ) Draw.segment(ray, { color: Draw.COLORS.green });

  const ev = canvas.elevation;
  const toLocal = ev._fromCanvasCoordinates;
  const textureRay = new Ray(toLocal(ray.A), toLocal(ray.B));

  // Don't clamp the jump value so we don't extend beyond the values desired.
  const maxJumpPixel = (maxJump - ev.elevationMin) / ev.elevationStep;
  const pixels = ev.elevationPixelValues;
  const width = ev.cacheWidth;

  // Initialize with the start value
  const pt = ray.project(startT);
  const currE = tokenTerrainElevation(token, { tokenCenter: pt });
  let currPixelValue = ev.elevationToPixelValue(currE);
  const cmp = value => {
    if ( almostBetween(value, currPixelValue - maxJumpPixel, currPixelValue + maxJumpPixel) ) return true;
    currPixelValue = value;
    return false;
  };

  let foundPt = nextPixelValueAlongRay(textureRay, pixels, width, cmp, { stepT, startT });
  if ( foundPt ) {
    const t0 = foundPt.t0;
    foundPt = ev._toCanvasCoordinates(foundPt);
    foundPt.t0 = t0;
  }
  return foundPt;
}

function findTerrainCliffsForTokenAlongRay(ray, token,
  { maxFall, stepT = 0.1, startT=0, debug = false } = {}) {
  if ( debug ) Draw.segment(ray, { color: Draw.COLORS.green });
  maxFall ??= canvas.elevation.elevationStep;

  // Step along the ray until we hit the threshold or run out of ray.
  let pt = ray.project(startT);
  let currValue = tokenTerrainElevation(token, { tokenCenter: pt });
  let t = startT + stepT;
  while ( t <= 1 ) {
    pt = ray.project(t);
    if ( debug ) Draw.point(pt, { radius: 1 });
    const value = tokenTerrainElevation(token, { tokenCenter: pt });
    if ( value < (currValue - maxFall) ) {
      if ( debug ) Draw.point(pt, { color: Draw.COLORS.red, radius: 3 });
      pt.t0 = t;
      return pt;
    }
    currValue = value;
    t += stepT;
  }
  return null;
}

function findTerrainCliffsForTokenAlongRay2(ray, token,
  { maxFall, stepT = 0.1, startT=0, debug = false } = {}) {
  if ( debug ) Draw.segment(ray, { color: Draw.COLORS.green });
  maxFall ??= canvas.elevation.elevationStep;

  const ev = canvas.elevation;
  const toLocal = ev._fromCanvasCoordinates;
  const textureRay = new Ray(toLocal(ray.A), toLocal(ray.B));

  // Don't clamp the jump value so we don't extend beyond the values desired.
  const maxFallPixel = (maxFall - ev.elevationMin) / ev.elevationStep;
  const pixels = ev.elevationPixelValues;
  const width = ev.cacheWidth;

  // Initialize with the start value
  const pt = ray.project(startT);
  const currE = tokenTerrainElevation(token, { tokenCenter: pt });
  let currPixelValue = ev.elevationToPixelValue(currE);
  startT += stepT;
  const cmp = value => {
    if ( value < (currPixelValue - maxFallPixel) ) return true;
    currPixelValue = value;
    return false;
  };
  let foundPt = nextPixelValueAlongRay(textureRay, pixels, width, cmp, { stepT, startT });
  if ( foundPt ) {
    const t0 = foundPt.t0;
    foundPt = ev._toCanvasCoordinates(foundPt);
    foundPt.t0 = t0;
  }
  return foundPt;
}

function canvasRayToTexture(ray, tile) {
  const a = getTextureCoordinate(tile, ray.A.x, ray.A.y);
  const b = getTextureCoordinate(tile, ray.B.x, ray.B.y);
  return new Ray(a, b);
}

function textureRayToCanvas(ray, tile) {
  const A = getCanvasCoordinate(tile, ray.A.x, ray.A.y);
  const B = getCanvasCoordinate(tile, ray.B.x, ray.B.y);
  return new Ray(A, B);
}

// The only time tiles cause automatic elevation to break is if the
// tile stops or has a hole and there is nothing to catch the token, so it falls.
// Test at every intersection point with a tile.
//


//
// tokenGroundElevation = canvas.elevation.tokens.tokenGroundElevation
// tokenTileGroundElevation = canvas.elevation.tokens.tokenTileGroundElevation
// tokenTerrainGroundElevation = canvas.elevation.tokens.tokenTerrainGroundElevation

/** @enum {number} */
let TOKEN_ELEVATION_STATE = {
  TERRAIN: 0, // Important that terrain is set to zero, so it can be checked for true/false.
  TILE: 1,
  FLY: 2
};

/** @enum {number} */
let TOKEN_ELEVATION_DIRECTION = {
  LOWER: -1,
  SAME: 0,
  HIGHER: 1
};

/** @enum {hex} */
// For debugging
let STATE_COLOR = [Draw.COLORS.green, Draw.COLORS.orange, Draw.COLORS.blue];

function _organizeTiles(travelRay) {
  const tiles = [...elevationTilesOnRay(travelRay)];
  const out = { tiles };
  const tileIxs = out.tileIxs = [];
  if ( !tiles.length ) return out;

  // Sort tiles by elevation, highest to lowest.
  // This will help with finding relevant tiles later.
  // TODO: Take advantage of sorting in elevationForTokenTravel
  tiles.sort((a, b) => b.elevationZ - a.elevationZ);

  for ( const tile of tiles ) {
    const ixs = canvasRayIntersectsTile(tile, travelRay);
    if ( ixs.length < 2 ) continue;
    tileIxs.push(ixs[0]);
  }

  // Closest intersection to A is last in the queue, so we can pop it.
  tileIxs.sort((a, b) => b.t0 - a.t0);

  return out;
}

function almostBetween(value, min, max) {
  return almostLessThan(value, max) && almostGreaterThan(value, min);
}
function almostLessThan(a, b) { return a < b || a.almostEqual(b); }
function almostGreaterThan(a, b) { return a > b || a.almostEqual(b); }

function _currentTokenState(token, { tokenCenter, tokenElevation } = {}) {
  if ( isTokenOnTile(token, { tokenCenter, tokenElevation }) ) return TOKEN_ELEVATION_STATE.TILE;
  if ( isTokenOnGround(token,
    { tokenCenter, tokenElevation, considerTiles: false }) ) return TOKEN_ELEVATION_STATE.TERRAIN;
  return TOKEN_ELEVATION_STATE.FLY;
}

/* Testing
api = game.modules.get("elevatedvision").api
Draw = CONFIG.GeometryLib.Draw
draw = new Draw()

let {
  tokenGroundElevation,
  tokenTileElevation,
  tokenTerrainElevation,
  isTokenOnTile,
  isTokenOnGround,
  elevationForTokenTravel
 } = canvas.elevation.tokens


let [token1, token2] = canvas.tokens.controlled;
A = token1.center
B = token2.center
token = token1
travelRay = new Ray(A, B)


A = _token.center
B = _token.center
token = _token
travelRay = new Ray(A, B)

draw.clearDrawings()
draw.clearLabels()
results = elevationForTokenTravel(token, travelRay, { tokenElevation: 0, debug: true, fly: false})
draw.clearDrawings()
draw.clearLabels()
drawElevationResults(results)


*/


export function elevationForTokenTravel(token, travelRay,
  { fly, tokenElevation, debug = false, tileStep, terrainStep } = {}) {
  if ( debug ) Draw.segment(travelRay);

  let rayTConversion = Math.abs(travelRay.dx) > Math.abs(travelRay.dy)
  ? pt => (pt.x - travelRay.A.x) / travelRay.dx
    : pt => (pt.y - travelRay.A.y) / travelRay.dy;
  travelRay.tConversion = rayTConversion;

  let { TERRAIN, TILE, FLY } = TOKEN_ELEVATION_STATE;
  fly ??= autoElevationFly();
  tokenElevation ??= token.bottomE;
  let out = {
    token,
    travelRay,
    autoElevation: false,
    trackingRequired: false,
    startElevation: tokenElevation,
    finalElevation: tokenElevation,
    elevationChanges: []
  };


  // If flying not enabled and the token is currently flying, bail out.
  let currState = _currentTokenState(token, { tokenCenter: travelRay.A, tokenElevation });
  if ( !fly && currState === FLY ) return out; // Flying

  // If flying not enabled and no tiles present, can simply rely on terrain elevations throughout.
  out.autoElevation = true;
  let { tiles, tileIxs } = _organizeTiles(travelRay);
  if ( !tiles.length && !fly ) {
    out.finalElevation = tokenTerrainElevation(token, { tokenCenter: travelRay.B });
    return out;
  }
  out.trackingRequired = true;

  // Variables required for the tracking loop.
  tileStep ??= token.topE - token.bottomE;
  terrainStep ??= token.topE - token.bottomE;

  let currE = tokenElevation;
  let currTile;
  let elevationChanges = out.elevationChanges;
  let gridPrecision = canvas.walls.gridPrecision;
  let interval = Math.max(canvas.grid.w / gridPrecision, canvas.grid.h / gridPrecision);
  let stepT = interval / travelRay.distance;

  // Add the start and endpoints for the ray
  let startPt = travelRay.A;
  let endPt = travelRay.B;
  startPt.t0 = 0;
  endPt.t0 = 1;
  tileIxs.unshift(endPt);
  tileIxs.push(startPt);

  // At each intersection group, update the current elevation based on ground unless already on tile.
  // If the token elevation equals that of the tile, the token is now on the tile.
  // Keep track of the seen intersections, in case of duplicates.
  let tSeen = new Set();
  while ( tileIxs.length ) {
    let ix = tileIxs.pop();
    if ( tSeen.has(ix.t0) ) continue;
    tSeen.add(ix.t0);
    if ( debug ) Draw.point(ix, { color: STATE_COLOR[currState], radius: 3 });

    // Determine the destination type and associated elevation.
    // (1) If currently on the terrain, the current elevation reflects that of the last
    //     intersection. Update to the current intersection.

    const terrainE = tokenTerrainElevation(token, { tokenCenter: ix });
    if ( currState === TERRAIN ) currE = terrainE;

    // (2) Locate any tiles at this location with sufficiently near elevation.
    let matchingTile;
    if ( currTile && currTile.containsPixel(ix.x, ix.y) ) matchingTile = currTile;
    else {
      const maxE = currE;
      matchingTile = tiles.find(tile => {
        const tileE = tile.elevationE;
        return almostLessThan(tileE, maxE) && tile.containsPixel(ix.x, ix.y) > 0;
      });
    }

    // (3) Check if we are on a tile
    if ( matchingTile ) {
      currState = TILE;
      currE = matchingTile.elevationE;
    } else

    // (4) Check if we are flying and "landing"
    if ( fly && currState === FLY ) {
      const step = terrainStep;
      currState = almostLessThan(currE - step, terrainE) ? TERRAIN : FLY;
      if ( currState === TERRAIN ) currE = terrainE;
    } else

    // (5) If flying is enabled, direction of movement must be checked.
    //     Use the immediately previous terrain or tile elevation.
    //     If a matching tile is found, we are not flying.
    if ( fly && !matchingTile) {
      const step = currTile ? tileStep : terrainStep;
      let prevE = currTile?.elevationE;
      if ( !currTile ) {
        const prevT = ix.t0 - stepT;
        const prevPt = travelRay.project(prevT);
        prevE = tokenTerrainElevation(token, { tokenCenter: prevPt });
      }
      if ( (currE + step) < prevE ) {
        currState = FLY;
        currE = prevE;
      } else {
        currState = TERRAIN;
        currE = terrainE;
      }
    } else

    // (6) Otherwise, on terrain.
    {
      currState = TERRAIN;
      currE = terrainE;
    }

    // (5) Remember the current tile for next iteration.
    currTile = matchingTile;

    // (6) Update the tracking results.
    elevationChanges.push({ ix, currState, currE });

    // (7) Depending on the new current state, look for additional tile or terrain intersections along the ray.
    let startT = ix.t0 + stepT;
    switch ( currState ) {
      case TERRAIN: {
        // Find the next terrain divergence so flying can be used
        if ( fly ) {
          const elevationPt = findTerrainCliffsForTokenAlongRay2(travelRay, token,
            { maxFall: terrainStep, stepT, startT: ix.t0, debug });
          if ( elevationPt ) _addIx(tileIxs, elevationPt, { debug, color: Draw.COLORS.green });
        }
        break;
      }

      case TILE: {
        // Find the alpha intersection for this tile, if any, or the tile endpoint, if not.
        const tileCanvasRay = new Ray(ix, travelRay.B);
        const tileTextureRay = canvasRayToTexture(tileCanvasRay, matchingTile);
        const nextPt = findTransparentTilePointAlongRay2(tileTextureRay, matchingTile, { stepT });
        if ( nextPt ) {
          const nextCanvasPt = getCanvasCoordinate(matchingTile, nextPt.x, nextPt.y);
          nextCanvasPt.t0 = rayTConversion(nextCanvasPt);
          _addIx(tileIxs, nextCanvasPt, { debug });
        }

        // Find the next location of where terrain pokes through the tile, if any.
        const elevationPt = findElevatedTerrainForTokenAlongRay2(
          travelRay, token, { elevationThreshold: currE, stepT, startT });
        if ( elevationPt ) _addIx(tileIxs, elevationPt, { debug, color: Draw.COLORS.green });
        break;
      }

      case FLY: {
        // Check for tile or terrain that we will run into at this flying elevation.
        const destRay = new Ray(ix, travelRay.B);

        // Find the tile intersections
        const maxE = currE;
        const minE = currE - tileStep;
        const tilesWithinE = tiles.filter(tile => almostBetween(tile.elevationE, minE, maxE) );
        const ixs = [];
        for ( const tile of tilesWithinE ) {
          const tileIxs = canvasRayIntersectsTile(tile, destRay);
          if ( tileIxs.length ) ixs.push(tileIxs[0]);
        }

        // Find the elevation intersection.
        const elevationPt = findElevatedTerrainForTokenAlongRay2(
          travelRay, token, { elevationThreshold: minE, stepT, startT });
        if ( elevationPt ) ixs.push(elevationPt);

        // If any intersections, add the first one encountered along the travel ray.
        if ( !ixs.length ) break;
        ixs.sort((a, b) => a.t0 - b.t0);
        _addIx(tileIxs, ixs[0], { debug, color: Draw.COLORS.blue });
        break;
      }
    }
  }

  out.finalElevation = currE;
  return out;
}

function _addIx(trackingArray, pt, {debug = false, color = Draw.COLORS.yellow, radius = 2} = {}) {
  trackingArray.push(pt); // The elevationPt already has correct t0.
  trackingArray.sort((a, b) => b.t0 - a.t0);
  if ( debug ) Draw.point(pt, { color, radius });
}

function drawElevationResults(results) {
  Draw.segment(results.travelRay);
  for ( let i = 0; i < results.elevationChanges.length; i += 1 ) {
    const changes = results.elevationChanges[i];
    const startPt = changes.ix;
    const endPt = i < results.elevationChanges.length - 1
      ? results.elevationChanges[i + 1].ix : results.travelRay.B;
    const color = STATE_COLOR[changes.currState];
    Draw.point(startPt, { color });
    Draw.segment({A: startPt, B: endPt}, { color });
    Draw.labelPoint(PIXI.Point.midPoint(startPt, endPt), changes.currE);
  }
  Draw.labelPoint(results.travelRay.B, results.finalElevation);
}


/**
 * Find the point at which the tile is first opaque and last opaque, along a ray.
 * @param {Tile} tile
 * @param {Ray} ray       Ray, in texture coordinates
 * @returns {Point[]}
 */
function canvasRayIntersectsTile(tile, ray, alphaThreshold = 0.75) {
  const bounds = tileAlphaCanvasBoundingBox(tile, alphaThreshold);
  const { A, B } = ray;
  const ixs = bounds.segmentIntersections(A, B);
  const CSZ = PIXI.Rectangle.CS_ZONES;
  if ( bounds._getZone(A) === CSZ.INSIDE ) {
    A.t0 = 0;
    ixs.unshift(A);
  }
  if ( bounds._getZone(B) === CSZ.INSIDE ) {
    B.t0 = 1;
    ixs.push(B);
  }
  return ixs;
}


/**
 * Build an alpha bounding box for a tile, based on the chosen threshold.
 * @param {tile}
 * @param {number} alphaThreshold   Percentage between 0 and 1. Below this percentage will
 *                                  be considered transparent.
 * @returns {PIXI.Rectangle}
 */
function tileAlphaBoundingBox(tile, alphaThreshold = 0.75) {
  if ( !tile._textureData ) return tile.bounds;
  alphaThreshold = alphaThreshold * 255;
  let minX = undefined;
  let maxX = undefined;
  let minY = undefined;
  let maxY = undefined;

  // Map the alpha pixels
  const pixels = tile._textureData.pixels;
  const w = Math.roundFast(tile._textureData.aw);
  for ( let i = 0; i < pixels.length; i += 1 ) {
    const a = pixels[i];
    if ( a > alphaThreshold ) {
      const x = i % w;
      const y = Math.floor(i / w);
      if ( (minX === undefined) || (x < minX) ) minX = x;
      else if ( (maxX === undefined) || (x + 1 > maxX) ) maxX = x + 1;
      if ( (minY === undefined) || (y < minY) ) minY = y;
      else if ( (maxY === undefined) || (y + 1 > maxY) ) maxY = y + 1;
    }
  }

  const r = Math.toRadians(tile.document.rotation);
  return PIXI.Rectangle.fromRotation(minX, minY, maxX - minX, maxY - minY, r).normalize();
}


/**
 * Convert the tile alpha bounding box to canvas coordinates.
 * @param {Tile} tile
 * @returns {PIXI.Rectangle}
 */
function tileAlphaCanvasBoundingBox(tile, alphaThreshold = 0.75) {
  const alphaBounds = tileAlphaBoundingBox(tile, alphaThreshold);
  const TL = getCanvasCoordinate(tile, alphaBounds.left, alphaBounds.top);
  const BR = getCanvasCoordinate(tile, alphaBounds.right, alphaBounds.bottom);
  return new PIXI.Rectangle(TL.x, TL.y, BR.x - TL.x, BR.y - TL.y);
}

function drawTileAlpha(tile, color = Draw.COLORS.blue) {
  const pixels = tile._textureData.pixels;
  const ln = tile._textureData.pixels.length;
  const w = Math.roundFast(tile._textureData.aw);
  for ( let i = 0; i < ln; i += 4) {
    const alpha = pixels[i];
    if ( alpha === 0 ) continue;
    const n = i / 4;
    const x = n % w;
    const y = Math.floor(n / w);
    const pt = getCanvasCoordinate(tile, x, y);
    Draw.point(pt, { color, alpha: alpha / 255 });
    Draw.point({x, y}, { color, alpha: alpha / 255 });
  }
}

function drawTileAlpha2(tile, color = Draw.COLORS.blue) {
  const { left, right, top, bottom } = tile.bounds;
  for ( let x = left; x < right; x += 1 ) {
    for ( let y = top; y < bottom; y += 1 ) {
      const alpha = tile.getPixelAlpha(x, y);
      Draw.point({x, y}, { color, alpha: alpha / 255 });
    }
  }
}

function drawTileAlpha3(tile, color = Draw.COLORS.blue) {
  const { left, right, top, bottom } = tile.bounds;
  const aw = Math.roundFast(Math.abs(tile._textureData.aw));
  for ( let x = left; x < right; x += 10 ) {
    for ( let y = top; y < bottom; y += 10 ) {
      const textureCoord = getTextureCoordinate(tile, x, y);
      const px = (Math.floor(textureCoord.y) * aw) + Math.floor(textureCoord.x);
      const alpha = tile._textureData.pixels[px];
      Draw.point({x, y}, { color, alpha: alpha / 255, radius: 1 });
    }
  }
}

function drawTileAlpha4(tile, color = Draw.COLORS.blue, threshold = .25) {
  const { left, right, top, bottom } = tile.bounds;
  const aw = Math.roundFast(Math.abs(tile._textureData.aw));
  for ( let x = left; x < right; x += 10 ) {
    for ( let y = top; y < bottom; y += 10 ) {
      const textureCoord = getTextureCoordinate(tile, x, y);
      const px = (Math.floor(textureCoord.y) * aw) + Math.floor(textureCoord.x);
      const alpha = tile._textureData.pixels[px];
      const percent = alpha / 255;
      if ( percent < threshold ) Draw.point({x, y}, { color, radius: 1 });
    }
  }
}

/**
 * Get tile alpha map texture coordinate with canvas coordinate.
 * Copy of Tile.prototype.#getTextureCoordinate
 * @param {number} testX               Canvas x coordinate.
 * @param {number} testY               Canvas y coordinate.
 * @returns {object}          The texture {x, y} coordinates, or null if not able to do the conversion.
 */
function getTextureCoordinate(tile, testX, testY) {
  const {x, y, width, height, rotation, texture} = tile.document;
  const mesh = tile.mesh;

  // Save scale properties
  const sscX = Math.sign(texture.scaleX);
  const sscY = Math.sign(texture.scaleY);
  const ascX = Math.abs(texture.scaleX);
  const ascY = Math.abs(texture.scaleY);

  // Adjusting point by taking scale into account
  testX -= (x - ((width / 2) * sscX * (ascX - 1)));
  testY -= (y - ((height / 2) * sscY * (ascY - 1)));

  // Mirroring the point on x/y axis if scale is negative
  if ( sscX < 0 ) testX = (width - testX);
  if ( sscY < 0 ) testY = (height - testY);

  // Account for tile rotation and scale
  if ( rotation !== 0 ) {
    // Anchor is recomputed with scale and document dimensions
    const anchor = {
      x: mesh.anchor.x * width * ascX,
      y: mesh.anchor.y * height * ascY
    };
    let r = new Ray(anchor, {x: testX, y: testY});
    r = r.shiftAngle(-mesh.rotation * sscX * sscY); // Reverse rotation if scale is negative for just one axis
    testX = r.B.x;
    testY = r.B.y;
  }

  // Convert to texture data coordinates
  testX *= (tile._textureData.aw / mesh.width);
  testY *= (tile._textureData.ah / mesh.height);

  return {x: testX, y: testY};
}


/**
 * Get tile alpha map texture coordinate with canvas coordinate.
 * Copy of Tile.prototype.#getTextureCoordinate but inverted.
 * @param {number} testX               Canvas x coordinate.
 * @param {number} testY               Canvas y coordinate.
 * @returns {object}          The texture {x, y} coordinates, or null if not able to do the conversion.
 */
function getCanvasCoordinate(tile, testX, testY) {
  const {x, y, width, height, rotation, texture} = tile.document;
  const mesh = tile.mesh;

  // Save scale properties
  const sscX = Math.sign(texture.scaleX);
  const sscY = Math.sign(texture.scaleY);
  const ascX = Math.abs(texture.scaleX);
  const ascY = Math.abs(texture.scaleY);

  // Convert from texture data coordinates
  testX /= (tile._textureData.aw / mesh.width);
  testY /= (tile._textureData.ah / mesh.height);

  // Account for tile rotation and scale
  if ( rotation !== 0 ) {
    // Anchor is recomputed with scale and document dimensions
    const anchor = {
      x: mesh.anchor.x * width * ascX,
      y: mesh.anchor.y * height * ascY
    };
    let r = new Ray(anchor, {x: testX, y: testY});
    r = r.shiftAngle(mesh.rotation * sscX * sscY); // Reverse rotation if scale is negative for just one axis
    testX = r.B.x;
    testY = r.B.y;
  }

  // Mirror the point on x/y axis if scale is negative
  if ( sscX < 0 ) testX = width - testX;
  if ( sscY < 0 ) testY = height - testY;

  // Adjusting point by taking scale into account
  testX += (x - ((width / 2) * sscX * (ascX - 1)));
  testY += (y - ((height / 2) * sscY * (ascY - 1)));

  return {x: testX, y: testY};
}

/**  Test coordinate conversion
 */
function testCoordinateConversion(tile) {
  const { left, right, top, bottom } = tile.bounds;
  for ( let x = left; x < right; x += 10 ) {
    for ( let y = top; y < bottom; y += 10 ) {
      const textureCoord = getTextureCoordinate(tile, x, y);
      const canvasCoord = getCanvasCoordinate(tile, textureCoord.x, textureCoord.y);
      if ( !canvasCoord.x.almostEqual(x) || !canvasCoord.y.almostEqual(y) ) {
        console.log(`At x,y ${x},${y} textureCoord ${textureCoord.x},${textureCoord.y} and canvasCoord ${canvasCoord.x},${canvasCoord}`);
        return false;
      }
    }
  }
  return true;
}

/**
 * Test indexing
 */
function testCoordinateConversion2(tile, color = Draw.COLORS.blue) {
  const pixels = tile._textureData.pixels;
  const ln = tile._textureData.pixels.length;
  const w = Math.roundFast(tile._textureData.aw);
  for ( let i = 0; i < ln; i += 1) {
    const alpha = pixels[i];
    if ( alpha === 0 ) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    const canvasCoord = getCanvasCoordinate(tile, x, y);
    const textureCoord = getTextureCoordinate(tile, canvasCoord.x, canvasCoord.y);
    if ( !textureCoord.x.almostEqual(x) || !textureCoord.y.almostEqual(y) ) {
      console.log(`At i ${i} x,y ${x},${y} textureCoord ${textureCoord.x},${textureCoord.y} and canvasCoord ${canvasCoord.x},${canvasCoord.y}`);
      return false;
    }

    const testI = ((textureCoord.y * w) + textureCoord.x);
    if ( testI !== i ) {
      console.log(`At i ${i} ≠ ${testI}`);
      return false;
    }

    Draw.point(canvasCoord, { color, alpha: alpha / 255 });
    Draw.point({x, y}, { color, alpha: alpha / 255 });
  }
}
