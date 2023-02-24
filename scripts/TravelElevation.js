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
// import { Point3d } from "./geometry/3d/Point3d.js";
import { getSetting, getSceneSetting, SETTINGS } from "./settings.js";
import { TokenElevation, tileOpaqueAt, tileOpaqueAverageAt } from "./tokens.js";
import { PixelCache } from "./PixelCache.js";


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
te.tiles.forEach(tile => draw.shape(tile.bounds, { color: Draw.COLORS.gray }))

results = te.calculateElevationAlongRay();
TravelElevation.drawResults(results)

finalE = te.calculateFinalElevation()

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

function benchFinalCalc(te) {
  te.clear();
  return te.calculateFinalElevation();
}


N = 10000
await foundry.utils.benchmark(benchCreation, N, token, travelRay)
await foundry.utils.benchmark(benchCalc, N, te)
await foundry.utils.benchmark(benchFinalCalc, N, te)

// Farmhouse: right side of outhouse --> middle
benchCreation | 1000 iterations | 18.1ms | 0.0181ms per
commons.js:1729 benchCalc | 1000 iterations | 150.1ms | 0.15009999999999998ms per

// With changes
benchCreation | 1000 iterations | 15.6ms | 0.0156ms per
commons.js:1729 benchCalc | 1000 iterations | 32.9ms | 0.0329ms per

// Averaging
benchCreation | 1000 iterations | 12.3ms | 0.0123ms per
commons.js:1729 benchCalc | 1000 iterations | 533.3ms | 0.5333ms per

// Farmhouse: middle --> middle of farmhouse
benchCreation | 1000 iterations | 16.3ms | 0.016300000000000002ms per
commons.js:1729 benchCalc | 1000 iterations | 279.8ms | 0.2798ms per

// With changes
benchCreation | 1000 iterations | 15.1ms | 0.015099999999999999ms per
commons.js:1729 benchCalc | 1000 iterations | 21.6ms | 0.0216ms per

// Averaging
benchCreation | 1000 iterations | 10.7ms | 0.0107ms per
commons.js:1729 benchCalc | 1000 iterations | 170.2ms | 0.1702ms per

tile = te.tokenElevation.tiles[0];
tokenCenter = te.tokenCenter;
averageTiles = 4;
alphaThreshold = .75
tokenShape = te._getTokenShape(tokenCenter)

canvas.elevation.tokens.tileOpaqueAt(tile, tokenCenter, averageTiles, alphaThreshold, tokenShape)
canvas.elevation.tokens.tokenSupportedByTile(tile, tokenCenter, averageTiles, alphaThreshold, tokenShape)

N = 10000
await foundry.utils.benchmark(canvas.elevation.tokens.tileOpaqueAt, N, tile, tokenCenter, averageTiles, alphaThreshold, tokenShape)
await foundry.utils.benchmark(canvas.elevation.tokens.tokenSupportedByTile, N, tile, tokenCenter, averageTiles, alphaThreshold, tokenShape)

50% tile:
tileOpaqueAt | 10000 iterations | 128.7ms | 0.01287ms per
tokenSupportedByTile | 10000 iterations | 37.1ms | 0.00371ms per




// Test tile transparency
tile = te.tiles[0]
te._findTileHole(tile)

// Test getting tile average within token
tile = te.tiles[0]
cache = tile._textureData._evPixelCache;
cache.drawLocal();
rect = _token.bounds;
localRect = cache._shapeToLocalCoordinates(rect)

draw.shape(localRect, { fill: Draw.COLORS.red, fillAlpha: 0.2 })

let sum = 0
averageFn = value => sum += value;
denom = cache._applyFunction(averageFn, localRect, 1);

let sum = 0
denom = cache._applyFunctionWithSkip(averageFn, localRect, 1);

cache.average(_token.bounds)
cache.average(_token.bounds, 2)

function bench1(localRect, skip) {
  let sum = 0
  const averageFn = value => sum += value;
  const denom = cache._applyFunctionWithoutSkip(averageFn, localRect, skip);
  return sum/denom;
}

function bench2(localRect, skip) {
  let sum = 0
  const averageFn = value => sum += value;
  const denom = cache._applyFunctionWithSkip(averageFn, localRect, skip);
  return sum/denom;
}

N = 1000
await foundry.utils.benchmark(bench1, N, localRect, 1)
await foundry.utils.benchmark(bench2, N, localRect, 1)

function average(rect, skip) {
  return cache.average(rect, skip);
}

N = 10000
await foundry.utils.benchmark(average, N, _token.bounds, 1)
await foundry.utils.benchmark(average, N, _token.bounds, 2)

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


N = 10000
await foundry.utils.benchmark(bench1, N, cache)
await foundry.utils.benchmark(bench2, N, cache, 25)
await foundry.utils.benchmark(bench3, N, cache, token1, 1)
await foundry.utils.benchmark(bench3, N, cache, token1, 1.1)
await foundry.utils.benchmark(bench3, N, cache, token1, 1.5)
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

  /** @type {TokenElevation} */
  tokenElevation;

  /** @type {Token} */
  #tokenShapeCenter;

  /** @type {Ray} */
  #travelRay;

  /** @type {number} */
  #stepT = 0.1;

  /** @type {number} */
  #interval = 1;

  // ----- NOTE: Preset Configuration Parameters ----- //

  /** @type {boolean} */
  fly = TravelElevation.autoElevationFly();

  /** @type {number} */
  tilePercentThreshold = 0.5;

  constructor(token, travelRay, opts = {}) {
    this.tokenElevation = new TokenElevation(token, opts);
    this.travelRay = travelRay;

    this.tokenElevation.tiles = this._elevationTilesOnRay();

    // When stepping along the ray, move in steps based on the grid precision.
    const gridPrecision = canvas.walls.gridPrecision;
    this.#interval = Math.max(canvas.grid.w / gridPrecision, canvas.grid.h / gridPrecision);
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
    // Set a function on the ray to transform points to t values.
    const rayTConversion = Math.abs(ray.dx) > Math.abs(ray.dy)
      ? function(pt) { return (pt.x - this.A.x) / this.dx; }
      : function(pt) { return (pt.y - this.A.y) / this.dy; };
 //      pt => (pt.x - this.A.x) / this.dx
//       : pt => (pt.y - this.A.y) / this.dy;
    ray.tConversion = rayTConversion;

    // Make sure t0 is set on the ray endpoints; used in calculateElevationAlongRay.
    ray.A.t0 = 0;
    ray.B.t0 = 1;

    // When stepping along the ray, move in steps based on the grid precision.
    this.#stepT = this.#interval / ray.distance;
    this.#travelRay = ray;

    // Update tiles present based on new ray.
    this.tokenElevation.tiles = this._elevationTilesOnRay();
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

        // TO-DO: Could use Point3d here and set z value to elevationZ.
        // May be helpful for flagging difficulty checks for large climbs/falls.
        // const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
        // let z = gridUnitsToPixels(e);
        // let pt3d = new Point3d(pt.x, pt.y, z);
        pt.e = ev.pixelValueToElevation(local.value);
        pt.t0 = local.t0;
        out.push(pt);
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
    startElevation ??= token.bottomE;

    const te = this.tokenElevation;
    te.tokenElevation = startElevation;
    te.tokenCenter = travelRay.A;

    const { currState, currE, currTile, terrainE } = this.currentTokenState();
    te.tokenElevation = currE;

    // If token is flying but flying is not enabled, no auto-elevation.
    if ( currState === FLY && !fly ) return startElevation;

    // If flying not enabled and no tiles present, can simply rely on terrain elevations throughout.
    if ( !fly ) {
      te.tokenCenter = travelRay.B;
      if ( !te.tiles.length || !te.findHighestTileAtToken() ) return te.terrainElevationAtToken();
    }

    // Tiles are present and/or flying is enabled.
    const res = fly
      ? this._trackElevationChangesWithFlight(currE, currState, currTile, terrainE)
      : this._trackElevationChanges(currE, currState, currTile);
    return res.finalElevation;
  }

  _terrainClose(currE, terrainE) {
    return almostBetween(currE, terrainE, terrainE + this.tokenElevation.terrainStep);
  }

  _tileClose(currE, tileE) {
    return almostBetween(currE, tileE, tileE + this.tokenElevation.tileStep);
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

    const te = this.tokenElevation;
    te.tokenElevation = startElevation;
    te.tokenCenter = travelRay.A;

    // Adjust the elevation based on the current state.
    // (Could move down to tile or terrain)
    const { currState, currE, currTile, terrainE } = this.currentTokenState();
    te.tokenElevation = currE;

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

    if ( currState === FLY && !fly ) return out;

    // If flying not enabled and no tiles present, can simply rely on terrain elevations throughout.
    out.checkTerrain = true;
    out.adjustElevation = true;
    if ( !fly && !te.tiles.length ) {
      te.tokenCenter = travelRay.B;
      out.finalElevation = te.terrainElevationAtToken();
      return out;
    }

    // Tiles are present and/or flying is enabled.
    out.trackingRequired = true;
    const { finalElevation, elevationChanges } = fly
      ? this._trackElevationChangesWithFlight(currE, currState, currTile, terrainE)
      : this._trackElevationChanges(currE, currState, currTile);
    out.finalElevation = finalElevation;
    out.elevationChanges = elevationChanges;

    // Add in the starting position and state.
//     const startingIx = travelRay.A;
//     out.elevationChanges.unshift({ix: travelRay.A, currState, currE});

    return out;
  }

  /**
   * Track elevation changes along a ray
   */
  _trackElevationChanges(currE, currState, currTile) {
    const elevationChanges = [];
    const te = this.tokenElevation;
    const travelRay = this.travelRay;
    const tileIxs = this.tileIxs;
    if ( !tileIxs.length ) {
      // Tile start never encountered; likely moving through only transparent tile portions.
      te.tokenCenter = travelRay.B;
      const finalElevation = te.terrainElevationAtToken();
      return { finalElevation, elevationChanges };
    }

    // If on terrain, add a t = 0 starting point
    // Useful to always have a t = 0 in the elevationChanges.
    const stepT = this.#stepT;
    if ( currState !== TILE ) {
      const startingPoint = travelRay.A;
      startingPoint.e = currE;
      tileIxs.push(startingPoint);
    }

    while ( tileIxs.length ) {
      const ix = tileIxs.pop();
      let nextTile;
      te.tokenElevation = currE;

      if ( currState === TERRAIN && ix.tileStart ) {
        // Found a tile to possibly move onto.
        // Immediately prior terrain along the ray sets the elevation for purposes of moving to a tile.
        const prevT = ix.t0 - stepT;
        const prevPt = travelRay.project(prevT);
        te.tokenCenter = prevPt;

        if ( this._canMoveOntoTile(ix.tile) ) nextTile = ix.tile;

      } else if ( currState === TILE && ix.tile && !ix.tileStart ) {
        // Falling through tile
        // Either:
        // 1. Jump to adjacent tile along the ray at nearly the same elevation.
        // 2. Fall to the next matching tile.
        // 3. Fall to terrain.
        const nextIx = tileIxs[tileIxs.length - 1];
        if ( nextIx?.tile
          && nextIx.tile !== currTile
          && almostLessThan(nextIx.t0 - ix.t0, stepT)
          && te.tileWithinStep(nextIx.tile) ) {

          // Jumping to a nearby tile at nearly the same elevation.
          nextTile = nextIx.tile;
        } else {
          // Need the next matching tile or terrain; exclude the tile we are on.
          te.tokenCenter = ix;
          nextTile = te.findTileBelowToken(ix.tile);
        }
      } else if ( currState === TILE && ix.tile === currTile ) {
        // Started on a tile and ending on that tile.
        nextTile = currTile;
      }

      //else if ( currState === TILE && !ix.tile ) {
        // Terrain pushing through the current tile.
        //nextTile = undefined;
      //}


      if ( nextTile ) [currE, currState, currTile] = [nextTile.elevationE, TILE, nextTile];
      else {
        te.tokenCenter = ix;
        const terrainE = te.terrainElevationAtToken();

        // Do not fall "up". E.g., if in basement, don't move to terrain 0.
        [currE, currState, currTile] = [Math.min(terrainE, currE), TERRAIN, undefined];
      }

      // (5) Update the tracking results.
      elevationChanges.push({ ix, currState, currE });

      // (6) Depending on the new current state, look for additional tile or terrain intersections along the ray.
      if ( currState === TILE ) this.#locateNextTileObstacle(currTile, tileIxs, ix.t0, currE);
    }

    let finalElevation = currE;
    if ( currState === TERRAIN ) {
      te.tokenCenter = travelRay.B;
      finalElevation = te.terrainElevationAtToken();
    }

    return { finalElevation, elevationChanges };
  }

  /**
   * Track elevation changes along a ray
   */
  _trackElevationChangesWithFlight(currE, currState, currTile, terrainE) {
    const elevationChanges = [];
    const te = this.tokenElevation;
    const travelRay = this.travelRay;
    const tileIxs = this.tileIxs; // Even if none present, still may need to check for cliffs.

    const stepT = this.#stepT;
    if ( currState !== TILE ) {
      const startingPoint = travelRay.A;
      startingPoint.e = currE;
      tileIxs.push(startingPoint);
    }

    while ( tileIxs.length ) {
      const ix = tileIxs.pop();
      let nextTile;
      te.tokenElevation = currE;
      let fly = false;

      if ( currState === TERRAIN && ix.tileStart ) {
        // Found a tile to possibly move onto.
        // Immediately prior terrain along the ray sets the elevation for purposes of moving to a tile.
        const prevT = ix.t0 - stepT;
        const prevPt = travelRay.project(prevT);
        const prevE = ev.elevationAt(prevPt);
        if ( this._canMoveOntoTile(ix.tile) ) nextTile = ix.tile;

      } else if ( currState === TERRAIN && ix.cliff ) {
        // Fly instead of falling into cliff.
        fly = true;

      } else if ( currState === TILE && ix.tile && !ix.tileStart ) {
        // Falling through tile
        // Either:
        // 1. Jump to adjacent tile along the ray at nearly the same elevation.
        // 2. Fall to the next matching tile w/in tileStep.
        // 3. Fall to terrain w/in terrainStep.
        // 4. Fly
        const nextIx = tileIxs[tileIxs.length - 1];
        if ( nextIx?.tile
          && nextIx.tile !== currTile
          && almostLessThan(nextIx.t0 - ix.t0, stepT)
          && te.tileWithinStep(nextIx.tile) ) {

          // Jumping to a nearby tile at nearly the same elevation.
          nextTile = nextIx.tile;
        } else {
          // Need the next matching tile or terrain; exclude the tile we are on.
          te.tokenCenter = ix;
          nextTile = te.findTileBelowToken(ix.tile);
          if ( nextTile ) {
            if ( !te.tileWithinStep(nextTile) ) fly = true;
          } else {
            if ( !te.terrainWithinStep() ) fly = true;
          }
        }

      } else if ( currState === TILE && (ix.tile === currTile || ix.cliff) ) {
        // Started on a tile and ending on that tile.
        nextTile = currTile;

      // } else if ( currState === TILE && !ix.tile ) {
        // Terrain pushing through the current tile.
        // nextTile = undefined;

      } else if ( currState === FLY ) {
        te.tokenCenter = ix;

        fly = true;
        // Land if close enough to the tile
        if ( ix.tile && te.tileWithinStep(ix.tile) ) {
          fly = false;
          nextTile = ix.tile;
        } else if ( te.terrainWithinStep() ) fly = false; // Land if close enough to terrain

      }

      if ( fly ) {
        // If currently on terrain, get the prior terrain elevation.
        if ( currState === TERRAIN ) {
          const prevT = ix.t0 - stepT;
          const prevPt = travelRay.project(prevT);
          te.tokenCenter = prevPt;
          currE = te.terrainElevationAtToken(prevPt);
        }
        // Do not fall "up". E.g., if in basement, don't move to terrain 0.
        // currE = currE
        [currState, currTile] = [FLY, undefined];
      } else if ( nextTile ) {
        [currE, currState, currTile] = [nextTile.elevationE, TILE, nextTile];
      } else {
        te.tokenCenter = ix;
        const terrainE = te.terrainElevationAtToken();
        // Do not fall "up". E.g., if in basement, don't move to terrain 0.
        [currE, currState, currTile] = [Math.min(terrainE, currE), TERRAIN, undefined];
      }

      // (5) Update the tracking results.
      elevationChanges.push({ ix, currState, currE });

      // (6) Depending on the new current state, look for additional tile or terrain intersections along the ray.
      this.#locateNextObstacleWithFlight(currTile, tileIxs, ix.t0, currE, currState);
    }

    let finalElevation = currE;
    if ( currState === TERRAIN ) {
      te.tokenCenter = travelRay.B;
      finalElevation = te.terrainElevationAtToken();
    }

    return { finalElevation, elevationChanges };
  }

  /**
   * Can the token move to a given tile?
   */
  _canMoveOntoTile(tile) {
    const te = this.tokenElevation;
    const tileE = tile.elevationE;
    if ( te.averageTiles ) return te.tileCouldSupportToken(tile);

    // If the terrain at this location is within step of tile, token can move to tile.
    const terrainE = canvas.elevation.elevationAt(te.tokenCenter);
    te.tokenElevation = terrainE;
    return te.tileWithinStep(tile);
  }

  /**
   * Find next tile hole or terrain rising above tile along the ray.
   * @param {Tile} currTile
   * @param {Point3d[]} tileIxs
   * @param {Point3d} ix
   * @param {number} currE
   */
  #locateNextTileObstacle(currTile, tileIxs, t, currE) {
    // Find next point at which the token could fall through a tile hole, if any.
    const tilePt = this._findTileHole(currTile, t + this.#stepT);
    if ( tilePt ) this.#addIx(tileIxs, tilePt);

    // Find next location where terrain pokes through tile, if any.
    const terrainPt = this._findElevatedTerrain(currE, t + this.#stepT);
    if ( terrainPt ) this.#addIx(tileIxs, terrainPt);
  }

  #locateNextObstacleWithFlight(currTile, tileIxs, t, currE, currState) {
    switch ( currState ) {
      case TERRAIN: {
        const cliffPt = this._findTerrainCliff(t);
        if ( cliffPt ) this.#addIx(tileIxs, cliffPt);
        break;
      }

      case TILE: {
        this.#locateNextTileObstacle(currTile, tileIxs, t, currE);
        break;
      }

      case FLY: {
        // Check for tiles or terrain that we will run into at this flying elevation.
        const { tileStep, terrainStep, tiles } = this.tokenElevation;
        const maxE = currE;
        const minE = currE - tileStep;
        const tilesWithinE = tiles.filter(tile => almostBetween(tile.elevationE, minE, maxE) );
        const ixs = [];
        const startT = t + this.#stepT;
        for ( const tile of tilesWithinE ) {
          const cache = tile._textureData?._evPixelCache;
          if ( !cache ) return null;

          const ix = this._findTileStart(tile, startT);
          if ( ix ) ixs.push(ix);
        }

        // Find the elevation intersection.
        const minTerrainE = currE - terrainStep;
        const terrainPt = this._findElevatedTerrain(minTerrainE, t + this.#stepT);
        if ( terrainPt ) this.#addIx(tileIxs, terrainPt);

        // If any intersections, add the first one encountered along the travel ray.
        if ( !ixs.length ) break;
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
    const travelRay = this.travelRay;
    const te = this.tokenElevation
    const stepT = this.#stepT;
    const ev = canvas.elevation;
    const evCache = ev.elevationPixelCache;

    // Don't clamp the jump value so we don't extend beyond the values desired.
    const maxFallPixel = ev.elevationToPixelValue((te.terrainStep - ev.elevationMin) / ev.elevationStep);

    // Initialize with the start value
    const pt = travelRay.project(startT);
    te.tokenCenter = pt;
    const currE = te.terrainElevationAtToken();
    startT += stepT;

    // Function to test if the given pixel is more than the allowable terrain step.
    let currPixelValue = ev.elevationToPixelValue(currE);
    const cmp = value => {
      if ( value < (currPixelValue - maxFallPixel) ) return true;
      currPixelValue = value;
      return false;
    };

    const opts = { stepT, startT };
    if ( te.averageTerrain ) {
      opts.frame = this.token.bounds; // TODO: Keep bounds or move to slower token shape?
      opts.skip = this.averageTerrain;
    }

    const ix = evCache.nextPixelValueAlongCanvasRay(travelRay, cmp, opts);
    if ( !ix ) return null;
    ix.e = ev.pixelValueToElevation(ix.value);
    ix.cliff = true;
    return ix;
  }

  /**
   * Search for a transparent tile location along the ray beginning at a specified point.
   * @param {Tile} tile           Tile to test
   * @param {number} [startT=0]   Starting point along the travel ray. A = 0; B = 1.
   * @returns {Point|undefined} First transparent tile point or undefined if none found.
   */
  _findTileHole(tile, startT=0) {
    const travelRay = this.travelRay;
    const { alphaThreshold, averageTiles } = this.tokenElevation;
    const stepT = this.#stepT;

    const cache = tile._textureData?._evPixelCache;
    if ( !cache ) return null;

    // Function to test if the given pixel is under the threshold.
    const pixelThreshold = alphaThreshold * TravelElevation.#maximumPixelValue;

    let cmp = value => value <= pixelThreshold;
    const opts = { stepT, startT };
    if ( averageTiles ) {
      opts.frame = this.tokenElevation.token.bounds; // TODO: Keep bounds or move to slower token shape?
      opts.skip = averageTiles;
      const percentThreshold = this.tilePercentThreshold; // Default 50%
      opts.countFn = PixelCache.countFunction(pixelThreshold); // Number of pixels greater than threshold
      cmp = value => value < percentThreshold; // Percent pixels greater than threshold < 50%
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
    const travelRay = this.travelRay;
    const { alphaThreshold, averageTiles } = this.tokenElevation;
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
    let cmp = value => value > pixelThreshold;

    const opts = { stepT, startT };
    if ( averageTiles ) {
      opts.frame = this.tokenElevation.token.bounds; // TODO: Keep bounds or move to slower token shape?
      opts.skip = averageTiles;
      const percentThreshold = this.tilePercentThreshold; // Default 50%
      opts.countFn = PixelCache.countFunction(pixelThreshold); // Number of pixels greater than threshold
      cmp = value => value >= percentThreshold; // Percent pixels greater than threshold ≥ 50%
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
    const travelRay = this.travelRay;
    const averageTerrain = this.tokenElevation.averageTerrain;
    const stepT = this.#stepT;
    const ev = canvas.elevation;
    const evCache = ev.elevationPixelCache;

    // Function to test if the given pixel exceeds the threshold.
    const pixelThreshold = ev.elevationToPixelValue(elevationThreshold);
    const cmp = value => value > pixelThreshold;

    const opts = { stepT, startT };
    if ( averageTerrain ) {
      opts.frame = this.tokenElevation.token.bounds; // TODO: Keep bounds or move to slower token shape?
      opts.skip = averageTerrain;
    }

    const ix = evCache.nextPixelValueAlongCanvasRay(travelRay, cmp, opts);
    if ( !ix ) return null;
    // TO-DO: Could use Point3d here and set z value to elevationZ.
    // May be helpful for flagging difficulty checks for large climbs/falls.
    ix.e = ev.pixelValueToElevation(ix.value);
    return ix;
  }

  /**
   * Determine the current state of this token
   * @returns {TOKEN_ELEVATION_STATE}
   */
  currentTokenState() {
    const te = this.tokenElevation;
    const currE = te.tokenElevation;
    const terrainE = te.terrainElevationAtToken();

    // If the terrain matches token elevation, we are on terrain.
    if ( terrainE.almostEqual(currE) ) return { currE, currState: TERRAIN, terrainE };

    // If there is a supporting tile near this elevation, we are on tile.
    const currTile = te.findTileNearToken();
    if ( currTile ) return { currE, currState: TILE, currTile, terrainE };

    // If the terrain is sufficiently close, we are on terrain.
    if ( te.terrainWithinStep() ) return { currE, currState: TERRAIN, currTile, terrainE };

    // Must be flying.
    return { currE, currState: FLY, currTile, terrainE };
  }

  /**
   * Determine the current state of this token
   * @param {object} [options]    Options that modify the token parameters
   * @param {Point} [options.tokenCenter]       Center of the token
   * @param {number} [options.tokenElevation]   Elevation of the token
   * @returns {TOKEN_ELEVATION_STATE}
   */
//   static currentTokenState(token, { tokenCenter, tokenElevation } = {}) {
//     tokenCenter ??= token.center;
//     tokenElevation ??= token.bottomE;
//     const matchingTile = this.tokenElevation.findTileNearToken({
//       tokenCenter,
//       tokenElevation });
//
//     const tokenHeight = token.topE - token.bottomE;
//     const terrainStep = CONFIG[MODULE_ID]?.terrainStep ?? (tokenHeight || canvas.elevation.elevationStep);
//     if ( matchingTile ) {
//       const tileStep = CONFIG[MODULE_ID]?.tileStep ?? (tokenHeight || canvas.elevation.elevationStep);
//       const tileE = matchingTile.elevationE;
//       if ( almostBetween(tileE, tokenElevation - tileStep, tokenElevation) ) return { currE: tileE, currState: TILE, currTile: matchingTile };
//     }
//
//     const terrainE = this._terrainElevationAtLocation(tokenCenter);
//     if ( almostBetween(terrainE, tokenElevation - terrainStep, tokenElevation) ) {
//       return { currE: terrainE, currState: TERRAIN, terrainE };
//     }
//
//     return { currE: tokenElevation, currState: FLY, terrainE };
//   }


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
    for ( const tile of this.tokenElevation.tiles ) {
      const cache = tile._textureData?._evPixelCache;
      if ( !cache ) continue;

      const ix = this._findTileStart(tile);
      if ( ix ) tileIxs.push(ix);
    }

    // Make closest intersection to A last in the queue, so we can pop it.
    this.#sortIxs(tileIxs);

    return tileIxs;
  }

  /**
   * For debugging, draw the ray and tile alpha boundaries.
   */
  draw() {
    Draw.segment(this.travelRay);
    for ( const tile of this.tokenElevation.tiles ) {
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
