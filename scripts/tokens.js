/* globals
canvas
*/
"use strict";

import { log, groupBy } from "./util.js";
import { getSetting, SETTINGS } from "./settings.js";
import { CanvasPixelValueMatrix } from "./pixel_values.js";


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
//
// So:
// Token starts on terrain ground: auto elevation
// Token starts on tile: auto elevation
// Token not starting on terrain or tile ground: no auto elevation
//
// If at any point, token moves on/off tile:
// - tile --> terrain/tile @ same elevation --> auto elevation continues
// - tile --> higher terrain elevation --> auto elevation continues
// - tile --> lower terrain elevation --> auto elevation stops.
//   (Token now "flying"; token moved off tile "cliff" or "ledge")
// - tile --> higher tile elevation --> auto elevation based on underneath tile
//   (Token now under the tile)
// - tile --> lower tile elevation --> auto elevation stops.
//   (Token now "flying")
// - terrain --> tile @ same elevation --> auto elevation continues
// - terrain --> tile below --> auto elevation continues
//   (Token dropped from "hill" to "floor")
// - terrain --> tile above --> tile ignored (above token)

/**
 * Wrap Token.prototype._refresh
 * Adjust elevation as the token moves.
 */
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
  let tileE = tokenTileGroundElevation(this, { position: this.document, checkTopOnly: true });
  const groundE = tokenGroundElevation(this, { position: this.document });
  const prevTileE = this._elevatedVision.tileElevation;

  // If the ground is above the tile, we are on terrain poking through a tile
  if ( tileE !== null && tileE < groundE ) tileE = null;
  if ( prevTileE !== null && prevTileE > groundE ) {
    // Token previously on or above a tile.
    // Tile --> lower terrain/tile elevation; stop auto elevation.
    this._elevatedVision.tokenAdjustElevation = false;
  }

  this._elevatedVision.tileElevation = tileE;
  if ( this._elevatedVision.tokenAdjustElevation ) this.document.elevation = groundE;
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
 * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
 * @param {object} [options]  Options that affect the calculation
 * @param {Point} [options.position]          Canvas coordinates to use for token position.
 *                                            Defaults to token center.
 * @param {boolean} [options.useAveraging]    Use averaging instead of exact center point of the token.
 *                                            Defaults to SETTINGS.AUTO_AVERAGING.
 * @param {boolean} [options.considerTiles]   First consider tiles under the token?
 * @return {boolean}
 */
export function isTokenOnGround(token, { position, useAveraging, considerTiles } = {}) {
  const currTerrainElevation = tokenGroundElevation(token, { position, useAveraging, considerTiles });
  return currTerrainElevation.almostEqual(token.document?.elevation);
}

/**
 * Determine whether a token is on a tile, meaning the token is in contact with the tile.
 * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
 * @param {object} [options]  Options that affect the calculation
 * @param {Point} [options.position]          Canvas coordinates to use for token position.
 *                                            Defaults to token center.
 * @param {boolean} [options.useAveraging]    Use averaging instead of exact center point of the token.
 *                                            Defaults to SETTINGS.AUTO_AVERAGING.
 * @param {boolean} [options.considerTiles]   First consider tiles under the token?
 * @return {boolean}
 */
export function isTokenOnTile(token, { position, useAveraging }) {
  const tileElevation = tokenTileGroundElevation(token, { position, useAveraging, checkTopOnly: true });
  return tileElevation !== null && tileElevation === token.elevationE;
}

/**
 * Determine token elevation for a give canvas location
 * Will be either the tile elevation, if the token is on the tile, or the terrain elevation.
 * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
 * @param {object} [options]  Options that affect the calculation.
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

  // If the terrain is above the tile, use the terrain elevation. (Math.max(null, 5) returns 5.)
  return Math.max(elevation, tokenTerrainGroundElevation(token, { position, useAveraging }));
}

/**
 * Determine token elevation for a give canvas location
 * Will be either the tile elevation, if the token is on the tile, or the terrain elevation.
 * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
 * @param {object} [options]  Options that affect the calculation.
 * @param {Point} [options.position]          Canvas coordinates to use for token position.
 *                                            Defaults to token center.
 * @param {boolean} [options.useAveraging]    se averaging instead of exact center point of the token.
 *                                            Defaults to SETTINGS.AUTO_AVERAGING.
 * @returns {number} Elevation in grid units.
 */
export function tokenTerrainGroundElevation(token, { position, useAveraging } = {}) {
  position ??= { x: token.center.x, y: token.center.y };
  useAveraging ??= getSetting(SETTINGS.AUTO_AVERAGING);

  if ( useAveraging ) return averageElevationForToken(position.x, position.y, token.w, token.h);

  return canvas.elevation.elevationAt(position.x, position.y);
}

function averageElevationForToken(x, y, w, h) {
  const tokenShape = canvas.elevation._tokenShape(x, y, w, h);
  return canvas.elevation.averageElevationWithinShape(tokenShape);
}

/**
 * Determine ground elevation of a token, taking into account tiles.
 * @param {Token} token       Token to test; may use token.getBounds() and token.center, depending on options.
 * @param {object} [options]  Options that affect the tile elevation calculation
 * @param {Point} [options.position]  Position to use for the token position.
 *                                    Should be a grid position (a token x,y).
 *                                    Defaults to current token position.
 * @param {boolean} [options.useAveraging]    Token at tileE only if 50% of the token is over the tile.
 * @param {object} [options.selectedTile]     Object (can be empty) in which "tile" property will
 *                                            be set to the tile found, if any. Primarily for debugging.
 * @param {boolean} [options.checkTopOnly]    Should all tiles under the token be checked, or only the top-most tile?
 * @return {number|null} Return the tile elevation or null otherwise.
 */
export function tokenTileGroundElevation(token,
  { position, useAveraging, selectedTile = {}, checkTopOnly = false } = {} ) {
  position ??= { x: token.center.x, y: token.center.y };
  useAveraging ??= getSetting(SETTINGS.AUTO_AVERAGING);

  const tokenZ = token.bottomZ;
  const bounds = token.bounds;
  bounds.x = position.x;
  bounds.y = position.y;

  // Filter tiles that potentially serve as ground.
  let tiles = [...canvas.tiles.quadtree.getObjects(bounds)].filter(tile => {
    if ( !tile.document.overhead ) return false;
    const tileZ = tile.elevationZ;
    return isFinite(tileZ) && (tileZ.almostEqual(tokenZ) || tileZ < tokenZ);
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
function findOpaqueTilePointAlongRay(ray, tile, { alphaThreshold = 0.75, percentStep = 0.1, debug = true } = {}) {
  if ( !tile._textureData?.pixels || !tile.mesh ) return null;

  if ( debug ) {
    canvasRay = textureRayToCanvas(ray, tile)
    draw.segment(canvasRay, { color: Draw.COLORS.orange })
  }

  // Confirm constants.
  const aw = Math.roundFast(Math.abs(tile._textureData.aw));
  alphaThreshold = alphaThreshold * 255;

  // Step along the ray until we hit the threshold or run out of ray.
  let t = percentStep;
  while ( t <= 1 ) {
    const pt = ray.project(t);
    const px = (Math.floor(pt.y) * aw) + Math.floor(pt.x);
    const value = tile._textureData.pixels[px];

    if ( debug ) {
      const canvasPt = getCanvasCoordinate(tile, pt.x, pt.y)
      draw.point(canvasPt, { radius: 1 })
    }

    if ( value > alphaThreshold ) return pt;
    t += percentStep;
  }
  return null;
}

function findTransparentTilePointAlongRay(ray, tile, { alphaThreshold = 0.75, percentStep = 0.1, debug = true } = {}) {
  if ( !tile._textureData?.pixels || !tile.mesh ) return null;

  if ( debug ) {
    canvasRay = textureRayToCanvas(ray, tile)
    draw.segment(canvasRay, { color: Draw.COLORS.orange })
  }

  // Confirm constants.
  const aw = Math.roundFast(Math.abs(tile._textureData.aw));
  alphaThreshold = alphaThreshold * 255;

  // Step along the ray until we hit the threshold or run out of ray.
  let t = percentStep;
  while ( t <= 1 ) {
    const pt = ray.project(t);
    const px = (Math.floor(pt.y) * aw) + Math.floor(pt.x);
    const value = tile._textureData.pixels[px];

    if ( debug ) {
      const canvasPt = getCanvasCoordinate(tile, pt.x, pt.y)
      draw.point(canvasPt, { radius: 1 })
    }

    if ( value < alphaThreshold ) return pt;
    t += percentStep;
  }
  return null;
}



// canvas.walls.gridPrecision
//
// pts = []
// for ( let i = 0; i < 100; i += 1 ) {
//   const x = _token.center.x + i;
//   const y = _token.center.y + i;
//   const pt = canvas.grid.getSnappedPosition(x, y, canvas.walls.gridPrecision)
//   pts.push(pt)
//   console.log(`${x},${y} --> ${pt.x},${pt.y}`);
// }

A = _token.center;
B = _token.center;
canvasRay = new Ray(A, B)
// Convert ray to texture coordinates, for speed.
textureRay = canvasRayToTexture(ray, tile)

textureIxs = rayIntersectsTile(tile, textureRay)
canvasIxs = textureIxs.map(ix => getCanvasCoordinate(tile, ix.x, ix.y))

opaqueTextureRay = new Ray(textureIxs[0], textureIxs[1])
opaqueCanvasRay = textureRayToCanvas(opaqueTextureRay, tile)

const interval = canvas.walls.gridPrecision
percentStep = Math.max(canvas.grid.w / interval, canvas.grid.h / interval) / opaqueCanvasRay.distance;

findOpaqueTilePointAlongRay(opaqueTextureRay, tile, { percentStep })
findTransparentTilePointAlongRay(opaqueTextureRay, tile, { percentStep })

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

tokenGroundElevation = canvas.elevation.tokens.tokenGroundElevation
tokenTileGroundElevation = canvas.elevation.tokens.tokenTileGroundElevation
tokenTerrainGroundElevation = canvas.elevation.tokens.tokenTerrainGroundElevation

function endElevationForTokenTravel(token, travelRay) {
  let currE = tokenGroundElevation(token, { position: travelRay.A });
  if ( !currE.almostEqual(token.bottomE) ) return token.bottomE;

  draw.segment(travelRay);

  const tiles = elevationTilesOnRay(travelRay);
  if ( !tiles.size ) return tokenGroundElevation(token, { position: travelRay.B });

  // Organize tiles along the ray
  const interval = canvas.walls.gridPrecision;
  const intervalRatio = Math.max(canvas.grid.w / interval, canvas.grid.h / interval);
  const rayTConversion = Math.abs(travelRay.dx) > Math.abs(travelRay.dy)
    ? pt => (pt.x - travelRay.A.x) / travelRay.dx
    : pt => (pt.y - travelRay.A.y) / travelRay.dy;


  const tileMap = new Map();
  const ixMap = new Map();

  const tileIxs = [];
  for ( const tile of tiles ) {
    // TODO: Could make this textureRay. Which would be better?
    // (intersection as a proportion of the ray stays the same---texture or canvas)
    const ixs = canvasRayIntersectsTile(tile, travelRay);
    if ( !ixs.length ) continue;
    const t0 = ixs[0].t0;
    const t1 = ixs[1].t0;

    const s0 = tileMap.get(t0) || new Set();
    const s1 = tileMap.get(t1) || new Set();
    s0.add(tile);
    s1.add(tile);
    tileMap.set(t0, s0);
    tileMap.set(t1, s1);
    tileIxs.push(t0, t1);
    ixMap.set(t0, ixs[0]);
    ixMap.set(t1, ixs[1]);
  }

  // Closest intersection to A is last in the queue, so we can pop it.
  tileIxs.sort((a, b) => b - a);

  // At each intersection group, update the current elevation based on ground unless already on tile.
  // If the token elevation equals that of the tile, the token is now on the tile.
  let onTile = false;
  while ( tileIxs.length ) {
    const t = tileIxs.pop();
    const ix = ixMap.get(t);
    draw.point(ix, { color: onTile ? Draw.COLORS.red : Draw.COLORS.green, radius: 3 });
    const tileSet = tileMap.get(t);

    if ( onTile ) {
      let matchingTile;
      if ( tileSet && tileSet.size ) {
        matchingTile = tileSet.find(t => t.elevationE.almostEqual(currE))
      } else {
        selectedTile = {};
        const tileE = tokenTileGroundElevation(token, { position: ix, selectedTile });
        matchingTile = selectedTile.tile;
      }
      if ( matchingTile ) {
        onTile = true;

        // Find the alpha intersection for this tile or the tile endpoint.
        const tileCanvasRay = new Ray(ix, travelRay.B);
        const percentStep = intervalRatio / tileCanvasRay.distance;
        const tileTextureRay = canvasRayToTexture(tileCanvasRay, matchingTile)
        const nextPt = findTransparentTilePointAlongRay(tileTextureRay, matchingTile, { percentStep });
        if ( nextPt ) {
          const nextCanvasPt = getCanvasCoordinate(matchingTile, nextPt.x, nextPt.y);
          const nextT = rayTConversion(nextCanvasPt);
          ixMap.set(nextT, nextCanvasPt);
          tileIxs.push(nextT);
          tileIxs.sort((a, b) => b - a);
        }
      } else {
        const newE = tokenTerrainGroundElevation(token, { position: ix });
        if ( newE < currE ) return currE;
        currE = newE;

      }





    }


    if ( !onTile && tileSet.size ) {
      // TODO: Could check the tileMap instead of tokenTileGroundElevation
      currE = tokenTerrainGroundElevation(token, { position: ix });
      const matchingTile = tileSet.find(t => t.elevationE.almostEqual(currE))
      if ( matchingTile ) {
        onTile = true;

        // Find the alpha intersection for this tile or the tile endpoint.
        const tileCanvasRay = new Ray(ix, travelRay.B);
        const percentStep = intervalRatio / tileCanvasRay.distance;
        const tileTextureRay = canvasRayToTexture(tileCanvasRay, matchingTile)
        const nextPt = findTransparentTilePointAlongRay(tileTextureRay, matchingTile, { percentStep });
        if ( nextPt ) {
          const nextCanvasPt = getCanvasCoordinate(matchingTile, nextPt.x, nextPt.y);
          const nextT = rayTConversion(nextCanvasPt);
          ixMap.set(nextT, nextCanvasPt);
          tileIxs.push(nextT);
          tileIxs.sort((a, b) => b - a);
        }
      }
    } else {
      if ( tileE && tileE.almostEqual(currE) ) {

      } else {
        onTile = false;
        const newE = tokenGroundElevation(token, { position: ix });
        if ( newE < currE ) return currE;
        currE = newE;
      }




    }
  }
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
  minX = undefined;
  maxX = undefined;
  minY = undefined;
  maxY = undefined;

  // Map the alpha pixels
  const pixels = tile._textureData.pixels;
  const w = Math.roundFast(tile._textureData.aw);
  for ( let i = 0; i < pixels.length; i += 1 ) {
    const a = pixels[i]
    if ( a > 0 ) {
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
      return false
    }

    Draw.point(canvasCoord, { color, alpha: alpha / 255 });
    Draw.point({x, y}, { color, alpha: alpha / 255 });
  }
}
