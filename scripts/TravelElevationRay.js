/* globals
canvas,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Draw } from "./geometry/Draw.js";

export class TravelElevationRay {
  /** @type {TokenElevationCalculator} */
  TEC;

  /** @type {PIXI.Point} */
  destination = new PIXI.Point();

  /** @type {PIXI.Point} */
  origin = new PIXI.Point();

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

  /** @type {Map<Tile|"terrain",Point[2]} */
  localRays = new Map();

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
    this.destination.copyFrom(destination);
    this.TEC = new canvas.elevation.TokenElevationCalculator(token, opts);
    this.origin.copyFrom(this.TEC.location);
    this.startElevation = this.TEC.options.elevation;

    // Assist TEC by limiting the tiles to those along the ray.
    const fn = this.constructor.elevationTilesOnLineSegment;
    this.TEC.tiles = fn(this.origin, destination, this.TEC.options.alphaThreshold);
  }

  /** @type {number} */
  get alphaThreshold() { return this.TEC.options.alphaThreshold; }

  elevationAtT(t) {

  }

  elevationAtClosestPoint(x, y) {

  }

  /**
   * @param {number} t      Percent distance along origin --> destination ray.
   * @returns {PIXI.Point}
   */
  pointAtT(t) { return this.origin.projectToward(this.destination, t); }

  get startingElevation() { return this.TEC.groundElevation(); }

  get endingElevation() {

  }

  /**
   * @typedef {object} elevationMarker
   * @property {number} t       Where on the start --> end ray is this, between 0 and 1
   * @property {}
   */

  #markTerrainFn = (curr, prev) => prev !== curr;

  /**
   * Initialize the objects needed when walking a path along the ray a --> b
   */
  _initializePathObjects() {
    // TODO: How to give the token calculator a limited set of tiles or use an intersection test on the tiles?
    // Could make our own quadtree, but updating could be problematic if the tile moves.

    const { origin, destination, path, localRays } = this;
    path.length = 0;
    localRays.clear();

    // Pull all the terrain markers along the ray.
    // Mark any terrain location that changes elevation along the a --> b ray.
    const terrainCache = canvas.elevation.elevationPixelCache;
    this.terrainMarkers = terrainCache._extractAllMarkedPixelValuesAlongCanvasRay(
      origin, destination, this.#markTerrainFn);

    // Do we care about reachable tiles?
    // Reachable and along the ray?
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
   */
  _walkPath() {
    const { startElevation, path, TEC } = this;
    const TYPES = { TERRAIN: 0, TILE: 1 };
    path.length = 0;
    const terrainMarkerIter = this.terrainMarkers[Symbol.iterator]();

    // At the starting point, are we dropping to terrain or a tile?
    let terrainMarker = terrainMarkerIter.next().value;
    let currTile = this._findSupportingTileAtT(0, startElevation, undefined, undefined, true);



    // Class to track how far along we are with each terrain / tile ?
    // Get the next marker. Class stores the current marker location. So if it is called again,
    // can get the next one on demand. And if necessary, skip to one further along.
    // Can also track local terrain position, which would help. So at given iteration,
    // we have the canvas position, the terrain local, choice of tile or terrain, and the corresponding elevation.
//
//     tileTracker = saved in Map or create new class.
//     tileTracker.nextMarker(canvasX, canvasY); <<-- ensure we go past the current position on the ray
//
//     or
//
//     terrainTracker.nextMarker(localX, localY);




    // At the starting point, are we dropping to terrain or a tile?
    const startTile = this._findSupportingTileAtT(0, startElevation, undefined, undefined, true);
    let currMarker = startTile
      ? this._constructTileMarkerAt(0, startTile) : this._constructElevationMarkerAt(0);
    path.push(currMarker);
    currMarker = currMarker.next;

    // For each currMarker, is it the valid next location/elevation? If not, locate a new one and add.
    while ( currMarker && currMarker.t < 1 ) {
      const { t, elevation, type } = currMarker;
      switch ( type ) {
        case TYPES.TILE: {
          const tile = this._findSupportingTileAtT(t, elevation, currMarker.tile, undefined, true);
          if ( tile ) currMarker = this._constructTileMarkerAt(t, tile);
          else currMarker = this._constructElevationMarkerAt(t);
          break;
        }

        case TYPES.TERRAIN: {
          if ( currMarker.prevPixel < currMarker.currPixel ) break; // Moving up in terrain.

          // Moving down in terrain. Look for tile to switch to between the previous and this elevation
          const prevE = currMarker.options.prevElevation;
          const reach = (elevation - prevE) < TEC.options.tileStep;
          const tile = this._findSupportingTileAtT(t, prevE, undefined, elevation, reach);
          if ( tile ) currMarker = this._constructTileMarkerAt(t, tile);
        }

      }
      path.push(currMarker);
      currMarker = currMarker.next;
    }
  }

  drawPath() {
    for ( const marker of this.path ) {
      const color = marker.tile ? Draw.COLORS.orange : Draw.COLORS.green;
      const pt = this.pointAtT(marker.t);
      Draw.point(pt, { color, radius: 2 });
      Draw.labelPoint(pt, marker.elevation);
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

  _getTileWalk(tile) {
    if ( this.tileWalks.has(tile) ) return this.tileWalks.get(tile);

    // Function to mark any tile location that changes from not transparent --> transparent along the a --> b ray.
    const { TEC, origin, destination } = this;
    const threshold = 255 * TEC.options.alphaThreshold;
    const markTilePixelFn = (prev, curr) => (prev > threshold) && (curr < threshold);

    // Retrieve and format the tile walk.
    const tileWalk = tile.evPixelCache.pixelValuesForLine(origin, destination, { markPixelFn: markTilePixelFn });
    TileMarker.convertPixelWalk(tileWalk, origin, destination, { tile });
    this.tileWalks.set(tile, tileWalk);
    return tileWalk;
  }



  /**
   * Retrieve the next transparent position along this tile.
   * Uses the tile's alpha threshold borders.
   * @param {Tile} tile
   * @param {Point} canvasPosition      Starting position to search from
   * @returns {object} Either the next transparent point or the end of the tile along the ray.
   *   Null if the tile and ray don't intersect.
   */
//   _getNextTileMarker(tile, canvasPosition) {
//     const marker = tile.evPixelCache._extractNextMarkedPixelValueAlongCanvasRay(
//       canvasPosition, this.destination, this.#markTransparentTileFn,
//       { alphaThreshold: this.alphaThreshold, skipFirst: true, forceLast: true });
//
//     // TODO: Does this work properly for the tile edges?
//
//     return marker;
//   }

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

// Utility class to keep track of elevation and tile markers and provide the next one.
class MarkerTracker {
  /**
   * Sorted queue to track markers by their canvas location, using t value against the travel ray.
   * Reverse sorted so we can just pop elements.
   * @type {object}
   */
  reverseQueue = [];

  /** @type {Iterator<object>} */
  terrainMarkerIter;

  /** @type {PIXI.Point} */
  #tmpPoint = new PIXI.Point();

  /** @type {function} */
  #markTransparentTileFn;

  constructor(travelRay) {
    this.travelRay = travelRay;
  }

  /**
   * Create a terrain marker iterator and add the first to the queue.
   */
  initialize() {
    this.terrainMarkerIter = this.travelRay.terrainMarkers[Symbol.iterator]();
    const firstTerrain = this.terrainMarkerIter.next().value;
    firstTerrain.t = 0;
    this.queue.push(firstTerrain);
    this.#markTransparentTileFn = this.#initializeMarkTransparentTileFn();
  }

  get nextMarker() { return this.reverseQueue.pop(); }

  #initializeMarkTransparentTileFn() {
    const threshold = 255 * this.travelRay.alphaThreshold;
    const fn = curr => curr < threshold;
    return fn;
  }

  addNextTileMarkerAfter(canvasPosition, tile) {
    const marker = tile.evPixelCache._extractNextMarkedPixelValueAlongCanvasRay(
      canvasPosition, this.travelRay.destination, this.#markTransparentTileFn,
      { alphaThreshold: this.travelRay.alphaThreshold, skipFirst: true, forceLast: true });

    marker.tile = tile;
    this.#tmpPoint.copyFrom(marker);
    marker.t = this.travelRay.pointAtT(this.#tmpPoint);

    // Probably not worth binary or radix search b/c we don't have that many markers in the queue.
    // Also, a naive binary implementation proves to be slower than find.
    const findFn = element => element.t > marker.t;
    const idx = this.reverseQueue.findLastIndex(findFn);
    this.reverseQueue.splice(idx, 0, marker);
  }
}
