/* globals
canvas,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

export class TravelElevationRay {
  /** @enum {number} */
  static ELEVATION_STATE = {
    START: -1,
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

    // Because the terrain borders is the scene, this is trivial in most (all?) cases.
    setTValuesForWalk(this.terrainWalk, origin, destination);

    // Find all tiles less than or equal to the max elevation.
    // Then add in tiles that are within tile step, repeatedly.
    this.TEC.tiles.forEach(t => {
      if ( t.elevationZ <= maxTerrainElevation ) reachableTiles.add(t);
    });
    this._findTilesWithinReach(maxTerrainElevation, reachableTiles);

    // Replace the TEC tiles with this filtered set based on maximum elevation.
    this.TEC.tiles = [...reachableTiles];
    this.TEC.tiles.sort((a, b) => b.elevationE - a.elevationE);
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
    const { origin, startElevation, path, TEC } = this;
    path.length = 0;

    // At the starting point, are we dropping to terrain or a tile?
    TEC.location = origin;
    TEC.elevation = startElevation;
    const startTile = TEC.findSupportingTile();
    let currMarker = startTile
      ? this._constructTileMarkerAt(startTile, 0) : this._constructElevationMarkerAt(0);
    path.push(currMarker);
    currMarker = currMarker.next;

    // For each currMarker, is it the valid next location/elevation? If not, locate a new one and add.
    while ( currMarker.t0 < 1 ) {
      // Draw.point(terrainCache._toCanvasCoordinates(currMarker.x, currMarker.y), { radius: 1, color: Draw.COLORS.gray })

      if ( currMarker.tile ) {
        // Find a new marker b/c this one is ending (or we fell through a tile).
        const tileMarker = this._findSupportingTileMarkerAtT(
          currMarker.t0, currMarker.tile.elevationE, currMarker.tile, undefined, true);
        if ( tileMarker ) currMarker = tileMarker;

      } else if ( currMarker.prevPixel > currMarker.currPixel && !currMarker.tile ) {
        // Moving down in terrain
        // Draw.point(terrainCache._toCanvasCoordinates(currMarker.x, currMarker.y), { radius: 1, color: Draw.COLORS.green })
        // Look for tile to switch to.
        const destE = canvas.elevation._scaleNormalizedElevation(currMarker.currPixel);
        const tileMarker = this._findSupportingTileMarkerAtT(currMarker.t0, destE);
        if ( tileMarker ) currMarker = tileMarker;


      } else if ( currMarker.prevPixel < currMarker.currPixel && !currMarker.tile ) {
        // Moving up in terrain
        // Nothing to do.
      }

      currMarker = currMarker.next;
      path.push(currMarker);
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
    tileWalk.tile = tile;
    setTValuesForWalk(tileWalk, origin, destination);
    this.tileWalks.set(tile, tileWalk);
    return tileWalk;
  }

  /**
   * Construct a skeleton tile marker for when the token falls somewhere on the tile (not at a marker).
   */
  _constructTileMarkerAt(tile, t) {
    const next = this._getTileWalk(tile).markers.find(m => m.t0 > t);
    const elevation = tile.elevationE;
    return { t, elevation, tile, next };
  }

  /**
   * Construct a skeleton elevation marker for when the token falls somewhere from a tile (not at a marker).
   */
  _constructElevationMarkerAt(t, elevation) {
    if ( typeof elevation === "undefined" ) {
      this.TEC.location = this.origin.projectToward(this.destination, t);
      elevation = this.TEC.terrainElevation();
    }
    const next = this.terrainWalk.markers.find(m => m.t0 > t);
    return { t, elevation, next };
  }

  /**
   * Try to locate a supporting tile at a location.
   * @param {number} t0                 Point along ray
   * @param {Tile} [excludeTile]        Tile to exclude, if any
   * @param {boolean} [reach=false]     If true, allow tiles within reach
   * @returns {Marker|null}
   */
  _findSupportingTileMarkerAtT(t0, elevation, excludeTile, floor, reach = false) {
    const TEC = this.TEC;
    TEC.location = this.pointAtT(t0);
    TEC.elevation = elevation;
    const findAtElevation = reach ? TEC.findSupportingTileWithinReach : TEC.findSupportingTileAtElevation;
    let tile = findAtElevation(excludeTile);
    tile ??= TEC.findSupportingTileBelow(excludeTile, floor);
    if ( !tile ) return null;

    const tileWalk = this._getTileWalk(tile);
    return this._constructTileMarkerAt(tileWalk, t0);
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

/**
 * Class to track positions along the travel ray.
 */
class Marker {
  static TYPES = {
    UNDEFINED: -1,
    TERRAIN: 0,
    TILE: 1
  };

  /** @type {number} */
  currPixel = 0;

  /** @type {number|null} */
  prevPixel = null;

  /** @type {Marker} */
  next;

  /** @type {number} */
  t0;

  /** @type {PIXI.Point} */
  point = new PIXI.Point();

  /** @type {PixelCache} */
  pixelCache;

  /** @type {Marker.TYPES} */
  type;

  constructor(currPixel, prevPixel) {

  }

  static fromWalk() {

  }
}

// ----- NOTE: Helper functions ----- //

/**
 * Set t values for markers for this walk proportional to the a --> b ray.
 * @param {elevationWalk} walk
 * @param {PIXI.Point} a
 * @param {PIXI.Point} b
 * @returns {elevationWalk}
 */
function setTValuesForWalk(walk, a, b) {
  // Use intersection points to determine the t values for the walk
  const delta = b.subtract(a);
  const deltaMag = delta.magnitudeSquared();
  const dist2_0 = PIXI.Point.distanceSquaredBetween(a, walk.boundsIx[0]);
  const dist2_1 = PIXI.Point.distanceSquaredBetween(a, walk.boundsIx[1]);
  const t0 = walk.t0 = Math.sqrt(dist2_0 / deltaMag);
  const t1 = walk.t1 = Math.sqrt(dist2_1 / deltaMag);

  // Then scale the markers' tLocal values accordingly.
  const diff = t1 - t0;
  for ( const marker of walk.markers ) marker.t0 = t0 + (diff * marker.tLocal);
  return walk;
}
