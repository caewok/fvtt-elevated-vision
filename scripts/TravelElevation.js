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
import { isTokenOnGround, isTokenOnTile, tokenTerrainElevation, tileAtTokenElevation } from "./tokens.js";

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

  /** @type {boolean} */
  debug = false;

  /** @type {Tile[]} */
  #tiles;

  /** @type {Point3d[]} */
  #tileIxs;

  /** @type {Point3d[]} */
  #terrainElevations;

  /** @type {Token} */
  token;

  /** @type {Ray} */
  travelRay;

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

    // When stepping along the ray, move in steps based on the grid precision.
    const gridPrecision = canvas.walls.gridPrecision;
    const interval = Math.max(canvas.grid.w / gridPrecision, canvas.grid.h / gridPrecision);
    this.#stepT = interval / travelRay.distance;

    // Set a function on the ray to transform points to t values.
    const rayTConversion = Math.abs(travelRay.dx) > Math.abs(travelRay.dy)
      ? pt => (pt.x - travelRay.A.x) / travelRay.dx
      : pt => (pt.y - travelRay.A.y) / travelRay.dy;
    travelRay.tConversion = rayTConversion;

    // Make sure t0 is set on the ray endpoints; used in calculateElevationAlongRay.
    travelRay.A.t0 = 0;
    travelRay.B.t0 = 1;

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
  get tileIxs() {
    return this.#tileIxs || (this.#tileIxs = this._tileRayIntersections());
  }

  /**
   * Terrain elevation points along the ray.
   * @type {Point3d[]}
   */
  get terrainElevations() {
    return this.#terrainElevations || (this.#terrainElevations = this.calculateTerrainElevationsAlongRay());
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
    const { debug, fly, token, travelRay } = this;
    startElevation ??= token.bottomE;
    if ( debug ) Draw.segment(travelRay);

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

    // If flying not enabled and the token is currently flying, bail out.
    let currState = TravelElevation.currentTokenState(token,
      { tokenCenter: travelRay.A, tokenElevation: startElevation });
    if ( !fly && currState === FLY ) return out; // Flying

    // If flying not enabled and no tiles present, can simply rely on terrain elevations throughout.
    out.checkTerrain = true;
    out.adjustElevation = true;
    const tiles = this.tiles;
    if ( !tiles.length && !fly ) {
      out.finalElevation = tokenTerrainElevation(token, { tokenCenter: travelRay.B });
      return out;
    }

    // Tiles are present and/or flying is enabled.
    out.trackingRequired = true;
    const { finalElevation, elevationChanges } = fly
      ? this._trackElevationChangesWithFlight(startElevation, currState)
      : this._trackElevationChanges(startElevation, currState);
    out.finalElevation = finalElevation;
    out.elevationChanges = elevationChanges;
    return out;
  }

  /**
   * Track elevation changes along a ray
   */
  _trackElevationChanges(startElevation, currState) {
    const tileIxs = [...this.tileIxs]; // Make a copy that we can modify in the loop.

    let currE = startElevation;
    let currTile;
    const elevationChanges = [];
    const stepT = this.#stepT;

    const {
      travelRay,
      token,
      debug,
      averageTiles,
      alphaThreshold,
      tiles } = this;

    const tokenCenter = token.center;
    const tokenTL = token.getTopLeft(tokenCenter.x, tokenCenter.y);
    const tokenBorder = canvas.elevation._tokenShape(tokenTL, token.w, token.h);

    // At each intersection group, update the current elevation based on ground unless already on tile.
    // If the token elevation equals that of the tile, the token is now on the tile.
    // Keep track of the seen intersections, in case of duplicates.
    const tSeen = new Set();
    while ( tileIxs.length ) {
      const ix = tileIxs.pop();
      if ( tSeen.has(ix.t0) ) continue;
      tSeen.add(ix.t0);
      if ( debug ) Draw.point(ix, { color: STATE_COLOR[currState], radius: 3 });

      // Determine the destination type and associated elevation.
      // (1) Use the immediately prior center terrain elevation or the current elevation as the start
      const prevT = ix.t0 - stepT;
      const prevPt = travelRay.project(prevT);
      const prevE = Math.max(currE, tokenTerrainElevation(token, { tokenCenter: prevPt, useAveraging: false }));

      // (2) Locate any tiles at this location with sufficiently near elevation.
      //     Update the token shape location
      let tokenShape;
      if ( averageTiles ) {
        const dx = prevPt.x - tokenCenter.x;
        const dy = prevPt.y - tokenCenter.y;
        tokenShape = tokenBorder.translate(dx, dy);
      }

      const matchingTile = tileAtTokenElevation(token, {
        tokenCenter: ix,
        tokenElevation: prevE,
        tokenShape,
        averageTiles,
        alphaThreshold,
        tiles });

      const terrainE = tokenTerrainElevation(token, { tokenCenter: ix });

      // (3) Check if we are on a tile; otherwise on terrain
      [currState, currE] = matchingTile ? [TILE, matchingTile.elevationE] : [TERRAIN, terrainE];

      // (4) Remember the current tile for next iteration.
      currTile = matchingTile;

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
      token,
      debug,
      averageTiles,
      alphaThreshold,
      tiles } = this;

    const tokenCenter = token.center;
    const tokenTL = token.getTopLeft(tokenCenter.x, tokenCenter.y);
    const tokenBorder = canvas.elevation._tokenShape(tokenTL, token.w, token.h);

    // At each intersection group, update the current elevation based on ground unless already on tile.
    // If the token elevation equals that of the tile, the token is now on the tile.
    // Keep track of the seen intersections, in case of duplicates.
    const tSeen = new Set();
    while ( tileIxs.length ) {
      const ix = tileIxs.pop();
      if ( tSeen.has(ix.t0) ) continue;
      tSeen.add(ix.t0);
      if ( debug ) Draw.point(ix, { color: STATE_COLOR[currState], radius: 3 });

      // Determine the destination type and associated elevation.
      // (1) Use the immediately prior center terrain elevation or the current elevation as the start
      const prevT = ix.t0 - stepT;
      const prevPt = travelRay.project(prevT);
      const prevE = Math.max(currE, tokenTerrainElevation(token, { tokenCenter: prevPt, useAveraging: false }));

      // (2) Locate any tiles at this location with sufficiently near elevation.
      //     Update the token shape location
      let tokenShape;
      if ( averageTiles ) {
        const dx = prevPt.x - tokenCenter.x;
        const dy = prevPt.y - tokenCenter.y;
        tokenShape = tokenBorder.translate(dx, dy);
      }

      const matchingTile = tileAtTokenElevation(token, {
        tokenCenter: ix,
        tokenElevation: prevE,
        tokenShape,
        averageTiles,
        alphaThreshold,
        tiles });

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
   * Find next tile hole or terrain rising above tile along the ray.
   * @param {Tile} currTile
   * @param {Point3d[]} tileIxs
   * @param {Point3d} ix
   * @param {number} currE
   */
  #locateNextTileObstacle(currTile, tileIxs, ix, currE) {
    // Find next point at which the token could fall through a tile hole, if any.
    const tilePt = this._findTileHole(currTile, ix.t0);
    if ( tilePt ) this.#addIx(tileIxs, tilePt, { color: Draw.COLORS.yellow });

    // Find next location where terrain pokes through tile, if any.
    const terrainPt = this._findElevatedTerrain(currE, ix.t0);
    if ( terrainPt ) this.#addIx(tileIxs, terrainPt, { color: Draw.COLORS.green });
  }

  #locateNextObstacleWithFlight(currTile, tileIxs, ix, currE, currState) {
    const { tileStep, debug } = this;

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
        // Check for tile or terrain that we will run into at this flying elevation.
        const travelRay = this.travelRay;
        const destRay = new Ray(ix, travelRay.B);

        // Find the tile intersections
        const maxE = currE;
        const minE = currE - tileStep;
        const tilesWithinE = this.tiles.filter(tile => almostBetween(tile.elevationE, minE, maxE) );
        const ixs = [];
        for ( const tile of tilesWithinE ) {
          const cache = tile._textureData?._evPixelCache;
          if ( !cache ) return null;

          const tileIxs = cache.rayIntersectsBoundary(destRay, this.alphaThreshold);
          if ( tileIxs.length && tileIxs[0].t0 > ix.t0 ) ixs.push(tileIxs[0]);
        }

        // Find the elevation intersection.
        const terrainPt = this._findElevatedTerrain(minE, ix.t0);
        if ( terrainPt ) this.#addIx(tileIxs, terrainPt, { color: Draw.COLORS.green });

        // If any intersections, add the first one encountered along the travel ray.
        if ( !ixs.length ) break;
        ixs.sort((a, b) => a.t0 - b.t0);
        this.#addIx(tileIxs, ixs[0], { debug, color: Draw.COLORS.blue });
        break;
      }
    }
  }

  #addIx(trackingArray, pt, {color, radius = 2} = {}) {
    const debug = this.debug;
    color ??= Draw.COLORS.yellow;
    trackingArray.push(pt); // The pt should already has correct t0.
    trackingArray.sort((a, b) => b.t0 - a.t0);
    if ( debug ) Draw.point(pt, { color, radius });
  }

  /**
   * Locate tiles at this location with sufficiently near elevation
   * @param {Point} ix      Location to test
   * @param {number} maxE   Maximum elevation to consider
   * @returns {Tile|undefined}
   */
//   #findMatchingTile(ix, maxE) {
//     return this.tiles.find(tile => this.#tileMatches(tile, ix, maxE));
//   }
//
//   #tileMatches(tile, ix, maxE) {
//       const { alphaThreshold, averageTiles, token } = this;
//       const tileE = tile.elevationE;
//       if ( !almostLessThan(tileE, maxE) || !tile.bounds.contains(ix.x, ix.y) ) return false;
//       if ( !averageTiles ) return tile.containsPixel(ix.x, ix.y, alphaThreshold) > 0;
//
//       // Same bounds test as tileAtTokenElevation.
//       // For speed, always use token bounds rectangle.
//       const cache = tile._textureData._evPixelCache;
//       const evCache = canvas.elevation.elevationPixelCache;
//       const pixelE = canvas.elevation.elevationToPixelValue(tileE)
//       let sum = 0;
//       const countFn = (value, _i, localX, localY) => {
//          if ( value > alphaThreshold ) return sum += 1;
//          const canvas = cache._toCanvasCoordinates(localX, localY);
//          const terrainValue = evCache.pixelAtCanvas(canvas.x, canvas.y);
//          if ( terrainValue.almostEqual(pixelE) ) return sum += 1;
//          return;
//       }
//       const denom = cache.applyFunctionToShape(countFn, token.bounds, averageTiles);
//       const percentCoverage = sum / denom;
//       return percentCoverage > 0.5;
//   }

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

    return evCache.nextPixelValueAlongCanvasRay(travelRay, cmp, opts);
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
    const cmp = value => value < pixelThreshold;

    const opts = { stepT, startT };
    if ( this.averageTiles ) {
      opts.frame = this.token.bounds;
      opts.skip = this.averageTile;
    }

    const ix = cache.nextPixelValueAlongCanvasRay(travelRay, cmp, opts);
    if ( !ix ) return null;
    const pt3d = new Point3d(ix.x, ix.y, tile.elevationZ);
    pt3d.e = tile.elevationE;
    pt3d.t0 = ix.t0;
    pt3d.tile = tile;
    return pt3d;
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
  static currentTokenState(token, { tokenCenter, tokenElevation }) {
    if ( isTokenOnTile(token, { tokenCenter, tokenElevation }) ) return TILE;
    if ( isTokenOnGround(token,
      { tokenCenter, tokenElevation, considerTiles: false }) ) return TERRAIN;
    return FLY;
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
    const { tiles, travelRay, alphaThreshold } = this;
    const tileIxs = [];

    for ( const tile of tiles ) {
      const cache = tile._textureData?._evPixelCache;
      if ( !cache ) continue;

      const ixs = cache.rayIntersectsBoundary(travelRay, alphaThreshold);
      if ( ixs.length < 2 ) continue;

      const ix = ixs[0];
      const pt3d = new Point3d(ix.x, ix.y, tile.elevationZ);
      pt3d.e = tile.elevationE;
      pt3d.t0 = ix.t0;
      pt3d.tile = tile;
      tileIxs.push(pt3d);
    }

    // Closest intersection to A is last in the queue, so we can pop it.
    tileIxs.sort((a, b) => b.t0 - a.t0);

    // Add the start (and end?) of the travel ray.
    //tileIxs.unshift(this.travelRay.B);
    tileIxs.push(this.travelRay.A);

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
