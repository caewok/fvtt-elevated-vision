/* globals
canvas,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Draw } from "./geometry/Draw.js";
import { Marker } from "./PixelCache.js";

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

  /**
   * Initialize the objects needed when walking a path along the ray a --> b
   */
  _initializePathObjects() {
    const { origin, destination, path, tileWalks, reachableTiles } = this;
    path.length = 0;
    tileWalks.clear();
    reachableTiles.clear();

    // Mark any terrain location that changes elevation along the a --> b ray.
    // Also, get the maximum elevation value.
    let maxTerrainElevation = 0; // Because these are normalized pixel values, can use 0 here.
    const markTerrainPixelFn = (prev, curr) => {
      maxTerrainElevation = Math.max(maxTerrainElevation, prev, curr);
      return prev !== curr;
    };
    const terrainCache = canvas.elevation.elevationPixelCache;
    this.terrainWalk = terrainCache.pixelValuesForLine(origin, destination, { markPixelFn: markTerrainPixelFn });
    maxTerrainElevation = canvas.elevation._scaleNormalizedElevation(maxTerrainElevation);

    // Construct the Terrain markers from the pixel values.
    TerrainMarker.convertPixelWalk(this.terrainWalk, origin, destination);

    // Find all tiles less than or equal to the max elevation.
    // Then add in tiles that are within tile step, repeatedly.
    this.TEC.tiles.forEach(t => {
      if ( t.elevationE <= maxTerrainElevation ) reachableTiles.add(t);
    });
    this._findTilesWithinReach(maxTerrainElevation, reachableTiles);

    // Replace the TEC tiles with this filtered set based on maximum elevation.
    this.TEC.options.tiles = [...reachableTiles];
    this.TEC.options.tiles.sort((a, b) => b.elevationE - a.elevationE);
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
    const TYPES = ElevationMarker.TYPES;
    path.length = 0;

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
   * Construct a skeleton tile marker for when the token falls somewhere on the tile (not at a marker).
   */
  _constructTileMarkerAt(t, tile) {
    return this._getTileWalk(tile).markers[0].addSubsequentMarker(t);
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

// ----- NOTE: Marker classes ----- //
class ElevationMarker extends Marker {
  /** @enum {number} */
  static TYPES = {
    TERRAIN: 0,
    TILE: 1
  };

  /** @type {number} */
  get elevation() { return this.options.elevation; }

  addSubsequentMarker(t, opts) {
    const next = super.addSubsequentMarker(t, opts);
    next.options.prevElevation = this.elevation;
    return next;
  }

  _addSubsequentMarkerFast(t, opts) {
    const next = super._addSubsequentMarkerFast(t, opts);
    next.options.prevElevation = this.elevation;
    return next;
  }

  /**
   * Provide function that will convert range of t values to another, based on linear scaling.
   * @param {PIXI.Point} targetStart
   * @param {PIXI.Point} targetEnd
   * @param {PIXI.Point} formerStart
   * @param {PIXI.Point} formerEnd
   * @returns {function}
   */
  static convertRangeFn(targetStart, targetEnd, formerStart, formerEnd) {
    // Compare the former length to the target length and quantify the overlap.
    const delta = targetEnd.subtract(targetStart);
    const deltaMag = delta.magnitudeSquared();
    const dist2_0 = PIXI.Point.distanceSquaredBetween(targetStart, formerStart);
    const dist2_1 = PIXI.Point.distanceSquaredBetween(targetStart, formerEnd);
    const t0 = Math.sqrt(dist2_0 / deltaMag);
    const t1 = Math.sqrt(dist2_1 / deltaMag);

    // Provide function to scale the t values.
    const diff = t1 - t0;
    return t => t0 + (diff * t);
  }

  /**
   * Convert each marker in pixel walk to this subclass.
   * Transforms the t values from the pixel walk to the positions on this travel ray.
   * @param {object} walk         Walk from PixelCache
   * @param {PIXI.Point} start    The starting position of the travel ray; used to convert walk marker t values
   * @param {PIXI.Point} end      The ending position of the travel ray; used to convert walk marker t values
   * @param {object} optsToAdd    Options to pass to the options parameter of the marker
   * @returns {object} The walk object, updated with a new marker array
   */
  static convertPixelWalk(walk, start, end, optsToAdd) {
    const nMarkers = walk.markers.length;
    if ( !nMarkers ) return;

    // Use intersection points to convert the t values for the walk
    const convertT = this.convertRangeFn(start, end, walk.canvasBoundsIx[0], walk.canvasBoundsIx[1]);

    // Construct the starting marker.
    let currMarker;
    const toConvert = walk.markers[0];
    const t = convertT(toConvert.t);
    const opts = { ...toConvert.options, ...optsToAdd }
    walk.markers[0] = currMarker = new this(t, start, end, opts);

    // Iterate through rest of the markers, building off the previous.
    for ( let i = 1; i < nMarkers; i += 1 ) {
      const toConvert = walk.markers[i];
      const t = convertT(toConvert.t);
      const opts = { ...toConvert.options, ...optsToAdd };
      walk.markers[i] = currMarker = currMarker._addSubsequentMarkerFast(t, opts);
    }

    return walk;
  }
}

class TerrainMarker extends ElevationMarker {
  /** @type {TYPES} */
  type = ElevationMarker.TYPES.TERRAIN;

  /** @type {number} */
  #elevation;

  get elevation() {
    if ( typeof this.#elevation === "undefined") {
      const { elevation, currPixel } = this.options;
      if ( typeof elevation !== "undefined" ) this.#elevation = elevation;
      else if ( typeof currPixel !== "undefined" ) this.#elevation = this.constructor.elevationFromPixel(currPixel);
    }
    return this.#elevation;
  }

  static elevationFromPixel(pixel) { return canvas.elevation._scaleNormalizedElevation(pixel); }
}

class TileMarker extends ElevationMarker {
  /** @type {TYPES} */
  type = ElevationMarker.TYPES.TILE;

  get elevation() { return this.options.tile.elevationE; }
}
