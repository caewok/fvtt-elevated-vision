/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { Draw } from "./geometry/Draw.js";

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

  /** @type {Token} */
  #token;

  /** @type {PIXI.Point} */
  #destination = new PIXI.Point();

  /** @type {PIXI.Point} */
  #origin = new PIXI.Point();

  /** @type {number} */
  #originElevationZ = 0;

  /** @type {object} */
  terrainWalk;

  /** @type {Map<string;object>} */
  tileWalks = new Map();

  /** @type {object[]} */
  #path = [];

  /** @type {MarkerTracker} */
  markerTracker;

  /** @type {object[]} */
  terrainMarkers = [];

  /** @type {TokenElevationCalculator} */
  TEC;

  /**
   * @param {Token} token               Token that is undertaking the movement
   * @param {PIXI.Point} destination    {x,y} destination for the movement
   * @param {Point} [opts.tokenCenter]      Assumed token center at start
   * @param {number} [opts.tokenElevation]  Assumed token elevation at start
   */
  constructor(token, { origin, destination } = {}) {
    this.#token = token;
    this.TEC = token[MODULE_ID].TEC;

    if ( origin ) this.origin = origin;
    else this.origin = token.center;

    if ( origin && Object.hasOwn(origin, "z") ) this.originElevation = origin.z;
    else this.#originElevationZ = token.elevationZ;

    if ( destination ) this.destination = destination;
  }

  /** @type {number} */
  get alphaThreshold() { return this.TEC.options.alphaThreshold; }

  /** @type {number} */
  get startingElevation() {
    const TEC = this.TEC;
    TEC.overrideTokenPosition = true;
    TEC.location = this.origin;
    TEC.elevationZ = this.originElevation;
    const e = TEC.groundElevation();
    TEC.overrideTokenPosition = false;
    return e;
  }

  /** @type {number} */
  get endingElevation() { return this.elevationAtT(1); }

  /** @type {PIXI.Point} */
  get origin() { return this.#origin; }

  set origin(value) {
    this.#origin.copyFrom(value);
    this.#path.length = 0;
  }

  /** @type {PIXI.Point} */
  get destination() { return this.#destination; }

  set destination(value) {
    this.#destination.copyFrom(value);
    this.#path.length = 0;
  }

  get originElevationZ() { return this.#originElevationZ; }

  set originElevationZ(value) {
    this.#originElevationZ = value;
    this.#path.length = 0;
  }

  get originElevation() { return CONFIG.GeometryLib.utils.pixelsToGridUnits(this.#originElevationZ); }

  set originElevation(e) { this.#originElevationZ = CONFIG.GeometryLib.utils.gridUnitsToPixels(e); }

  get path() {
    if ( !this.#path.length ) this._walkPath();
    return this.#path;
  }

  resetOriginToToken() {
    this.origin = this.token.center;
    this.originElevationZ = this.token.elevationZ;
  }

  /**
   * @param {number} t    Percent distance along the ray
   * @returns {number} Elevation value at that location
   */
  elevationAtT(t) {
    const path = this.path;
    if ( !path.length ) this._walkPath();
    if ( t >= 1 ) return path.at(-1).elevation;
    if ( t <= 0 ) return path.at(0).elevation;
    const mark = path.findLast(mark => mark.t <= t);
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
    const path = this.#path;
    path.length = 0;
    const markerTracker = this.markerTracker = new MarkerTracker(this);
    this.TEC.overrideTokenPosition = true;

    // At the starting point, are we dropping to terrain or a tile?
    // (No tiles at this point, so the first marker is the terrain.)
    let currMarker = this._checkForSupportingTile(
      markerTracker.nextMarker, this.originElevation, undefined, undefined, true);
    path.push(currMarker);

    // Iterate over each marker in turn.
    let nextMarkers = markerTracker.pullNextMarkers();
    while ( nextMarkers.length ) {
      // Multiple markers at a given t are possible, if unlikely.
      const nextTerrainMarker = nextMarkers.find(m => !m.tile);
      const nextMarker = currMarker.tile
        ? this._identifyNextMarkerFromTileLocation(nextMarkers, currMarker, nextTerrainMarker)
        : this._identifyNextMarkerFromTerrainLocation(nextTerrainMarker);
      if ( nextMarker ) {
        // An elevation event occurred: moving up/down terrain or moving on/off tile.
        path.push(nextMarker);
        currMarker = nextMarker;
      }
      nextMarkers = markerTracker.pullNextMarkers();
    }
    this.TEC.overrideTokenPosition = false;
    return path;
  }

  _identifyNextMarkerFromTileLocation(nextMarkers, currMarker, nextTerrainMarker) {
    const currTile = currMarker.tile;

    // If the elevation is exceeding the tile at this point, switch to the elevation.
    if ( nextTerrainMarker
      && nextTerrainMarker.prevE <= currTile.elevationE
      && nextTerrainMarker.elevation > currTile.elevationE ) return nextTerrainMarker;

    // If only terrain markers or other tile markers, continue moving along this tile.
    const tileEndMarker = nextMarkers.find(m => m.tile === currTile);
    if ( !tileEndMarker ) return null;

    // If one of the markers is this tile, it signifies either a hole or the end of the tile.
    // Either way, search for new supporting tile or drop to elevation.
    if ( !nextTerrainMarker ) {
      this.TEC.location = currMarker;
      nextTerrainMarker = this.markerTracker.constructElevationMarkerAt(tileEndMarker, this.TEC.terrainElevation());
    }
    return this._checkForSupportingTile(nextTerrainMarker, currMarker.elevation, currTile, undefined, true);
  }

  _identifyNextMarkerFromTerrainLocation(nextTerrainMarker) {
    if ( !nextTerrainMarker ) return null; // Only tile markers at this location.

    // Moving up in terrain: stay on the terrain.
    if ( nextTerrainMarker.elevation >= nextTerrainMarker.prevE ) return nextTerrainMarker;

    // Moving down in terrain. Look for tile to switch to between the previous and this elevation.
    const reach = (nextTerrainMarker.elevation - nextTerrainMarker.prevE) < this.TEC.options.tileStep;
    return this._checkForSupportingTile(
      nextTerrainMarker, nextTerrainMarker.prevE, undefined, nextTerrainMarker.elevation, reach);
  }

  drawPath(path) {
    this.TEC.overrideTokenPosition = true;
    path ??= this.path;
    for ( const marker of path ) {
      const { tile, t, elevation } = marker;
      const color = tile ? Draw.COLORS.orange : Draw.COLORS.green;
      const pt = this.pointAtT(t);
      Draw.point(pt, { color, radius: 2 });
      Draw.labelPoint(pt, elevation);

      this.TEC.location = pt;
      const lowestTile = tile ?? this.TEC.tiles.at(-1);
      this.TEC.drawOffsetGrid(lowestTile);
    }
    this.TEC.overrideTokenPosition = false;
  }

  _findTilesWithinReach(currElevation, tileSet = new Set()) {
    let newElevation = currElevation;
    let newWithinReach = false;
    this.TEC.tiles.forEach(t => {
      if ( !tileSet.has(t)
        && t.elevationE > currElevation
        && t.elevationE <= (currElevation + this.TEC.options.tileStep) ) {
        newElevation = Math.max(newElevation, t.elevationE);
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
  _checkForSupportingTile(marker, elevation, excludeTile, floor, reach) {
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
}

// Utility class to keep track of elevation and tile markers and provide the next one.
const INV_10 = 1 / 10; // Used to round pixels to nearest 1/10.
export class MarkerTracker {
  /**
   * Sorted queue to track markers by their canvas location, using t value against the travel ray.
   * Reverse sorted so we can just pop elements.
   * @type {object[]}
   */
  terrainMarkers = [];

  /** @type {PIXI.Point} */
  #tmpPoint = new PIXI.Point();


  /** @type {number} */
  #deltaMag2 = 0;

  /** @type{function} */
  #markTerrainFn = (curr, prev) => (Math.round(prev * 10) * INV_10)!== (Math.round(curr * 10) * INV_10);

  /** @type{function} */
  #markTransparentTileFn;

  constructor(travelRay) {
    this.travelRay = travelRay;
    this.#deltaMag2 = this.#calculateRayDeltaMag2();

    this.#markTransparentTileFn = this.getMarkTransparentTileFn();

    // Mark any terrain location that changes elevation along the a --> b ray.
    this._markTerrain();
    this.terrainMarkers.reverse();
  }

  getMarkTransparentTileFn() {
    const threshold = this.travelRay.alphaThreshold * 255;
    return curr => curr < threshold;
  }

  _markTerrain() {
    const ev = canvas.elevation;
    const { origin, destination, TEC } = this.travelRay;

    const localOffsets = TEC._getLocalOffsets("terrain");
    const reducerFn = TEC.terrainPixelAggregationFn;
    this.terrainMarkers = ev.elevationPixelCache
      ._extractAllMarkedPixelValuesAlongCanvasRay(origin, destination, this.#markTerrainFn,
        { forceLast: true, localOffsets, reducerFn });

    // Force the first and last terrain marker to be exactly at the origin / destination.
    // Rounding to/from local coordinates may shift these.
    const firstMarker = this.terrainMarkers[0];
    const lastMarker = this.terrainMarkers.at(-1);

    firstMarker.x = origin.x;
    firstMarker.y = origin.y;
    lastMarker.x = destination.x;
    lastMarker.y = destination.y;
    lastMarker.prevPixel ??= lastMarker.currPixel;

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

  get nextMarker() { return this.terrainMarkers.pop(); }

  get peek() { return this.terrainMarkers.at(-1); }

  /**
   * Pull next markers that have the same t value.
   */
  pullNextMarkers() {
    const firstMarker = this.nextMarker;
    if ( !firstMarker ) return [];
    const targetT = firstMarker.t;
    const markers = [firstMarker];
    while ( this.terrainMarkers.length && this.peek.t === targetT ) markers.push(this.nextMarker);
    return markers;
  }

  addNextTileMarkerAfter(marker, tile) {
    const { alphaThreshold, destination, TEC } = this.travelRay;
    const localOffsets = TEC._getLocalOffsets(tile);
    const reducerFn = TEC.tilePixelAggregationFn;
    const nextMarker = tile.evPixelCache._extractNextMarkedPixelValueAlongCanvasRay(
      marker, destination, this.#markTransparentTileFn,
      { alphaThreshold, skipFirst: true, forceLast: true, localOffsets, reducerFn });

    if ( nextMarker.forceLast && nextMarker.currPixel > (alphaThreshold * 255) ) {
      // Reached the destination without finding a hole in the tile. Do not add the marker.
      return;
    }

    nextMarker.tile = tile;
    nextMarker.t = this.tForCanvasPoint(nextMarker);

    // Probably not worth binary or radix search b/c we don't have that many markers in the queue.
    // Also, a naive binary implementation proves to be slower than find.
    const findFn = element => element.t > nextMarker.t;
    const idx = this.terrainMarkers.findLastIndex(findFn);
    this.terrainMarkers.splice(idx + 1, 0, nextMarker);
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
