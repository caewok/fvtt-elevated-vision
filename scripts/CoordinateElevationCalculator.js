/* globals
CONFIG,
canvas,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "./geometry/3d/Point3d.js";
import { MODULE_ID } from "./const.js";
import { almostBetween, almostLessThan, almostGreaterThan } from "./util.js";

/* Point elevation tests

1. 3d point on terrain
2. 3d point on terrain tile
3. terrain elevation under point
4. tile elevation under point
  - highest tile under the point
5. ground elevation under point (combine 3 and 4)
*/

// Used by TravelElevationCalculator:
// √ terrainElevationAtToken
// √ findHighestTileAtToken --> √ tokenOnTile (isOnTile)
// groundElevationAtToken --> √ findSupportingTileUnderToken, √ terrainElevationAtToken
// √ findTileUnderToken (findTileAtElevation) --> √ excludeUndergroundTilesFn, √ tokenOnTile
// √ tileSupportsToken --> √ tileCouldSupportToken, √ withinStep

// Otherwise likely useful:
// √ isTokenOnTerrain
// √ isTokenOnATile
// isTokenOnGround --> isTokenOnATile

export class CoordinateElevationCalculator {

  /**
   * @typedef {object} PointElevationOptions
   * @property {number} alphaThreshold    Threshold under which a tile pixel is considered a (transparent) hole.
   * @property {number} tileStep          Tile at elevation or within tileStep above considered within reach.
   * @property {number} terrainStep       Terrain at elevation or below considered contiguous and is not a cliff
   */

  /** @type {PointElevationOptions} */
  options = {};

  /** @type {Point3d} */
  #point = new Point3d();

  constructor(point, opts = {}) {
    this.#point.copyFrom(point);
    this._configureOptions(opts);
  }

  /**
   * Options that affect elevation calculations.
   * @param {object} [opts]   Optional object of option overrides.
   */
  _configureOptions(opts = {}) {
    opts.alphaThreshold ??= CONFIG[MODULE_ID]?.alphaThreshold ?? 0.75;
    opts.tileStep ??= CONFIG[MODULE_ID]?.tileStep;
    opts.terrainStep ??= CONFIG[MODULE_ID]?.terrainStep;
    this.options = opts;
  }

  /** @type {PIXI.Rectangle} */
  get bounds() { return new PIXI.Rectangle(this.#point.x - 1, this.#point.y - 1, 2, 2); }

  /** @type {Point3d} */
  get coordinate() { return this.#point.clone(); }

  set coordinate(point) { this.#point.copyFrom(point); }

  /** @type {PIXI.Point} */
  get location() { return new PIXI.Point(this.#point.x, this.#point.y); }

  set location(value) {
    // Don't use copyFrom in case value has a z property.
    this.#point.x = value.x;
    this.#point.y = value.y;
  }

  /** @type {number}  Grid units */
  get elevation() { return CONFIG.GeometryLib.utils.pixelsToGridUnits(this.#point.z); }

  set elevation(e) { this.#point.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(e); }

  /** @type {number} Pixel units */
  get elevationZ() { return this.#point.z; }

  set elevationZ(value) { this.#point.z = value; }

  /** @type {Tile[]} */
  get tiles() { return this.constructor.locateTiles(this.bounds); }

  /** @type {number} */
  get tileStep() { return this.options.tileStep ?? 0; }

  /** @type {number} */
  get terrainStep() { return this.options.terrainStep ?? canvas.elevation.elevationStep; }

  /** @type {number}

  /**
   * Locate tiles within a given set of bounds.
   * Sorted from highest to lowest in elevation.
   * @param {PIXI.Rectangle} bounds
   * @returns {Tile[]}
   */
  static locateTiles(bounds) {
    // Filter tiles that potentially serve as ground from canvas tiles.
    const tiles = [...canvas.tiles.quadtree.getObjects(bounds)].filter(tile => {
      if ( !tile.document.overhead ) return false;
      return isFinite(tile.elevationE);
    });
    tiles.sort((a, b) => b.elevationZ - a.elevationZ);
    return tiles;
  }

  /**
   * Find the terrain elevation for a given x,y point
   * @param {Point} point
   * @returns {number}
   */
  static terrainElevationAt(point) {
    return canvas.elevation.elevationAt(point);
  }

  /**
   * Find the terrain elevation for this point
   * @returns {number}
   */
  terrainElevation() {
    return CoordinateElevationCalculator.terrainElevationAt(this.#point);
  }

  /**
   * Determine the terrain or tile elevation at this location.
   * @returns {number} Elevation in grid units
   */
  static groundElevationAt(point, opts) {
    const calc = new this(point, opts);
    return calc.groundElevation();
  }

  groundElevation() {
    const matchingTile = this.findHighestSupportingTile();
    const terrainE = this.terrainElevation();

    // If the terrain is above the tile, use the terrain elevation. (Math.max(null, 5) returns 5.)
    return Math.max(terrainE, matchingTile?.elevationE ?? null);
  }

  /**
   * Determine if the x,y,z point is on the terrain
   * @returns {boolean}
   */
  isOnTerrain() {
    const terrainE = this.terrainElevation();
    return this.elevation.almostEqual(terrainE);
  }

  /**
   * Determine if the point is on the tile.
   * Point must be approximately at the tile elevation and not over a hole pixel of the tile.
   * @param {Tile} [tile]       Tile to test. If none provided, will return true if a tile exists at this coordinate.
   * @returns {boolean}
   */
  isOnTile(tile) {
    if ( !tile ) return Boolean(this.findSupportingTileAtElevation());
    const tileE = tile.elevationE;
    if ( !this.elevation.almostEqual(tileE) ) return false;
    return this.tileCouldSupport(tile);
  }

  /**
   * Determine if the coordinate is on the ground, meaning on a tile or terrain
   * @returns {boolean}
   */
  isOnGround() {
    return this.groundElevation().almostEqual(this.elevation);
  }


  /**
   * Is the coordinate sufficiently near a tile to be considered supported?
   * Must be within tileStep of tile elevation and on an opaque portion of the tile.
   * @param {Tile} tile
   * @returns {boolean}
   */
  tileSupports(tile) {
    if ( !this.tileWithinStep(tile) ) return false;
    return this.tileCouldSupport(tile);
  }

  /**
   * This coordinate could be supported by the tile
   * @param {Tile} tile
   * @returns {boolean}
   */
  tileCouldSupport(tile) { return this.tileIsOpaque(tile); }

  /**
   * Opacity of tile at this point.
   * @param {Tile} tile
   * @returns {number|null}  Null if tile is not an overhead tile (has a pixel cache).
   */
  tileOpacity(tile) {
    const cache = tile.evPixelCache;
    if ( !cache ) return null;
    const location = this.location;
    return cache.pixelAtCanvas(location.x, location.y) / cache.maximumPixelValue;
  }

  /**
   * Is this tile opaque at the given point?
   * @param {Tile} tile
   * @returns {boolean}
   */
  tileIsOpaque(tile) {
    const cache = tile.evPixelCache;
    if ( !cache ) return false;
    const location = this.location;
    return cache.containsPixel(location.x, location.y, this.options.alphaThreshold);
  }

  /**
   * Object is within a permitted step from provided elevation.
   * @param {number} tokenE       Token elevation to test against
   * @param {number} objE         Object elevation
   * @param {number} tileStep     Permitted tile step
   * @returns {boolean}
   */
  static withinStep(tokenE, objE, step) { return almostBetween(tokenE, objE, objE + step); }

  /*
   * Tile is within a permitted step from provided elevation.
   * @param {Tile} tile           Tile to test
   * @returns {boolean}
   */
  tileWithinStep(tile) {
    const tileE = tile.elevationE;
    return almostBetween(this.elevation, tileE, tileE + this.tileStep);
  }

  /**
   * Tile is equal or above the current elevation but within tile step of that elevation.
   * In addition, the tile could support this point.
   * @param {Tile}
   * @returns {boolean}
   */
  tileWithinReach(tile) {
    const tileE = tile.elevationE;
    if ( !almostBetween(this.elevation, tileE, tileE + this.tileStep) ) return false;
    return this.tileCouldSupport(tile);
  }

  /**
   * Terrain equal or below the current elevation but within terrain step of that elevation.
   * @returns {boolean}
   */
  terrainWithinStep() {
    const terrainE = this.terrainElevation();
    return almostBetween(this.elevation, terrainE - this.terrainStep, terrainE);
  }

  /**
   * Find highest tile at this location that could support the token.
   * @returns {Tile|null}
   */
  findHighestSupportingTile() {
    for ( const tile of this.tiles ) {
      if ( this.tileCouldSupport(tile) ) return tile;
    }
    return null;
  }

  /**
   * Find tile directly under the token (tile and token share elevation)
   * @param {Tile} [excludeTile]    Optional tile to exclude
   * @returns {Tile|null}
   */
  findTileAtElevation(excludeTile) {
    const excludeFn = excludeUndergroundTilesFn(this.#point, this.elevation);
    for ( const tile of this.tiles ) {
      if ( tile === excludeTile ) continue;
      const tileE = tile.elevationE;
      if ( excludeFn(tileE) || !almostLessThan(tileE, this.elevation) ) continue;
      if ( this.isOnTile(tile) ) return tile;
    }
    return null;
  }

  /**
   * Find supporting tile equal or above the current elevation but within tile step of that elevation.
   * @param {Tile} [excludeTile]    Optional tile to exclude from search
   * @returns {Tile|null}
   */
  findSupportingTileWithinReach(excludeTile) {
    for ( const tile of this.tiles ) {
      if ( tile === excludeTile ) continue;
      if ( this.tileWithinReach(tile) ) return tile;
    }
    return null;
  }

  /**
   * Find supporting tile below the current elevation.
   * @param {Tile} [excludeTile]    Optional tile to exclude from search
   * @returns {Tile|null}
   */
  findSupportingTile() {
    const terrainE = this.terrainElevation();
    const excludeFn = excludeUndergroundTilesFn(this.#point, this.elevation);
    for ( const tile of this.tiles ) { // Tiles are sorted highest --> lowest.
      const tileE = tile.elevationE;
      if ( tileE <= terrainE ) break;
      if ( excludeFn(tileE) ) continue;

      if ( this.tileCouldSupport(tile) ) return tile;
    }
    return null;
  }

  /**
   * Find supporting tile below the current elevation.
   * @param {Tile} [excludeTile]    Optional tile to exclude from search
   * @param {number} [floor]        Don't search below this value
   * @returns {Tile|null}
   */
  findSupportingTileBelow(excludeTile, floor) {
    floor ??= this.terrainElevation();
    const e = this.elevation;
    for ( const tile of this.tiles ) {
      if ( tile === excludeTile ) continue;
      if ( tile.elevationE >= e ) continue;
      if ( tile.elevationE < floor ) break;
      if ( this.tileCouldSupport(tile) ) return tile;
    }
    return null;
  }

  /**
   * Find supporting tile at elevation.
   * @returns {Tile|null}
   */
  findSupportingTileAtElevation(excludeTile) {
    const e = this.elevation;
    for ( const tile of this.tiles ) {
      if ( tile === excludeTile ) continue;
      if ( !this.tileCouldSupport(tile) ) continue;
      if ( e.almostEqual(tile.elevationE) ) return tile;
    }
    return null;
  }

}

/**
 * Function to check whether tiles should be excluded because either the tile or the coordinate elevation
 * is underground. (tile underground xor coordinate underground)
 * @param {Point3d} point
 * @returns {function}
 */
function excludeUndergroundTilesFn(coordinate, elevation) {
  // If coordinate is below ground, tiles must be below ground, and vice-versa.
  const terrainE = canvas.elevation.elevationAt(coordinate);
  return almostGreaterThan(elevation, terrainE)
    ? tileE => tileE < terrainE // Token is above ground; exclude below
    : tileE => almostGreaterThan(tileE, terrainE); // Token is below ground
}
