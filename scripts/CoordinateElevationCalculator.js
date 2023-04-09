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
   */

  /** @type {PointElevationOptions} */
  options = {};

  /** @type {Point3d} */
  #point;

  /** @type {Tile[]} */
  #tiles;

  constructor(point, opts = {}) {
    this.#point = new Point3d(point.x, point.y, point.z);
    if ( opts.elevation ) this.elevation = opts.elevation;
    this._configure(opts);
  }

  /**
   * Options that affect elevation calculations.
   * @param {object} [opts]   Optional object of option overrides.
   */
  _configure(opts = {}) {
    opts.alphaThreshold ??= CONFIG[MODULE_ID]?.alphaThreshold ?? 0.75;
    opts.tileStep ??= CONFIG[MODULE_ID]?.tileStep ?? 1;
    opts.terrainStep ??= CONFIG[MODULE_ID]?.terrainStep ?? canvas.elevation.elevationStep;
    this.options = opts;
  }

  get bounds() {
    return new PIXI.Rectangle(this.#point.x - 1, this.#point.y - 1, 2, 2);
  }

  get coordinate() {
    return this.#point.clone();
  }

  set coordinate(point) {
    this.#point = new Point3d(point.x, point.y, point.z);
    this._refreshLocation();
    this._refreshElevation();
  }

  get location() {
    return new PIXI.Point(this.#point.x, this.#point.y);
  }

  set location(value) {
    this.#point.x = value.x;
    this.#point.y = value.y;
  }

  get elevation() {
    return CONFIG.GeometryLib.utils.pixelsToGridUnits(this.#point.z);
  }

  set elevation(e) {
    this.#point.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(e);
    this._refreshElevation();
  }

  get elevationZ() {
    return this.#point.z;
  }

  set elevationZ(value) {
    this.#point.z = value;
    this.refreshElevation();
  }

  _refreshLocation() {
    this.#tiles = undefined;
  }

  _refreshElevation() {
    // Empty
  }

  get tiles() {
    return this.#tiles ?? (this.#tiles = CoordinateElevationCalculator.locateTiles(this.bounds));
  }

  set tiles(value) {
    this.#tiles = value;
  }

  static options(opts = {}) {
    opts.alphaThreshold ??= CONFIG[MODULE_ID]?.alphaThreshold ?? 0.75;
  }

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
    const matchingTile = this.findSupportingTile();
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
    if ( !tile ) return Boolean(this.findTileAtElevation());
    const tileE = tile.elevationE;
    if ( !this.elevation.almostEqual(tileE) ) return false;
    return tileOpaqueAt(tile, this.#point, this.options.alphaThreshold);
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
  tileCouldSupport(tile) {
    return tileOpaqueAt(tile, this.#point, this.options.alphaThreshold);
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
    return almostBetween(this.elevation, tileE, tileE + this.options.tileStep);
  }

  /*
   * Terrain is within a permitted step from provided elevation.
   * @param {number} terrainE     Tile to test
   * @returns {boolean}
   */
  terrainWithinStep(terrainE) {
    return almostBetween(this.elevation, terrainE, terrainE + this.options.terrainStep);
  }

  /**
   * Find highest tile at this location.
   * Only counts if the point is directly above the opaque portions of the tile.
   * @returns {Tile|null}
   */
  findHighestTile() {
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
   * Find the supporting tile for the coordinate, if any.
   * Tile is below the coordinate and would support the coordinate (w/in tile step)
   * @returns {Tile|null}
   */
  findSupportingTile() {
    const excludeFn = excludeUndergroundTilesFn(this.#point, this.elevation);
    for ( const tile of this.tiles ) {
      const tileE = tile.elevationE;
      if ( excludeFn(tileE) ) continue;
      if ( this.tileSupports(tile) ) return tile;
    }
    return null;
  }
}

/**
 * Determine the percentage of which the tile + terrain covers a token shape.
 * Tile opaqueness depends on the alphaThreshold and whether measuring the point or the average.
 * Token would fall through if tile is transparent unless terrain would fill the gap(s).
 * @param {Tile} tile                                 Tile to test
 * @param {Point} tokenCenter                         Center point
 * @param {number} averageTiles                       Positive integer to skip pixels when averaging.
 *                                                    0 if point-based.
 * @param {number} alphaThreshold                     Threshold to determine transparency
 * @param {PIXI.Rectangle|PIXI.Polygon} [tokenShape]  Shape representing a token boundary
 *                                                    Required if not averaging
 * @returns {boolean}
 */
export function tileOpaqueAt(tile, tokenCenter, alphaThreshold) {
  const cache = tile._evPixelCache;
  if ( !cache ) return false;
  return cache.containsPixel(tokenCenter.x, tokenCenter.y, alphaThreshold);
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
