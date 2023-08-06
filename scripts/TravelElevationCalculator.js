/* globals
canvas,
Ray,
ui,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { almostLessThan, almostBetween } from "./util.js";
import { Draw } from "./geometry/Draw.js";
import { getSetting, getSceneSetting, SETTINGS } from "./settings.js";
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
TravelElevationCalculator = canvas.elevation.TravelElevationCalculator
TokenElevationCalculator = canvas.elevation.TokenElevationCalculator
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

te = new TravelElevationCalculator(token, travelRay)
te.draw()
te.TEC.tiles.forEach(tile => draw.shape(tile.bounds, { color: Draw.COLORS.gray }))

results = te.calculateElevationAlongRay();
TravelElevationCalculator.drawResults(results)

finalE = te.calculateFinalElevation()

te.fly = true;
results = te.calculateElevationAlongRay();
TravelElevationCalculator.drawResults(results)

// Test tile cache coordinates
[tile] = canvas.tiles.placeables
cache = tile._evPixelCache
cache.draw()

// Bench the elevation calculation
function benchCreation(token, travelRay) {
  return new TravelElevationCalculator(token, travelRay);
}

function benchCalc(te) {
  // te.clear();
  return te.calculateElevationAlongRay();
}

function benchFinalCalc(te) {
  // te.clear();
  return te.calculateFinalElevation();
}


N = 10000
await foundry.utils.benchmark(benchCreation, N, token, travelRay)
await foundry.utils.benchmark(benchCalc, N, te)
await foundry.utils.benchmark(benchFinalCalc, N, te)

// I. Farmhouse: right side of outhouse --> middle
benchCreation | 1000 iterations | 18.1ms | 0.0181ms per
commons.js:1729 benchCalc | 1000 iterations | 150.1ms | 0.15009999999999998ms per

// I.A. No averaging

// I.A.1. No fly
// With changes
benchCreation | 1000 iterations | 15.6ms | 0.0156ms per
commons.js:1729 benchCalc | 1000 iterations | 32.9ms | 0.0329ms per

// I.A.2. Fly

// I.B. Averaging

// I.B.1. No fly
benchCreation | 1000 iterations | 12.3ms | 0.0123ms per
commons.js:1729 benchCalc | 1000 iterations | 533.3ms | 0.5333ms per

// Need for Speed
benchCreation | 10000 iterations | 128.4ms | 0.01284ms per
commons.js:1729 benchCalc | 10000 iterations | 1520.7ms | 0.15207ms per
commons.js:1729 benchFinalCalc | 10000 iterations | 115.2ms | 0.01152ms per

// I.B.2. Fly

// Need for Speed
benchCreation | 10000 iterations | 131.6ms | 0.01316ms per
commons.js:1729 benchCalc | 10000 iterations | 1497.2ms | 0.14972ms per
commons.js:1729 benchFinalCalc | 10000 iterations | 107.6ms | 0.010759999999999999ms per

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
await foundry.utils.benchmark(canvas.elevation.tokens.tileOpaqueAt, N, tile, tokenCenter, averageTiles, alphaThreshold, tokenShape);
await foundry.utils.benchmark(canvas.elevation.tokens.tokenSupportedByTile, N, tile, tokenCenter, averageTiles, alphaThreshold, tokenShape);

50% tile:
tileOpaqueAt | 10000 iterations | 128.7ms | 0.01287ms per
tokenSupportedByTile | 10000 iterations | 37.1ms | 0.00371ms per

// Test tile transparency
tile = te.tiles[0]
te._findTileHole(tile)

// Test getting tile average within token
tile = te.tiles[0]
cache = tile._evPixelCache;
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
cache = tile._evPixelCache;
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


class TravelElevationRay {
   /** @enum {number} */
  static ELEVATION_STATE = {
    TERRAIN: 0, // Important that terrain is set to zero, so it can be checked for true/false.
    TILE: 1
  };

  /** @type {TokenElevationCalculator} */
  TEC;

  /** @type {PIXI.Point} */
  destination = new PIXI.Point();

  /** @type {PIXI.Point} */
  origin = new PIXI.Point();

  /** @type {number} */
  tokenStartElevation = 0;

  /** @type {object} */
  opts = {};

  /** @type {Set<Tile>} */
  reachableTiles = new Set();

  /** @type {object} */
  terrainWalk;

  /** @type {Map<string;object>} */
  tileWalks = new Map();

  /** @type {object[]} */
  path = [];

  /**
   * @param {Token} token               Token that is undertaking the movement
   * @param {PIXI.Point} destination    {x,y} destination for the movement
   * @param {object} [opts]                 Options passed to canvas.elevation.TokenElevationCalculator
   * @param {Point} [opts.tokenCenter]      Assumed token center at start
   * @param {number} [opts.tokenElevation]  Assumed token elevation at start
   */
  constructor(token, destination, opts = {}) {
    this.destination.copyFrom(destination);
    this.opts = opts;
    this.TEC = new canvas.elevation.TokenElevationCalculator(token, opts);
    this.origin.copyFrom(this.TEC.point);

    // Assist TEC by limiting the tiles to those along the ray.
    const fn = this.constructor.elevationTilesOnLineSegment
    this.TEC.tiles = fn(this.origin, destination, this.TEC.options.alphaThreshold);
  }

  elevationAtT(t) {

  }

  elevationAtClosestPoint(x, y) {

  }

  get startingElevation { return this.TEC.groundElevation(); }

  get endingElevation() {

  }

  /**
   * @typedef {object} elevationMarker
   * @property {number} t       Where on the start --> end ray is this, between 0 and 1
   * @property {}
   */

  _walkPath() {
    this.path.length = 0;
    this.tileWalks.clear();

    const threshold = 255 * this.TEC.options.alphaThreshold;
    const markTilePixelFn = (prev, curr) => (prev < threshold) ^ (curr < threshold);
    const markTerrainPixelFn =  (prev, curr) => prev !== curr;

    // Find all changes in terrain elevation along the path
    const terrainCache = canvas.elevation.elevationPixelCache;
    this.terrainWalk = terrainCache.pixelValuesForLine(this.origin, this.destination, { markPixelFn: markTerrainPixelFn });


    // Find the max terrain elevation over the path.
    const canvas.elevation._scaleNormalizedElevation(maxPixelValue);
    const maxPixelValue = this.terrainWalk.markers.reduce((acc, curr) => Math.max(acc, curr.currPixel), 0);
    const maxTerrainElevation = CONFIG.GeometryLib.utils.gridUnitsToPixels(canvas.elevation._scaleNormalizedElevation(maxPixelValue))

    // Get all tiles less than tile step from max terrain elevation.
    // Recursively search for tiles that could be reached from the max tile.
    let currElevation = this.startingElevation;
    for ( const terrainMarker of this.terrainWalk ) {
      const terrainElevation = CONFIG.GeometryLib.utils.gridUnitsToPixels(elevation._normalizeElevation(canvas.elevation._scaleNormalizedElevation(terrainMarker.currPixel)));
      currElevation = Math.max(currElevation, terrainElevation);
    }

    // Find all tiles less than or equal to the max elevation.
    // Then add in tiles that are within tile step, repeatedly.
    this.reachableTiles.clear();
    this.TEC.tiles.forEach(t => if ( t.elevationZ <= currElevation ) this.reachableTiles.add(t));
    this._findTilesWithinReach(currElevation, this._reachableTiles);

    // Replace the TEC tiles with this filtered set based on maximum elevation.
    this.TEC.tiles = [...this.reachableTiles];
    this.TEC.tiles.sort((a, b) => b.elevationE - a.elevationE); // elevationE is faster than Z

    // At the starting point, are we dropping to terrain or a tile?
    const startTile = this.TEC.findSupportingTile();
    const startMarker = {};
    if ( startTile ) {
      const tileWalk = t.evPixelCache.pixelValuesForLine(this.origin, this.destination, { markPixelFn: markTilePixelFn });
      tileWalk.tile = tile;
      this.tileWalks.set(tile, tileWalk);
      this.path.push({ t: 0, elevation: this.startingElevation, type: ELEVATION_STATE.TILE, tileWalk });
    } else {
      this.path.push({ t: 0, elevation: this.startingElevation, type: ELEVATION_STATE.TERRAIN });
    }


    /*
    "walk" = set of markers for a given object. Here, tile or terrain

    marker: {
      t,
      idx: <-- how to find in the walk markers
      markers: <-- the "walk" array of markers that includes this one
      x: local x
      y: local y
      currPixel: current pixel value
      prevPixel: previous pixel value
    }

    Move from one marker to the next in order for the current object.
    For tiles,



    */




    // Now we have all tiles that are possibly under the token at any given point.
    // Process the line for each.
    // TODO: Can we make this so we only process if absolutely necessary?
    this.tileWalks.clear();
    const threshold = 255 * this.TEC.options.alphaThreshold;
    markPixelFn = (prev, curr) => (prev < threshold) ^ (curr < threshold);
    this.reachableTiles.forEach(t => {
      const tileWalk = t.evPixelCache.pixelValuesForLine(this.origin, this.destination, { markPixelFn });
      tileWalk.tile = tile;
      tileWalk.t =

      this.tileWalks.set(tile, tileWalk);
    });

    // Construct an array of terrain and tile marker points, in order from a --> b.
    this.path.length = 0;
    this.path.push(...this.terrainWalk.markers);
    this.tileWalks.forEach(tileWalk => this.path.push(...tileWalk.markers));

    // Calculate the t-value (from 0 at a to 1 at b) for each marker.
    this.path.forEach(marker => {
      marker.canvasPt = marker.
    })

  }

  _findTilesWithinReach(currElevation, tileSet = new Set()) {
    let newElevation = currElevation;
    this.TEC.tiles.forEach(t => {
      if ( !tileSet.has(t)
        && t.elevationZ > currElevation
        && t.elevationZ <= (currElevation + this.TEC.opts.tileStep) ) {
        newElevation = Math.max(newElevation, t.elevationZ);
        tileSet.add(t);
      }
    });
    if ( !withinReach.length ) return tileSet;
    return this._findTilesWithinReach(newElevation, tileSet);
  }

  /**
   * Find overhead elevation tiles along a line segment (ray).
   * @param {Point} a                   Starting point
   * @param {Point} b                   Ending point
   * @param {number} [alphaThreshold]   Tile portions lower than this alpha do not count for bounds.
   * @returns {Tile[]}
   */
  static elevationTilesOnLineSegment(a, b, alphaThreshold) {
    // First, get all tiles within bounds of a --> b
    const xMinMax = Math.minMax(a.x, b.x);
    const yMinMax = Math.minMax(a.y, b.y);
    const bounds = new PIXI.Rectangle(xMinMax.min, yMinMax.min, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
    bounds.width ||= 1; // If a --> b is vertical, add width to bounds
    bounds.height ||= 1; // if a --> b is horizontal, add height to bounds
    const collisionTest = (o, _rect) => o.t.document.overhead && isFinite(o.t.elevationZ);
    let tiles = [...canvas.tiles.quadtree.getObjects(bounds, { collisionTest })];

    // Only keep tiles that actually intersect the ray.
    tiles = tiles.filter(t => {
      const cache = t.evPixelCache;
      const bounds = alphaThreshold ? cache.getThresholdCanvasBoundingBox : cache;
      return bounds.lineSegmentIntersects(a, b, { inside: true });
    });

    // If a and b have elevations, only keep tiles within that elevation range.
    if ( Object.hasOwn(a, "z") && Object.hasOwn(b, "z") ) {
      const zMinMax = Math.minMax(a.z, b.z);
      tiles = tiles.filter(t => {
        const elevationZ = t.elevationZ;
        return (elevationZ >= zMinMax.min) && (elevationZ <= zMinMax.max);
      });
    }

    // Sort tiles by elevation, highest to lowest.
    // This will help with finding relevant tiles later.
    tiles.sort((a, b) => b.elevationZ - a.elevationZ);
    return tiles;
  }


}


class TravelElevationRayTokenAveraging extends TravelElevationRay {


  /**
   * Find overhead elevation tiles along a line segment (ray).
   * Account for token size and capture all tiles under the token.
   * @param {Point} a                   Starting point
   * @param {Point} b                   Ending point
   * @param {number} [alphaThreshold]   Tile portions lower than this alpha do not count for bounds.
   * @returns {Tile[]}
   */
  static elevationTilesOnLineSegment(a, b, alphaThreshold, tokenBounds) {
    const aElevation = a.z;
    const bElevation = b.z;
    const minWidth = tokenBounds.width;
    const minHeight = tokenBounds.height;
    const dist2Rev = -Math.pow(minWidth, 2) + Math.pow(minHeight, 2); // Diagonal along the bounds
    a = PIXI.Point.fromObject(a);
    b = PIXI.Point.fromObject(b);
    a = a.towardsPointSquared(b, dist2Rev);
    b = b.towardsPointSquared(a, dist2Rev);


    // First, get all tiles within bounds of a --> b
    const xMinMax = Math.minMax(a.x, b.x);
    const yMinMax = Math.minMax(a.y, b.y);
    const bounds = new PIXI.Rectangle(xMinMax.min, yMinMax.min, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
    bounds.width ||= minWidth; // If a --> b is vertical, add width to bounds
    bounds.height ||= minHeight; // if a --> b is horizontal, add height to bounds
    const collisionTest = (o, _rect) => o.t.document.overhead && isFinite(o.t.elevationZ);
    let tiles = [...canvas.tiles.quadtree.getObjects(bounds, { collisionTest })];

    // If a and b have elevations, only keep tiles within that elevation range.
    if ( typeof aElevation !== "undefined" && typeof bElevation !== "undefined" ) {
      const zMinMax = Math.minMax(aElevation, bElevation);
      tiles = tiles.filter(t => {
        const elevationZ = t.elevationZ;
        return (elevationZ >= zMinMax.min) && (elevationZ <= zMinMax.max);
      });
    }

    // Sort tiles by elevation, highest to lowest.
    // This will help with finding relevant tiles later.
    tiles.sort((a, b) => b.elevationZ - a.elevationZ);
    return tiles;
  }

}



