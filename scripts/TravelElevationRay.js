/* globals
canvas,
foundry,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Draw } from "./geometry/Draw.js";
import { PixelCache } from "./PixelCache.js";

/* Averaging pixel values

3 settings:

1. Single pixel
- Terrain measured as value at the center pixel.
- Tile opacity measured as value at the center pixel.

2. 9 point (mode)
- Foundry 9 points used (center + points around inset square)
- Value appearing most often wins. Undefined does not count. Fallback to min elevation
- Tile opacity can be tested for 50%+ opaque: opaque & defined


3. All points (average)
- All points used. Skip based on shape size, to ensure 10% coverage across, 1% coverage total.
  So if 100 x 100, skip is 100 * .1 = 10. 100 pixels instead of 10,000
  If 500 x 300, skip is 300 * .1 = 30. 16 * 10 = 160 pixels instead of 150,000
  (10% * 10% = 1%)
- CONFIG setting to adjust
- Terrain measured as average of all pixels. Undefined does not count. Fallback to min elevation
- Tile opacity measured as average of all pixels. Undefined count as non-opaque.
- Tile opacity can be tested for 50+% opaque: opaque and defined.

*/



export class TravelElevationRay {
  /** @type {TokenElevationCalculator} */
  TEC;

  /** @type {PIXI.Point} */
  #destination = new PIXI.Point();

  /** @type {PIXI.Point} */
  #origin = new PIXI.Point();

  /** @type {number} */
  startElevation = 0;

  /** @type {Set<Tile>} */
  reachableTiles = new Set();

  /** @type {object} */
  terrainWalk;

  /** @type {Map<string;object>} */
  tileWalks = new Map();

  /** @type {object[]} */
  path = [];

  /** @type {MarkerTracker} */
  markerTracker;

  /** @type {object[]} */
  terrainMarkers = [];

  /**
   * @param {Token} token               Token that is undertaking the movement
   * @param {PIXI.Point} destination    {x,y} destination for the movement
   * @param {object} [opts]                 Options passed to canvas.elevation.TokenElevationCalculator
   * @param {Point} [opts.tokenCenter]      Assumed token center at start
   * @param {number} [opts.tokenElevation]  Assumed token elevation at start
   */
  constructor(token, destination, opts) {
    this.#destination.copyFrom(destination);
    this.TEC = new canvas.elevation.TokenElevationCalculator(token, opts);
    this.#origin.copyFrom(this.TEC.location);
    this.startElevation = this.TEC.options.elevation;
    this.markerTracker = new MarkerTracker(this);

//     this._pixelAggregationFn = this.#pixelAggregationFn();
//     this._markTransparentTileFn = this.#markTransparentTileFn();

    // TODO: How to give the token calculator a limited set of tiles or use an intersection test on the tiles?
    // Could make our own quadtree, but updating could be problematic if the tile moves.
  }

  /** @type {number} */
  get alphaThreshold() { return this.TEC.options.alphaThreshold; }

  /** @type {number} */
  get startingElevation() { return this.TEC.groundElevation(); }

  /** @type {number} */
  get endingElevation() { return this.elevationAtT(1); }

  /** @type {PIXI.Point} */
  get origin() { return this.#origin; }

  set origin(value) {
    this.#origin.copyFrom(value);
    this.path.length = 0;
  }

  /** @type {PIXI.Point} */
  get destination() { return this.#destination; }

  set destination(value) {
    this.#destination.copyFrom(value);
    this.path.length = 0;
  }

  #initializeTerrainOffsets() {
    const tokenShape = canvas.elevation._tokenShape(this.token, this.token.w, this.token.h);
    const localShape = canvas.elevation.elevationPixelCache._shapeToLocalCoordinates(tokenShape);
    const skip = Math.round(Math.min(this.token.w, this.token.h) * 0.1);
    return PixelCache.pixelOffsets(localShape, skip);
  }

  #initializeMarkTransparentTileFn() {


//     // curr is { result, numUndefined, numPixels }
//     const threshold = 255 * this.alphaThreshold;
//     return curr => curr.result < threshold ||
//
//
  }

  /**
   * Function used to calculate a terrain pixel value from an array of terrain pixels.
   * Terrain pixels represent an elevation, and so some sort of averaging is appropriate.
   * For the single-pixel option, use the first pixel.
   * For points, use median.
   * For average, use sum (from which an average will be derived).
   * @returns {function}
   */
  #initializeTerrainPixelReducerFn() {
    const TYPES = SETTINGS.ELEVATION_MEASUREMENT.TYPES;
    switch ( this.options.setting.elevationMeasurement ) {
      case TYPES.POINT: return PixelCache.pixelAggregator("first");
      case TYPES.POINTS_CLOSE:
      case TYPES.POINTS_FAR: return PixelCache.pixelAggregator("median");
      case TYPES.AVERAGE: {
        const aggFn = PixelCache.pixelAggregator("sum");
        aggFn.finalize = acc => acc.numPixels / acc.total; // Treats undefined as 0.
        return aggFn;
      }
    }
  }

//  t = Math.min(_token.w, _token.h) / 4;  <-- / 10 for close is pretty good
//  offsets = t > 0 ? [[0, 0], [-t, -t], [-t, t], [t, t], [t, -t], [-t, 0], [t, 0], [0, -t], [0, t]] : [[0, 0]];
//  offsets.forEach(o => Draw.point({x: _token.center.x + o[0], y: _token.center.y + o[1]}, { radius: 1}))

  /**
   * Function used to calculate a tile pixel value from an array of tile pixels.
   * Tile pixels are checked for opacity, so the percentage of pixels that are opaque
   * is the relevant question.
   * For the single pixel option, use the first pixel.
   * Otherwise, use count (from which percentage can be derived).
   * @returns {function}
   */
  #initializeTilePixelReducerFn() {
    const TYPES = SETTINGS.ELEVATION_MEASUREMENT.TYPES;
    switch ( this.options.setting.elevationMeasurement ) {
      case TYPES.POINT: return PixelCache.pixelAggregator("first");
      case TYPES.POINTS_CLOSE:
      case TYPES.POINTS_FAR: {
        const threshold = this.alphaThreshold;

        return PixelCache.pixelAggregator("count");
      }
      case TYPES.POINTS_AVERAGE: return PixelCache.pixelAggregator("sum"); // Sum or count here?
    }
  }

  /**
   * Function used to mark a terrain pixel change.
   * For single, this marks every pixel change.
   * For points, this marks every pixel change (already calculated as median).
   * For average, this determines the average terrain value, treating undefined as 0.
   * @returns {function}
   */
  #initializeTerrainMarkerFn() {
    const TYPES = SETTINGS.ELEVATION_MEASUREMENT.TYPES;
    switch ( this.options.setting.elevationMeasurement ) {
      case TYPES.POINT:
      case TYPES.POINTS_CLOSE:
      case TYPES.POINTS_FAR: return (curr, prev) => prev !== curr;
      case TYPES.POINTS_AVERAGE: return (curr, prev)
    }
  }


  /**
   * @param {number} t    Percent distance along the ray
   * @returns {number} Elevation value at that location
   */
  elevationAtT(t) {
    if ( !this.path.length ) this._walkPath();
    if ( t >= 1 ) return this.path.at(-1).elevation;
    if ( t <= 0 ) return this.path.at(0).elevation;
    const mark = this.path.findLast(mark => mark.t <= t);
    if ( !~mark ) return undefined;
    return mark.elevation;
  }

  /**
   * Get the elevation on the ray nearest to a point on the canvas.
   * @param {Point} pt    Point to check
   * @returns {number} Elevation value nearest to that location on the ray.
   */
  elevationAtClosestPoint(pt) { return this.elevationAtT(this.tForPoint(pt)); }

  /**
   * @param {number} t      Percent distance along origin --> destination ray.
   * @returns {PIXI.Point}
   */
  pointAtT(t) { return this.origin.projectToward(this.destination, t); }

  /**
   * Get the closest point on the ray and return the t value for that location.
   * @param {Point} pt    Point to use to determine the closest point to the ray
   * @returns {number} The t value, where origin = 0, destination = 1
   */
  tForPoint(pt) {
    const { origin, destination } = this;
    const rayPt = foundry.utils.closestPointToSegment(pt, origin, destination);
    const dist2 = PIXI.Point.distanceSquaredBetween(origin, rayPt);
    const delta = destination.subtract(origin);
    return Math.sqrt(dist2 / delta.magnitudeSquared());
  }

  /**
   * Options for path:
   * 1. On terrain going uphill: stay on terrain.
   * 2. On terrain going downhill:
   *   - If tile is at elevation, switch to tile.
   *   - If downhill cliff: prefer tile within reach
   *   - switch to any tile between the prev and current elevation
   * 2. On tile: check for terrain breaching tile space; switch to terrain
   * 3. On tile end: Prefer tile at elevation; tile within reach; or tile/terrain below.
   * @returns {object[]}
   */
  _walkPath() {
    const { startElevation, path, markerTracker } = this;
    path.length = 0;
    markerTracker.initialize();

    // At the starting point, are we dropping to terrain or a tile?
    // (No tiles at this point, so the first marker is the terrain.)
    let currMarker = this.#checkForSupportingTile(
      markerTracker.nextMarker, startElevation, undefined, undefined, true);
    path.push(currMarker);

    // Iterate over each marker in turn.
    let nextMarkers = markerTracker.pullNextMarkers();
    while ( nextMarkers.length ) {
      // Multiple markers at a given t are possible, if unlikely.
      const nextTerrainMarker = nextMarkers.find(m => !m.tile);
      const nextMarker = currMarker.tile
        ? this.#identifyNextMarkerFromTileLocation(nextMarkers, currMarker, nextTerrainMarker)
        : this.#identifyNextMarkerFromTerrainLocation(nextTerrainMarker);
      if ( nextMarker ) {
        // An elevation event occurred: moving up/down terrain or moving on/off tile.
        path.push(nextMarker);
        currMarker = nextMarker;
      }
      nextMarkers = markerTracker.pullNextMarkers();
    }

    return this.path;
  }

  #identifyNextMarkerFromTileLocation(nextMarkers, currMarker, nextTerrainMarker) {
    const currTile = currMarker.tile;

    // If the elevation is exceeding the tile at this point, switch to the elevation.
    if ( nextTerrainMarker
      && nextTerrainMarker.prevE <= currTile.elevationE
      && nextTerrainMarker.elevation > currTile.elevationE ) return nextTerrainMarker;

    // If only terrain markers or other tile markers, continue moving along this tile.
    const tileEndMarker = nextMarkers.find(m => m.tile === currTile)
    if ( !tileEndMarker ) return null;

    // If one of the markers is this tile, it signifies either a hole or the end of the tile.
    // Either way, search for new supporting tile or drop to elevation.
    if ( !nextTerrainMarker ) {
      this.TEC.location = currMarker;
      nextTerrainMarker = this.markerTracker.constructElevationMarkerAt(tileEndMarker, this.TEC.terrainElevation());
    }
    return this.#checkForSupportingTile(nextTerrainMarker, currMarker.elevation, currTile, undefined, true);
  }

  #identifyNextMarkerFromTerrainLocation(nextTerrainMarker) {
    if ( !nextTerrainMarker ) return null; // Only tile markers at this location.

    // Moving up in terrain: stay on the terrain.
    if ( nextTerrainMarker.elevation >= nextTerrainMarker.prevE ) return nextTerrainMarker;

    // Moving down in terrain. Look for tile to switch to between the previous and this elevation.
    const reach = (nextTerrainMarker.elevation - nextTerrainMarker.prevE) < this.TEC.options.tileStep;
    return this.#checkForSupportingTile(
      nextTerrainMarker, nextTerrainMarker.prevE, undefined, nextTerrainMarker.elevation, reach);
  }

  drawPath(path) {
    path ??= this.path;
    for ( const marker of path ) {
      const { tile, t, elevation } = marker;
      const color = tile ? Draw.COLORS.orange : Draw.COLORS.green;
      const pt = this.pointAtT(t);
      Draw.point(pt, { color, radius: 2 });
      Draw.labelPoint(pt, elevation);
    }
  }

  drawReachableTiles() {
    for ( const tile of this.reachableTiles ) {
      const cache = tile.evPixelCache;
      Draw.shape(cache.getThresholdCanvasBoundingBox(), { color: Draw.COLORS.orange });
      Draw.labelPoint(tile, tile.elevationE);
    }
  }

  _findTilesWithinReach(currElevation, tileSet = new Set()) {
    let newElevation = currElevation;
    let newWithinReach = false;
    this.TEC.tiles.forEach(t => {
      if ( !tileSet.has(t)
        && t.elevationZ > currElevation
        && t.elevationZ <= (currElevation + this.TEC.options.tileStep) ) {
        newElevation = Math.max(newElevation, t.elevationZ);
        tileSet.add(t);
        newWithinReach ||= true;
      }
    });
    if ( !newWithinReach ) return tileSet;
    return this._findTilesWithinReach(newElevation, tileSet);
  }

  /**
   * Construct a skeleton elevation marker for when the token falls somewhere from a tile (not at a marker).
   */
  _constructElevationMarkerAt(t, elevation) {
    if ( typeof elevation === "undefined" ) {
      this.TEC.location = this.origin.projectToward(this.destination, t);
      elevation = this.TEC.terrainElevation();
    }
    return this.terrainWalk.markers[0].addSubsequentMarker(t, { elevation });
  }

  /**
   * Check for supporting tile and return it or the current marker.
   * @param {Marker} marker
   * @param {Tile} excludeTile
   * @param {number} floor
   * @param {boolean} reach
   */
  #checkForSupportingTile(marker, elevation, excludeTile, floor, reach) {
    const tile = this._findSupportingTileAtT(marker.t, elevation, excludeTile, floor, reach);
    if ( !tile ) return marker;
    return this.markerTracker.constructTileMarkerAt(marker, tile);
  }

  /**
   * Try to locate a supporting tile at a location.
   * @param {number} t0                 Point along ray
   * @param {Tile} [excludeTile]        Tile to exclude, if any
   * @param {boolean} [reach=false]     If true, allow tiles within reach
   * @returns {Tile|null}
   */
  _findSupportingTileAtT(t, elevation, excludeTile, floor, reach = false) {
    const TEC = this.TEC;
    TEC.location = this.pointAtT(t);
    TEC.elevation = elevation;
    let tile = reach ? TEC.findSupportingTileWithinReach(excludeTile) : TEC.findSupportingTileAtElevation(excludeTile);
    tile ??= TEC.findSupportingTileBelow(excludeTile, floor);
    return tile;
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
    bounds.height ||= 1; // If a --> b is horizontal, add height to bounds
    const collisionTest = (o, _rect) => o.t.document.overhead && isFinite(o.t.elevationZ);
    let tiles = [...canvas.tiles.quadtree.getObjects(bounds, { collisionTest })];

    // Only keep tiles that actually intersect the ray.
    tiles = tiles.filter(t => {
      const cache = t.evPixelCache;
      const bounds = alphaThreshold ? cache.getThresholdCanvasBoundingBox() : cache;
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
    bounds.height ||= minHeight; // If a --> b is horizontal, add height to bounds
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

// Utility class to keep track of elevation and tile markers and provide the next one.
class MarkerTracker {
  /**
   * Sorted queue to track markers by their canvas location, using t value against the travel ray.
   * Reverse sorted so we can just pop elements.
   * @type {object[]}
   */
  reverseQueue = [];

  /** @type {object[]} */
  terrainMarkers = [];

  /** @type {PIXI.Point} */
  #tmpPoint = new PIXI.Point();

  /** @type {function} */
  #markTransparentTileFn;

  /** @type {function} */
  #markTerrainFn = (curr, prev) => prev !== curr;

  /** @type {number} */
  #deltaMag2 = 0;

  constructor(travelRay) {
    this.travelRay = travelRay;
    this.#deltaMag2 = this.#calculateRayDeltaMag2();

    // Mark any terrain location that changes elevation along the a --> b ray.
    const ev = canvas.elevation;
    this.terrainMarkers = ev.elevationPixelCache
      ._extractAllMarkedPixelValuesAlongCanvasRay(travelRay.origin, travelRay.destination, this.#markTerrainFn);

    this.terrainMarkers.forEach(mark => {
      mark.t = this.tForCanvasPoint(mark);
      mark.elevation = ev._scaleNormalizedElevation(mark.currPixel);
      mark.prevE = ev._scaleNormalizedElevation(mark.prevPixel); // May be NaN if no previous.
    });
  }

  #calculateRayDeltaMag2() {
    const { origin, destination } = this.travelRay;
    const delta = destination.subtract(origin);
    return delta.magnitudeSquared();
  }

  // Note: Assumes but does not test that the canvas point is actually on the ray.
  tForCanvasPoint(canvasPt) {
    const dist2 = PIXI.Point.distanceSquaredBetween(this.travelRay.origin, canvasPt);
    return Math.sqrt(dist2 / this.#deltaMag2);
  }

  initialize() {
    this.reverseQueue = [...this.terrainMarkers];
    this.reverseQueue.reverse();
    this.#markTransparentTileFn = this.#initializeMarkTransparentTileFn();
  }

  get nextMarker() { return this.reverseQueue.pop(); }

  get peek() { return this.reverseQueue.at(-1); }

  /**
   * Pull next markers that have the same t value.
   */
  pullNextMarkers() {
    const firstMarker = this.nextMarker;
    if ( !firstMarker ) return [];
    const targetT = firstMarker.t;
    const markers = [firstMarker];
    while ( this.reverseQueue.length && this.peek.t === targetT ) markers.push(this.nextMarker);
    return markers;
  }

  #initializeMarkTransparentTileFn() {
    const threshold = 255 * this.travelRay.alphaThreshold;

    // curr is { result, numUndefined, numPixels }
    fn


    const fn = curr => curr < threshold;
    return fn;
  }



  addNextTileMarkerAfter(marker, tile) {
    const nextMarker = tile.evPixelCache._extractNextMarkedPixelValueAlongCanvasRay(
      marker, this.travelRay.destination, this.#markTransparentTileFn,
      { alphaThreshold: this.travelRay.alphaThreshold, skipFirst: true, forceLast: true });

    nextMarker.tile = tile;
    nextMarker.t = this.tForCanvasPoint(nextMarker);

    // Probably not worth binary or radix search b/c we don't have that many markers in the queue.
    // Also, a naive binary implementation proves to be slower than find.
    const findFn = element => element.t > nextMarker.t;
    const idx = this.reverseQueue.findLastIndex(findFn);
    this.reverseQueue.splice(idx, 0, nextMarker);
  }

  /**
   * Create a path marker for the tile and return it.
   * Add the next marker for that tile to the tracker.
   * @param {Marker} marker   Current marker describing the location and t percentage.
   * @param {Tile} tile
   * @returns {object}
   */
  constructTileMarkerAt(marker, tile) {
    this.addNextTileMarkerAfter(marker, tile);
    const { x, y, t} = marker;
    return { x, y, t, tile, elevation: tile.elevationE };
  }

  /**
   * Create a path marker for the elevation and return it.
   * @param {Point} canvasPosition
   * @param {number} [elevation]
   * @param {number} [t]
   */
  constructElevationMarkerAt(canvasPoint, elevation, t) {
    t ??= this.tForCanvasPoint(canvasPoint);
    const { x, y } = canvasPoint;
    return { x, y, t, elevation };
  }
}
