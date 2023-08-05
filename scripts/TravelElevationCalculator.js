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







