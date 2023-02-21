/* globals
canvas,
Ray,
ui,
PIXI,
CONFIG
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { almostLessThan, almostBetween } from "./util.js";
import { Draw } from "./geometry/Draw.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { getSetting, getSceneSetting, SETTINGS, averageTilesSetting, averageTerrainSetting } from "./settings.js";
import { tokenTerrainElevation, tileAtTokenElevation, tileOpaqueAt } from "./tokens.js";


/* Flow to determine destination elevation

No flight and token is flying: Freeze the token elevation

No flight:

A. No matching tiles at destination
- On terrain.

B. Tile at destination.
- On tile or under tile


Flight:
A. No matching tiles at destination
- Any elevation is possible

B. Matching tiles at destination
- Any elevation is possible

-----

On-Tile:
- Point along ray at which tile is opaque.
- Test elevation at that location to determine if moving onto tile

Off-Tile:
- Point along ray at which tile is transparent.
- Fall or fly to next tile or terrain.
- Only need to measure if on a tile

Off-Tile, terrain:
- Point along ray at which terrain exceeds tile height
- On terrain until

--> If on terrain: find next on-tile point
--> If on tile: find next off-tile point or off-tile-terrain point

Flight:
--> If on terrain: find next terrain cliff
--> If on tile: again, next off tile point

*/


/* Testing
api = game.modules.get("elevatedvision").api
TravelElevation = api.TravelElevation
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
draw = new Draw()

draw.clearDrawings()
draw.clearLabels()

let [token1, token2] = canvas.tokens.controlled;
A = token1.center
B = token2.center
token = token1
travelRay = new Ray(A, B)

te = new TravelElevation(token, travelRay)
te.draw()

results = te.calculateElevationAlongRay();
TravelElevation.drawResults(results)

te.fly = true;
results = te.calculateElevationAlongRay();
TravelElevation.drawResults(results)

// Test tile cache coordinates
[tile] = canvas.tiles.placeables
cache = tile._textureData._evPixelCache
cache.draw()

// Bench the elevation calculation
function benchCreation(token, travelRay) {
  return new TravelElevation(token, travelRay);
}

function benchCalc(te) {
  te.clear();
  return te.calculateElevationAlongRay();
}

N = 1000
await foundry.utils.benchmark(benchCreation, N, token, travelRay)
await foundry.utils.benchmark(benchCalc, N, te)

// Farmhouse: right side of outhouse --> middle
benchCreation | 1000 iterations | 18.1ms | 0.0181ms per
commons.js:1729 benchCalc | 1000 iterations | 150.1ms | 0.15009999999999998ms per

// With changes
benchCreation | 1000 iterations | 15.6ms | 0.0156ms per
commons.js:1729 benchCalc | 1000 iterations | 32.9ms | 0.0329ms per

// Farmhouse: middle --> middle of farmhosue
benchCreation | 1000 iterations | 16.3ms | 0.016300000000000002ms per
commons.js:1729 benchCalc | 1000 iterations | 279.8ms | 0.2798ms per

// With changes
benchCreation | 1000 iterations | 15.1ms | 0.015099999999999999ms per
commons.js:1729 benchCalc | 1000 iterations | 21.6ms | 0.0216ms per






// Test tile transparency
tile = te.tiles[0]
te._findTileHole(tile)

// Bench getting the next transparent value along a ray
let [tile] = canvas.tiles.placeables
cache = tile._textureData._evPixelCache;
pixelThreshold = 0.90 * 255;
cmp = value => value < pixelThreshold;

function bench1(cache) {
  return cache.nextPixelValueAlongCanvasRay(travelRay, cmp, { stepT: .02, startT: 0 });
}

function bench2(cache, spacer) {
  return cache.nextPixelValueAlongCanvasRay(travelRay, cmp, { stepT: .02, startT: 0, spacer});
}

function bench3(cache, token, skip) {
  return cache.nextPixelValueAlongCanvasRay(travelRay, cmp, { stepT: .02, startT: 0, frame: token.bounds, skip });
}

bench1(cache)
bench2(cache, 25)
bench3(cache, token1, 2)


N = 1000
await foundry.utils.benchmark(bench1, N, cache)
await foundry.utils.benchmark(bench2, N, cache, 25)
await foundry.utils.benchmark(bench3, N, cache, token1, 1)
await foundry.utils.benchmark(bench3, N, cache, token1, 2)
await foundry.utils.benchmark(bench3, N, cache, token1, 4)
await foundry.utils.benchmark(bench3, N, cache, token1, 10)

*/

/** @enum {hex} */
// For debugging
const STATE_COLOR = [Draw.COLORS.green, Draw.COLORS.orange, Draw.COLORS.blue];

/**
 * Class to handle measuring elevation along a ray, representing a token travel path.
 */
export class TravelElevation {
  /** @enum {number} */
  static TOKEN_ELEVATION_STATE = {
    TERRAIN: 0, // Important that terrain is set to zero, so it can be checked for true/false.
    TILE: 1,
    FLY: 2
  };

  static #maximumPixelValue = 255;

  /** @type {PIXI.Rectangle|PIXI.Polygon} */
  #tokenShape;

  /** @type {Token} */
  token;

  /** @type {Ray} */
  #travelRay;

  /** @type {Tile[]} */
  #tiles;

  /** @type {number} */
  #stepT = 0.1;

  // ----- NOTE: Preset Configuration Parameters ----- //

  /** @type {number} */
  alphaThreshold = CONFIG[MODULE_ID]?.alphaThreshold ?? 0.75;

  /** @type {boolean} */
  fly = TravelElevation.autoElevationFly();

  /** @type {number} */
  tileStep = 1;

  /** @type {number} */
  terrainStep = 1;

  /** @type {number} */
  averageTerrain = 0;

  /** @type {number} */
  averageTiles = 0;

  constructor(token, travelRay) {
    this.token = token;
    this.travelRay = travelRay;

    // Tile and terrain steps based on token size.
    const tokenHeight = token.topE - token.bottomE;
    this.tileStep = CONFIG[MODULE_ID]?.tileStep ?? (tokenHeight || canvas.elevation.elevationStep);
    this.terrainStep = CONFIG[MODULE_ID]?.terrainStep ?? (tokenHeight || canvas.elevation.elevationStep);

    this.averageTerrain = averageTerrainSetting();
    this.averageTiles = averageTilesSetting();
  }

  // ----- NOTE: Static Methods ----- //

  /**
   * Determine if token elevation should be preferred
   * @returns {boolean}  True if token elevation (flying) is preferred
   */
  static autoElevationFly() {
    if ( !getSceneSetting(SETTINGS.AUTO_ELEVATION) || !getSetting(SETTINGS.FLY_BUTTON) ) return false;
    const token_controls = ui.controls.controls.find(elem => elem.name === "token");
    const fly = token_controls.tools.find(elem => elem.name === SETTINGS.FLY_BUTTON);
    return fly?.active;
  }

  // ----- NOTE: Getters/Setters ----- //

  /**
   * Travel ray represents the path the token will take.
   * @type {Ray}
   */
  get travelRay() { return this.#travelRay; }

  set travelRay(ray) {
    this.clear();

    // Set a function on the ray to transform points to t values.
    const rayTConversion = Math.abs(ray.dx) > Math.abs(ray.dy)
      ? function(pt) { return (pt.x - this.A.x) / this.dx; }
      : function(pt) { return (pt.y - this.A.y) / this.dy; }
 //      pt => (pt.x - this.A.x) / this.dx
//       : pt => (pt.y - this.A.y) / this.dy;
    ray.tConversion = rayTConversion;

    // Make sure t0 is set on the ray endpoints; used in calculateElevationAlongRay.
    ray.A.t0 = 0;
    ray.B.t0 = 1;

    // When stepping along the ray, move in steps based on the grid precision.
    const gridPrecision = canvas.walls.gridPrecision;
    const interval = Math.max(canvas.grid.w / gridPrecision, canvas.grid.h / gridPrecision);

    this.#stepT = interval / ray.distance;
    this.#travelRay = ray;
  }

  /**
   * Tiles that are within the bounds of the ray.
   * @type {Tile[]}
   */
  get tiles() {
    return this.#tiles || (this.#tiles = this._elevationTilesOnRay());
  }

  /**
   * Intersection points between tiles and the travel ray.
   * @type {Point[]}
   */
  get tileIxs() { return this._tileRayIntersections(); }

  /**
   * Terrain elevation points along the ray.
   * @type {Point3d[]}
   */
  get terrainElevations() { return this.calculateTerrainElevationsAlongRay(); }

  /**
   * Border of the token, accounting for grid shape.
   * @type {PIXI.Rectangle|PIXI.Polygon}/
   */
  get tokenShape() {
    if ( typeof this.#tokenShape === "undefined" ) {
      const token = this.token;
      const tokenCenter = token.center;
      const tokenTL = token.getTopLeft(tokenCenter.x, tokenCenter.y);
      this.#tokenShape = canvas.elevation._tokenShape(tokenTL, token.w, token.h);
    }
    return this.#tokenShape;
  }

  _getTokenShape(currLocation) {
    const { token, averageTiles } = this;
    if ( averageTiles ) {
      const origCenter = token.center;
      const dx = currLocation.x - origCenter.x;
      const dy = currLocation.y - origCenter.y;
      return this.tokenShape.translate(dx, dy);
    }
    return undefined;
  }

  /**
   * "Cliffs" whereby terrain drops more than terrainStep
   * @returns {Point3d[]}
   */
  get terrainCliffs() {
    const terrainStep = this.terrainStep;
    const tes = this.terrainElevations;
    const ln = tes.length;
    if ( ln < 2 ) return [];
    const ixs = [];
    let currE = tes[0].e;
    for ( let i = 1; i < ln; i += 1 ) {
      const te = tes[i];
      if ( te.e < (currE + terrainStep) ) ixs.push(te);
      currE = te.e;
    }
    return ixs;
  }

  clear() {
    this.#tiles = undefined;
  }


  /**
   * For this ray, determine terrain changes along the path.
   * @returns [Point3d[]]  3d point array representing points at which elevation changes.
   * Each point represents the terrain at that point and rightward (A --> B) along the ray.
   * Averaging is not accounted for.
   */
  calculateTerrainElevationsAlongRay() {
    const travelRay = this.travelRay;
    const stepT = this.#stepT;
    const ev = canvas.elevation;
    const evCache = ev.elevationPixelCache;
    const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;

    // Localize the ray for speed.
    const A = evCache._fromCanvasCoordinates(travelRay.A.x, travelRay.A.y);
    const B = evCache._fromCanvasCoordinates(travelRay.B.x, travelRay.B.y);
    const localRay = new Ray(A, B);

    // Array of 3d points
    const out = [];

    // Function to test if the given pixel has changed versus last.
    let currValue;
    const cmp = value => !value.almostEqual(currValue);

    // Initialize and loop until the ray is traversed.
    let t = 0;
    while ( t < 1 ) {
      const local = evCache._nextPixelValueAlongLocalRay(localRay, cmp, stepT, t);
      if ( local ) {
        let pt = evCache._toCanvasCoordinates(local.x, local.y);
        let e = ev.pixelValueToElevation(local.value);
        let z = gridUnitsToPixels(e);
        let pt3d = new Point3d(pt.x, pt.y, z);
        pt3d.e = e;
        pt3d.t0 = local.t0;
        out.push(pt3d);
        t = local.t0 + stepT; // + stepT;
        currValue = local.value;

      } else t = 1;
    }

    // Don't need the B point if it did not change.
    return out;
  }

  /**
   * For this ray, determine the final elevation of the token.
   * In some situations, this can be done without examining all the points in-between.
   * @param {number} startElevation   Optional starting elevation of the token
   */
  calculateFinalElevation(startElevation) {
    const { fly, token, travelRay } = this;
    const { currState, currE } = this.currentTokenState({ tokenCenter: travelRay.A, tokenElevation: startElevation });

    // If token is flying but flying is not enabled, no auto-elevation.
    if ( currState === FLY && !fly ) return startElevation;

    // If flying not enabled and no tiles present, can simply rely on terrain elevations throughout.
    if ( !fly ) {
      if ( !this.tiles.length ) return tokenTerrainElevation(token, { tokenCenter: travelRay.B });

      const { averageTiles, alphaThreshold } = this;
      const tokenCenter = travelRay.B;
      const tokenShape = this._getTokenShape(tokenCenter);
      let tileAtDestination = false;
      for ( const tile of this.tiles ) {
        tileAtDestination ||= tileOpaqueAt(tile, tokenCenter, averageTiles, alphaThreshold, tokenShape);
      }
      if ( !tileAtDestination ) return tokenTerrainElevation(token, { tokenCenter });
    }

    // Tiles are present and/or flying is enabled.
    const res = fly
      ? this._trackElevationChangesWithFlight(currE, currState)
      : this._trackElevationChanges(currE, currState);
    return res.finalElevation;
  }

  /**
   * @typedef TravelElevationResults
   * @property {Token} token                Reference to the token used for the measurements
   * @property {Ray} travelRay              Reference to the travel ray used
   * @property {boolean} checkTerrain       Whether terrain must be checked along the ray
   * @property {boolean} trackingRequired   Does the ray cross 1 or more tiles or is fly toggled on?
   * @property {number} startElevation      Token elevation at endpoint A of the ray
   * @property {number} endElevation        Token elevation at endpoint B of the ray
   */

  /**
   * For this token and ray, determine the elevation changes along the path.
   * Note: When the token is on the terrain, its elevation should be measured using the
   * terrain elevation tools. The results here will demarcate elevation changes due to
   * tiles or cliffs along the ray.
   * @param {number} startElevation   Optional starting elevation of the token
   * @returns {TravelElevationResults}
   */
  calculateElevationAlongRay(startElevation) {
    const { fly, token, travelRay } = this;
    startElevation ??= token.bottomE;

    // Default TravelElevationResults if no calculations required.
    const out = {
      token,
      travelRay,
      adjustElevation: false,
      checkTerrain: false,
      trackingRequired: false,
      startElevation,
      finalElevation: startElevation,
      elevationChanges: []
    };

    const { currState, currE } = this.currentTokenState({ tokenCenter: travelRay.A, tokenElevation: startElevation });
    if ( currState === FLY && !fly ) return out;

    // If flying not enabled and no tiles present, can simply rely on terrain elevations throughout.
    out.checkTerrain = true;
    out.adjustElevation = true;
    if ( !fly && !this.tiles.length ) {
      out.finalElevation = tokenTerrainElevation(token, { tokenCenter: travelRay.B });
      return out;
    }

    // Tiles are present and/or flying is enabled.
    out.trackingRequired = true;
    const { finalElevation, elevationChanges } = fly
      ? this._trackElevationChangesWithFlight(currE, currState)
      : this._trackElevationChanges(currE, currState);
    out.finalElevation = finalElevation;
    out.elevationChanges = elevationChanges;
    return out;
  }

  /**
   * Track elevation changes along a ray
   */
  _trackElevationChanges(startElevation, currState) {
    const tileIxs = this.tileIxs;
    const ev = canvas.elevation;

    let currE = startElevation;
    let currTile;
    const elevationChanges = [];
    const stepT = this.#stepT;

    const {
      travelRay,
      token } = this;

    while ( tileIxs.length ) {
      const ix = tileIxs.pop();
      let nextTile;

      if ( currState === TERRAIN && ix.tileStart ) {
        // Found a tile to possibly move onto.
        // Immediately prior terrain along the ray sets the elevation for purposes of moving to a tile.
        const prevT = ix.t0 - stepT;
        const prevPt = travelRay.project(prevT);
        const prevE = ev.elevationAt(prevPt);
        if ( almostBetween(prevE, ix.e - this.tileStep, ix.e) ) nextTile = ix.tile;

      } else if ( currState === TILE && ix.tile && !ix.tileStart ) {
        // Falling through tile
        // Either:
        // 1. Jump to adjacent tile along the ray at nearly the same elevation.
        // 2. Fall to the next matching tile.
        // 3. Fall to terrain.
        const nextIx = tileIxs[tileIxs.length - 1];
        if ( nextIx?.tile
          && almostLessThan(nextIx.t0 - ix.t0, stepT)
          && almostBetween(currE, ix.e - this.tileStep, ix.e) ) {

          // Jumping to a nearby tile at nearly the same elevation.
          nextTile = nextIx.tile;
        } else {
          // Need the next matching tile or terrain; exclude the tile we are on.
          nextTile = this._findMatchingTile(ix, currE, ix.tile);
        }
      } // else if ( currState === TILE && !ix.tile ) { // Terrain pushing through the current tile.


      if ( nextTile ) [currE, currState, currTile] = [nextTile.elevationE, TILE, nextTile];
      else {
        const terrainE = tokenTerrainElevation(token, { tokenCenter: ix });

        // Do not fall "up". E.g., if in basement, don't move to terrain 0.
        [currE, currState, currTile] = [Math.min(terrainE, currE), TERRAIN, undefined];
      }

      // (5) Update the tracking results.
      elevationChanges.push({ ix, currState, currE });

      // (6) Depending on the new current state, look for additional tile or terrain intersections along the ray.
      if ( currState === TILE ) this.#locateNextTileObstacle(currTile, tileIxs, ix, currE);
    }

    let finalElevation = currE;
    if ( currState === TERRAIN ) finalElevation = tokenTerrainElevation(token, { tokenCenter: travelRay.B });

    return { finalElevation, elevationChanges };
  }

  /**
   * Track elevation changes along a ray
   */
  _trackElevationChangesWithFlight(startElevation, currState) {
    const tileIxs = [...this.tileIxs]; // Make a copy that we can modify in the loop.
    const cliffs = this.terrainCliffs;
    if ( cliffs.length ) {
      tileIxs.push(...cliffs);
      tileIxs.sort((a, b) => b.t0 - a.t0);
    }

    let currE = startElevation;
    let currTile;
    const elevationChanges = [];
    const stepT = this.#stepT;
    const { TERRAIN, TILE, FLY } = TravelElevation.TOKEN_ELEVATION_STATE;
    const {
      travelRay,
      tileStep,
      terrainStep,
      token } = this;

    // At each intersection group, update the current elevation based on ground unless already on tile.
    // If the token elevation equals that of the tile, the token is now on the tile.
    // Keep track of the seen intersections, in case of duplicates.
    const tSeen = new Set();
    while ( tileIxs.length ) {
      const ix = tileIxs.pop();
      if ( tSeen.has(ix.t0) ) continue;
      tSeen.add(ix.t0);

      // Determine the destination type and associated elevation.
      // (1) Use the immediately prior center terrain elevation or the current elevation as the start
      const prevT = ix.t0 - stepT;
      const prevPt = travelRay.project(prevT);
      const prevE = Math.max(currE, tokenTerrainElevation(token, { tokenCenter: prevPt, useAveraging: false }));

      // (2) Locate any tiles at this location with sufficiently near elevation.
      //     Update the token shape location
      const matchingTile = this._findMatchingTile(ix, prevE, prevPt);

      const terrainE = tokenTerrainElevation(token, { tokenCenter: ix });

      // (3) Check if we are on a tile
      if ( matchingTile ) {
        [currState, currE] = [TILE, matchingTile.elevationE];
      } else

      // (4) Check if we are flying and "landing"
      if ( currState === FLY ) {
        currState = almostLessThan(currE - terrainStep, terrainE) ? TERRAIN : FLY;
        if ( currState === TERRAIN ) currE = terrainE;
      } else {

        // (5) If flying is enabled, fly if the movement exceeds the step size.
        //     If there is a matching tile, we are not flying (move to tile instead)
        // if ( !matchingTile) {
        const step = currTile ? tileStep : terrainStep;
        // If the current state is terrain, get the immediately prior terrain
        if ( currState === TERRAIN ) currE = prevE;

        // (6) Otherwise, on terrain.
        [currState, currE] = ((terrainE + step) < prevE) ? [FLY, currE] : [TERRAIN, terrainE];
      }

      // (5) Remember the current tile for next iteration.
      currTile = matchingTile;

      // (6) Update the tracking results.
      elevationChanges.push({ ix, currState, currE });

      // (7) Depending on the new current state, look for additional tile or terrain intersections along the ray.
      //       const startT = ix.t0 + stepT;
      this.#locateNextObstacleWithFlight(currTile, tileIxs, ix, currE, currState);
    }

    let finalElevation = currE;
    if ( currState === TERRAIN ) finalElevation = tokenTerrainElevation(token, { tokenCenter: travelRay.B });

    return { finalElevation, elevationChanges };
  }

  /**
   * Find the tile, if any, that supports the token at the given location and elevation.
   * @param {number} tokenCenter
   * @param {number} tokenElevation
   * @param {Point} currPt            Current center of the token
   */
  _findMatchingTile(tokenCenter, tokenElevation, excludeTileId) {
    const { token, averageTiles, alphaThreshold } = this;
    const tiles = this.tiles.filter(t => t.id !== excludeTileId);
    if ( !tiles.length ) return null;
    const tokenShape = this._getTokenShape(tokenCenter);
    return tileAtTokenElevation(token, {
      tokenCenter,
      tokenElevation,
      tokenShape,
      averageTiles,
      alphaThreshold,
      tiles });
  }

  /**
   * Find next tile hole or terrain rising above tile along the ray.
   * @param {Tile} currTile
   * @param {Point3d[]} tileIxs
   * @param {Point3d} ix
   * @param {number} currE
   */
  #locateNextTileObstacle(currTile, tileIxs, ix, currE) {
    // Find next point at which the token could fall through a tile hole, if any.
    const tilePt = this._findTileHole(currTile, ix.t0 + this.#stepT);
    if ( tilePt ) this.#addIx(tileIxs, tilePt);

    // Find next location where terrain pokes through tile, if any.
    const terrainPt = this._findElevatedTerrain(currE, ix.t0 + this.#stepT);
    if ( terrainPt ) this.#addIx(tileIxs, terrainPt);
  }

  #locateNextObstacleWithFlight(currTile, tileIxs, ix, currE, currState) {
    const { tileStep } = this;

    switch ( currState ) {
//       case TERRAIN: {
//         const cliffPt = this._findTerrainCliff(ix.t0);
//         if ( cliffPt ) this.#addIx(tileIxs, cliffPt, { color: Draw.COLORS.green });
//         break;
//       }

      case TILE: {
        this.#locateNextTileObstacle(currTile, tileIxs, ix, currE);
        break;
      }

      case FLY: {
        // Check for tiles or terrain that we will run into at this flying elevation.
        const maxE = currE;
        const minE = currE - tileStep;
        const tilesWithinE = this.tiles.filter(tile => almostBetween(tile.elevationE, minE, maxE) );
        const ixs = [];
        const startT = ix.t0 + this.#stepT;
        for ( const tile of tilesWithinE ) {
          const cache = tile._textureData?._evPixelCache;
          if ( !cache ) return null;

          const ix = this._findTileStart(tile, startT);
          if ( ix ) ixs.push(ix);
        }

        // Find the elevation intersection.
        const terrainPt = this._findElevatedTerrain(minE, ix.t0 + this.#stepT);
        if ( terrainPt ) this.#addIx(tileIxs, terrainPt);

        // If any intersections, add the first one encountered along the travel ray.
        if ( !ixs.length ) break;
        ixs.sort((a, b) => a.t0 - b.t0);
        this.#addIx(tileIxs, ixs[0]);
        break;
      }
    }
  }

  #addIx(ixs, pt) {
    ixs.push(pt); // The pt should already has correct t0.
    this.#sortIxs(ixs);
  }

  /**
   * Sort intersections; prioritize:
   * 1. t0, such that lower t0s are at the end.
   * 2. tile elevations, such that higher tiles are at the end
   */
  #sortIxs(ixs) {
    ixs.sort((a, b) => (b.t0 - a.t0) || (b.e - a.e));
  }

  /**
   * Search for a terrain cliff along the ray beginning at a specified point.
   * @param {number} [startT=0]   Starting "t" along the ray, where A = 0; B = 1
   * @returns {Point|undefined} Cliff starting point or undefined if none found
   */
  _findTerrainCliff(startT=0) {
    const { travelRay, token, terrainStep } = this;
    const stepT = this.#stepT;
    const ev = canvas.elevation;
    const evCache = ev.elevationPixelCache;

    // Don't clamp the jump value so we don't extend beyond the values desired.
    const maxFallPixel = ev.elevationToPixelValue((terrainStep - ev.elevationMin) / ev.elevationStep);

    // Initialize with the start value
    const pt = travelRay.project(startT);
    const currE = tokenTerrainElevation(token, { tokenCenter: pt });
    startT += stepT;

    // Function to test if the given pixel is more than the allowable terrain step.
    let currPixelValue = ev.elevationToPixelValue(currE);
    const cmp = value => {
      if ( value < (currPixelValue - maxFallPixel) ) return true;
      currPixelValue = value;
      return false;
    };

    const opts = { stepT, startT };
    if ( this.averageTerrain ) {
      opts.frame = this.token.bounds;
      opts.skip = this.averageTerrain;
    }

    const ix = evCache.nextPixelValueAlongCanvasRay(travelRay, cmp, opts);
    if ( !ix ) return null;
    ix.e = ev.pixelValueToElevation(ix.value);
    return ix;
  }

  /**
   * Search for a transparent tile location along the ray beginning at a specified point.
   * @param {Tile} tile           Tile to test
   * @param {number} [startT=0]   Starting point along the travel ray. A = 0; B = 1.
   * @returns {Point|undefined} First transparent tile point or undefined if none found.
   */
  _findTileHole(tile, startT=0) {
    const { travelRay, alphaThreshold } = this;
    const stepT = this.#stepT;

    const cache = tile._textureData?._evPixelCache;
    if ( !cache ) return null;

    // Function to test if the given pixel is under the threshold.
    const pixelThreshold = alphaThreshold * TravelElevation.#maximumPixelValue;
    const cmp = value => value <= pixelThreshold;

    const opts = { stepT, startT };
    if ( this.averageTiles ) {
      opts.frame = this.token.bounds;
      opts.skip = this.averageTile;
    }

    const ix = cache.nextPixelValueAlongCanvasRay(travelRay, cmp, opts);
    if ( !ix ) return null;

    // TO-DO: Could use Point3d here and set z value to elevationZ.
    // May be helpful for flagging difficulty checks for large climbs/falls.
    ix.e = tile.elevationE;
    ix.tile = tile;
    return ix;
  }

  /**
   * Search for a non-transparent tile location along the ray beginning at a specified point.
   * @param {Tile} tile           Tile to test
   * @param {number} [startT=0]   Starting point along the travel ray. A = 0; B = 1.
   * @returns {Point|undefined} First transparent tile point or undefined if none found.
   */
  _findTileStart(tile, startT=0) {
    const { travelRay, alphaThreshold } = this;
    const stepT = this.#stepT;

    const cache = tile._textureData?._evPixelCache;
    if ( !cache ) return null;

    // Test starting location based on alpha boundary of the tile.
    const { ixs, aInside, bInside } = cache.rayIntersectsBoundary(travelRay, alphaThreshold);
    if ( ixs.length ) {
      if ( aInside ) {
        // Intersection is where tile becomes transparent along ray.
        if ( startT >= ixs[0].t0 ) return null;
      } else if ( bInside ) {
        // Intersection is where tile becomes solid along ray.
        // Use set steps to avoid issues with rounding.
        const quotient = ~~(ixs[0].t0 / stepT);
        startT = Math.max(stepT * quotient, startT);

      } else {
        // Neither inside; first intersection becomes solid; second becomes transparent.
        if ( startT > ixs[1].t0 ) return null;
        const quotient = ~~(ixs[0].t0 / stepT);
        startT = Math.max(stepT * quotient, startT);
      }
    }

    // Function to test if the given pixel is within the threshold.
    const pixelThreshold = alphaThreshold * TravelElevation.#maximumPixelValue;
    const cmp = value => value > pixelThreshold;

    const opts = { stepT, startT };
    if ( this.averageTiles ) {
      opts.frame = this.token.bounds;
      opts.skip = this.averageTile;
    }

    const ix = cache.nextPixelValueAlongCanvasRay(travelRay, cmp, opts);
    if ( !ix ) return null;

    // TO-DO: Could use Point3d here and set z value to elevationZ.
    // May be helpful for flagging difficulty checks for large climbs/falls.
    ix.e = tile.elevationE;
    ix.tile = tile;
    ix.tileStart = true;
    return ix;
  }

  /**
   * Search for terrain that exceeds a specified elevation.
   * @param {number} [elevationThreshold=0]   Minimum elevation
   * @param {number} [startT=0]               Starting "t" along the ray. A = 0; B = 1.
   * @returns {Point|undefined} First point that meets the threshold or undefined if none.
   */
  _findElevatedTerrain(elevationThreshold=0, startT=0) {
    const { travelRay } = this;
    const stepT = this.#stepT;
    const ev = canvas.elevation;
    const evCache = ev.elevationPixelCache;

    // Function to test if the given pixel exceeds the threshold.
    const pixelThreshold = ev.elevationToPixelValue(elevationThreshold);
    const cmp = value => value > pixelThreshold;

    const opts = { stepT, startT };
    if ( this.averageTerrain ) {
      opts.frame = this.token.bounds;
      opts.skip = this.averageTerrain;
    }

    return evCache.nextPixelValueAlongCanvasRay(travelRay, cmp, opts);
  }

  /**
   * Determine the current state of this token
   * @param {object} [options]    Options that modify the token parameters
   * @param {Point} [options.tokenCenter]       Center of the token
   * @param {number} [options.tokenElevation]   Elevation of the token
   * @returns {TOKEN_ELEVATION_STATE}
   */
  currentTokenState({ tokenCenter, tokenElevation } = {}) {
    const { token, tileStep, terrainStep, averageTiles, alphaThreshold, tiles } = this;
    const matchingTile = tileAtTokenElevation(token, {
      tokenCenter,
      tokenElevation,
      averageTiles,
      alphaThreshold,
      tiles });

    if ( matchingTile ) {
      const tileE = matchingTile.elevationE;
      if ( almostBetween(tileE, tokenElevation - tileStep, tokenElevation) )
        return { currE: tileE, currState: TILE };
    }

    const terrainE = tokenTerrainElevation(token, { tokenCenter });
    if ( almostBetween(terrainE, tokenElevation - terrainStep, tokenElevation) )
      return { currE: terrainE, currState: TERRAIN };

    return { currE: tokenElevation, currState: FLY };
  }

  /**
   * Determine the current state of this token
   * @param {object} [options]    Options that modify the token parameters
   * @param {Point} [options.tokenCenter]       Center of the token
   * @param {number} [options.tokenElevation]   Elevation of the token
   * @returns {TOKEN_ELEVATION_STATE}
   */
  static currentTokenState(token, { tokenCenter, tokenElevation }) {
    tokenCenter ??= token.center;
    tokenElevation ??= token.bottomE;
    const matchingTile = tileAtTokenElevation(token, {
      tokenCenter,
      tokenElevation });

    const tokenHeight = token.topE - token.bottomE;
    const terrainStep = CONFIG[MODULE_ID]?.terrainStep ?? (tokenHeight || canvas.elevation.elevationStep);
    if ( matchingTile ) {
      const tileStep = CONFIG[MODULE_ID]?.tileStep ?? (tokenHeight || canvas.elevation.elevationStep);
      const tileE = matchingTile.elevationE;
      if ( almostBetween(tileE, tokenElevation - tileStep, tokenElevation) ) return { currE: tileE, currState: TILE };
    }

    const terrainE = tokenTerrainElevation(token, { tokenCenter });
    if ( almostBetween(terrainE, tokenElevation - terrainStep, tokenElevation) )
      return { currE: terrainE, currState: TERRAIN };

    return { currE: tokenElevation, currState: FLY };
  }


  /**
   * Find overhead elevation tiles along a line segment (ray).
   * @param {Ray} ray
   * @returns {Tile[]}
   */
  _elevationTilesOnRay() {
    const ray = this.travelRay;
    const collisionTest = (o, _rect) => o.t.document.overhead && isFinite(o.t.elevationZ);
    const tiles = [...canvas.tiles.quadtree.getObjects(ray.bounds, { collisionTest })];

    // Sort tiles by elevation, highest to lowest.
    // This will help with finding relevant tiles later.
    // TODO: Take advantage of sorting in elevationForTokenTravel
    tiles.sort((a, b) => b.elevationZ - a.elevationZ);
    return tiles;
  }

  /**
   * Find the tile intersections with the travel ray.
   * (Formerly _organizeTiles)
   * @returns {Point[]}
   */
  _tileRayIntersections() {
    const tileIxs = [];
    for ( const tile of this.tiles ) {
      const cache = tile._textureData?._evPixelCache;
      if ( !cache ) continue;

      const ix = this._findTileStart(tile);
      if ( ix ) tileIxs.push(ix);
    }

    // Make closest intersection to A last in the queue, so we can pop it.
    this.#sortIxs(tileIxs);

    // Add the start (and end?) of the travel ray.
    // tileIxs.unshift(this.travelRay.B);
    // tileIxs.push(this.travelRay.A);

    return tileIxs;
  }

  /**
   * For debugging, draw the ray and tile alpha boundaries.
   */
  draw() {
    Draw.segment(this.travelRay);
    for ( const tile of this.tiles ) {
      const cache = tile._textureData?._evPixelCache;
      if ( !cache ) {
        Draw.shape(tile.getBounds, { color: Draw.COLORS.red });
        continue;
      }
      const bounds = cache.getThresholdCanvasBoundingBox(this.alphaThreshold);
      Draw.shape(bounds, { color: Draw.COLORS.yellow});
    }
  }

  /**
   * For debugging, draw a representation of the resulting elevation changes along the ray.
   * @param {TravelElevationResults} results
   */
  static drawResults(results) {
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
   * For debugging, draw the terrain elevations.
   */
  drawTerrainElevations() {
    const color = Draw.COLORS.green;
    Draw.segment(this.travelRay, { color });

    const tes = this.terrainElevations;
    for ( const te of tes ) {
      Draw.point(te, { color });
      Draw.labelPoint(te, te.e);
    }
  }
}

const { TERRAIN, TILE, FLY } = TravelElevation.TOKEN_ELEVATION_STATE;
