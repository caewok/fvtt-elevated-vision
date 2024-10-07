/* globals
game,
foundry,
canvas,
ClipperLib,
CONFIG,
PIXI,
ui
*/
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { quotient256, mod256, log } from "./util.js";
import { getSceneSetting, setSceneSetting, Settings } from "./settings.js";
import { PixelCache } from "./geometry/PixelCache.js";
import { extractPixels } from "./perfect-vision/extract-pixels.js";
import { Draw } from "./geometry/Draw.js";


// ----- NOTE: Imported from Elevation Layer ----- //
// TODO: Can these be removed / made obsolete? What range of elevations can we have here?

/**
 * Methods originally in Elevation Layer that handle storing elevation values in texture.
 */
export class ElevationTextureHandler {

  /**
   * Container to hold the current graphics objects representing elevation.
   * These graphics objects are created when the GM modifies the scene elevation using
   * the layer tools.
   * @type {PIXI.Container}
   */
  _graphicsContainer = new PIXI.Container();


  /**
   * The elevation layer data is rendered into this texture, which is then used for
   * calculating elevation at given points.
   * @type {PIXI.RenderTexture}
   */
  _elevationTexture;

  /**
   * Maximum normalized value.
   * 256 values (8 bit) per channel; two channels currently used. Don't forget 0!
   * @type {number}
   */
  #maximumNormalizedElevation = Math.pow(256, 2) - 1;

  /**
   * The maximum allowable visibility texture size.
   * In v11, this is equal to CanvasVisibility.#MAXIMUM_VISIBILITY_TEXTURE_SIZE
   * @type {number}
   */
  static #MAXIMUM_ELEVATION_TEXTURE_SIZE = CONFIG[MODULE_ID]?.elevationTextureSize ?? 4096;

  /**
   * Has the elevation layer been initialized?
   * @type {boolean}
   */
  #initialized = false;

  get initialized() { return this.#initialized; }

  /**
   * Initialize elevation data - resetting it when switching scenes or re-drawing canvas
   */
  async initialize() {
    log("Initializing elevation layer");
    this.#initialized = false;
    this._clearElevationPixelCache();

    // Add the render texture for displaying elevation information to the GM
    const config = this._getElevationTextureConfiguration();
    this._elevationTexture = PIXI.RenderTexture.create(config);
    // Set the clear color of the render texture to black. The texture needs to be opaque.
    this._elevationTexture.baseTexture.clearColor = [0, 0, 0, 1];
    this.renderElevation();
    this.#initialized = true;

    // Update the source shadow meshes with the elevation texture.
    const sources = [
      ...canvas.effects.lightSources,
      ...canvas.tokens.placeables.map(t => t.vision).filter(v => Boolean(v))
    ];

    for ( const src of sources ) {
      const ev = src[MODULE_ID];
      if ( !ev ) continue;
      if ( ev.shadowMesh ) {
        ev.shadowMesh.shader.uniforms.uTerrainSampler = canvas.scene[MODULE_ID]._elevationTexture;
        ev.shadowRenderer.update();
      }

      if ( ev.shadowVisionLOSMesh ) {
        ev.shadowVisionLOSMesh.shader.uniforms.uTerrainSampler = canvas.scene[MODULE_ID]._elevationTexture;
        ev.shadowVisionLOSRenderer.update();
      }
    }
  }


  /**
   * Values used when rendering elevation data to a texture representing the scene canvas.
   * It may be important that width/height of the elevation texture is evenly divisible
   * by the downscaling resolution. (It is important for fog manager to prevent drift.)
   * @returns {ElevationTextureConfiguration}
   */
  _getElevationTextureConfiguration() {
    // In v11, see CanvasVisibility.prototype.#configureVisibilityTexture
    const dims = canvas.scene.dimensions;
    let width = dims.sceneWidth;
    let height = dims.sceneHeight;

    let resolution = Math.clamp(CONFIG[MODULE_ID]?.resolution ?? 0.25, .01, 1);
    const maxSize = Math.min(
      this.constructor.#MAXIMUM_ELEVATION_TEXTURE_SIZE,
      resolution * Math.max(width, height));

    if ( width >= height ) {
      resolution = maxSize / width;
      height = Math.ceil(height * resolution) / resolution;
    } else {
      resolution = maxSize / height;
      width = Math.ceil(width * resolution) / resolution;
    }

    return {
      resolution,
      width,
      height,
      mipmap: PIXI.MIPMAP_MODES.OFF,
      scaleMode: PIXI.SCALE_MODES.NEAREST,
      multisample: PIXI.MSAA_QUALITY.NONE,
      format: PIXI.FORMATS.RG, // 256 * 256 = 65,536 elevation increments in total.
      type: PIXI.TYPES.UNSIGNED_BYTE
    };
  }

  /* ------------------------ */

  /**
   * Increment between elevation measurements. Should be a positive integer or float of 1 decimal place.
   * @type {number}
   */
  get elevationStep() {
    const step = getSceneSetting(Settings.KEYS.ELEVATION_INCREMENT);
    return step ?? canvas.scene.dimensions.distance;
  }

  set elevationStep(stepNew) {
    if ( stepNew < 0.1 ) {
      console.warn("elevationStep should be a positive integer or float, to be rounded to 1 decimal place.");
      return;
    }

    stepNew = Number.isInteger(stepNew) ? stepNew : Math.round((stepNew * 10)) / 10;

    // Function to set the new normalized elevation value such that elevation stays (mostly) the same.
    // e = min + value * step.
    // min + value * step = min + valueNew * stepNew
    // valueNew * stepNew = min + value * step - min
    // valueNew = value * step / stepNew
    const step = this.elevationStep;
    const mult = step / stepNew;
    const max = this.#maximumNormalizedElevation;
    const stepAdjust = function(normE) {
      const out = Math.clamp(Math.round(mult * normE), 0, max);
      return out || 0;
    };

    setSceneSetting(Settings.KEYS.ELEVATION_INCREMENT, stepNew);
    this.changePixelValuesUsingFunction(stepAdjust);
  }

  /* ------------------------ */

  /**
   * Minimum elevation value for a scene.
   * @type {number}
   */
  get elevationMin() {
    const min = getSceneSetting(Settings.KEYS.ELEVATION_MINIMUM);
    return min ?? 0;
  }

  set elevationMin(minNew) {
    minNew = Math.floor(minNew);
    const min = this.elevationMin;
    const step = this.elevationStep;
    minNew = Math.round(minNew / step) * step;
    if ( min === minNew ) return;

    // Function to set the new pixel value such that elevation stays the same.
    // e = min + value * step.
    // min + value * step = minNew + valueNew * step
    // valueNew * step = min + value * step - minNew
    // valueNew = (min - minNew + value * step) / step
    // valueNew = min / step - minNew / step  + value

    const stepInv = 1 / step;
    const adder = (min * stepInv) - (minNew * stepInv);

    const minAdjust = function(pixel) {
      const out = Math.clamp(Math.round(adder + pixel), 0, 255);
      return out || 0; // In case of NaN, etc.
    };

    setSceneSetting(Settings.KEYS.ELEVATION_MINIMUM, minNew);
    this.changePixelValuesUsingFunction(minAdjust);
  }

  /* ------------------------ */

  /**
   * Calculated maximum elevation value for the scene.
   * @type {number}
   */
  get elevationMax() {
    return this._scaleNormalizedElevation(this.#maximumNormalizedElevation);
  }


  /* ------------------------ */

  /**
   * Convert a pixel value to an elevation value.
   * @param {object} value    Pixel value
   * @returns {number}
   */
  pixelChannelsToElevation(r, g = 0) {
    const value = this._decodeElevationChannels(r, g);
    return this._scaleNormalizedElevation(value);
  }

  /**
   * Convert a pixel value to an elevation value.
   * @param {number} r    Pixel value
   * @returns {number}
   * @deprecated since v0.5.1.
   */
  pixelValueToElevation(r) {
    console.log("pixelValueToElevation is deprecated since Elevated Vision v0.5.1. Please use pixelChannelsToElevation instead.");
    return this.pixelChannelsToElevation(r);
  }

  /**
   * Convert an elevation value to a pixel value between 0 and 255
   * @param {number} value    Elevation
   * @returns {object}
   *   - {number} r   Red channel, integer between 0 and 255
   *   - {number} g   Green channel, integer between 0 and 255
   *   - {number} b   Blue channel, currently unused
   */
  elevationToPixelChannels(elevation) {
    elevation = this.clampElevation(elevation);
    const norm = this._normalizeElevation(elevation);
    return this._encodeElevationChannels(norm);
  }

  /**
   * Convert an elevation value to a pixel value between 0 and 255
   * @param {number} value    Elevation
   * @returns {number}
   * @deprecated since v0.5.1.
   */
  elevationToPixelValue(elevation) {
    console.warn("elevationToPixelValue no longer available since Elevated Vision v0.5.1. Please use elevationToPixelChannels instead.");
    elevation = this.clampElevation(elevation);
    return (elevation - this.elevationMin) / this.elevationStep;
  }

  /**
   * Normalize elevation value for encoding in texture.
   * @param {number} e    Elevation value in grid units
   * @returns {number} Integer between 0 and 65,536
   */
  _normalizeElevation(e) {
    return (e - this.elevationMin) / this.elevationStep;
  }

  /**
   * Scale an integer to the scene elevation.
   * @param {number} value    Integer between 0 and 65,536
   * @returns {number} Elevation value, in grid units
   */
  _scaleNormalizedElevation(value) {
    return this.elevationMin + (Math.round(value * this.elevationStep * 10) / 10);
  }

  /**
   * Given red and green 8-bit channels of a color,
   * return an integer value.
   * @param {number} r    Red channel value, between 0 and 255.
   * @param {number} g    Green channel value, between 0 and 255.
   * @returns {number} Number between 0 and 65,536. (256 * 256).
   */
  _decodeElevationChannels(r, g) { return (g * 256) + r; }

  /**
   * Given a number representing normalized elevation, returns its encoded color channels.
   * @param {number} e    Normalized elevation integer between 0 and 65,536.
   * @returns {object}
   *   - {number} r   Red channel, integer between 0 and 255
   *   - {number} g   Green channel, integer between 0 and 255
   *   - {number} b   Blue channel, currently unused
   */
  _encodeElevationChannels(e) { return { r: mod256(e), g: quotient256(e), b: 0 }; }

  /**
   * Convert value such as elevation from grid units to x,y coordinate dimensions.
   * @param {number} elevation
   * @returns {number} Elevation in grid units.
   */
  gridUnitsToCoordinates(value) {
    const { distance, size } = canvas.scene.grid;
    return (value * size) / distance;
  }

  /**
   * Convert a value such as elevation x,y coordinate dimensions to grid units.
   * @param {number} gridUnit
   * @returns {number} Elevation
   */
  coordinatesToGridUnits(value) {
    const { distance, size } = canvas.scene.dimensions;
    return (value * distance) / size;
  }

  /**
   * Color used to store this elevation value.
   * @param {number} elevation  Proposed elevation value. May be corrected by clampElevation.
   * @return {PIXI.Color}
   */
  elevationColor(elevation) {
    const channels = this.elevationToPixelChannels(elevation);
    log(`elevationHex elevation ${elevation}, rgb ${channels.r},${channels.g},${channels.b}`);
    return new PIXI.Color(channels);
  }

  /**
   * Ensure the elevation value is an integer that matches the specified step,
   * and is between the min and max elevation values.
   * Required so that translation to an integer-based color texture works.
   * @param {number} e  Proposed elevation value
   * @return {number}   The elevation value between elevationMin and elevationMax.
   */
  clampElevation(e) {
    e = isNaN(e) ? 0 : e;
    e = Math.round(e / this.elevationStep) * this.elevationStep;
    return Math.clamp(e, this.elevationMin, this.elevationMax);
  }

  /* -------------------------------------------- */


  /**
   * Update minimum elevation for the scene based on the Levels minimum tile elevation.
   */
  _updateMinimumElevationFromSceneTiles() {
    const tiles = canvas.tiles.placeables.filter(tile => tile.document.overhead);
    const currMin = this.elevationMin;
    let min = currMin;
    for ( const tile of tiles ) min = Math.min(min, tile.elevationE);

    if ( min < currMin ) {
      this.elevationMin = min;
      ui.notifications.notify(`Elevated Vision: Scene elevation minimum set to ${this.elevationMin} based on the minimum elevation of one or more tiles in the scene.`);
    }
  }

  /* -------------------------------------------- */
  /* NOTE: ELEVATION PIXEL DATA */

  /** @type {PixelFrame} */
  #elevationPixelCache;

  get elevationPixelCache() {
    return this.#elevationPixelCache ?? (this.#elevationPixelCache = this.#refreshElevationPixelCache());
  }

  /**
   * Refresh the pixel array cache from the elevation texture.
   */
  #refreshElevationPixelCache() {
    const { sceneX: x, sceneY: y } = canvas.dimensions;
    return PixelCache.fromTexture(
      this._elevationTexture,
      { x, y, arrayClass: Uint16Array, combineFn: this._decodeElevationChannels });
  }

  /**
   * Clear the pixel cache
   */
  _clearElevationPixelCache() {
    this.#elevationPixelCache = undefined;
  }

  /* -------------------------------------------- */
  /* NOTE: ELEVATION VALUES */

  /**
   * Retrieve the elevation at a single canvas location.
   * @param {Point} {x, y}    Canvas coordinates
   * @returns {number} Elevation value.
   */
  elevationAt({x, y}) {
    const value = this.elevationPixelCache.pixelAtCanvas(x, y);
    return this._scaleNormalizedElevation(value);
  }

  /**
   * Calculate the average value of pixels within a given shape.
   * For rectangles, averageValue will be faster.
   * @param {PIXI.Circle|PIXI.Polygon|PIXI.Rectangle|PIXI.Ellipse} shape
   * @returns {number} Average of pixel values within the shape
   */
  averageElevationWithinShape(shape) {
    const skip = CONFIG[MODULE_ID]?.averageTerrain ?? 1;
    const average = this.elevationPixelCache.average(shape, skip);
    return this._scaleNormalizedElevation(average);
  }

  /**
   * Calculate the average elevation for a grid space.
   * @param {number} row    Grid row
   * @param {number} col    Grid column
   * @param {object} [options]  Options that affect the calculation
   * @param {boolean} [options.useHex]  Use a hex-shaped grid for the calculation.
   *   Defaults to true if the canvas grid is hex.
   * @returns {number} Elevation value.
   */
  averageElevationForGridSpace(row, col, { useHex = canvas.grid.isHexagonal } = {}) {
    const {x, y} = canvas.grid.getTopLeftPoint(col * canvas.grid.size, row * canvas.grid.size);
    return this.averageElevationAtGridPoint(x, y, { useHex });
  }

  /**
   * Retrieve the average elevation of the grid space that encloses these
   * coordinates.
   * @param {Point} pt
   * @returns {number} Elevation value.
   */
  averageElevationAtGridPoint(pt, { useHex = canvas.grid.isHexagonal } = {}) {
    const shape = useHex ? this._hexGridShape(pt) : this._squareGridShape(pt);
    return this.averageElevationWithinShape(shape);
  }

  /* -------------------------------------------- */
  /* NOTE: CHANGE ELEVATION VALUES */

  /**
   * Apply a function to every pixel.
   * @param {function} fn   Function to use.
   *   It should take a single normalized elevation value and return a different normalized value.
   */
  changePixelValuesUsingFunction(fn) {
    this.renderElevation(); // Just in case

    // Because we just re-rendered the elevation, it would be pointless to use the cache.
    const sceneRect = canvas.dimensions.sceneRect;
    const { pixels, width, height } = this._extractFromElevationTexture(sceneRect);
    const ln = pixels.length;
    for ( let i = 0; i < ln; i += 4 ) {
      const currNormE = this._decodeElevationChannels(pixels[i], pixels[i + 1]);
      const newNormE = fn(currNormE);
      const newPixelChannels = this._encodeElevationChannels(newNormE);
      pixels[i] = newPixelChannels.r;
      pixels[i + 1] = newPixelChannels.g;
    }
  }

  /**
   * Change elevation of every pixel that currently is set to X value.
   * Faster than changePixelValuesUsingFunction.
   * @param {number} from   Pixels with this elevation will be changed.
   * @param {number} to     Selected pixels will be changed to this elevation.
   */
  changePixelElevationValues(from, to) {
    if ( from < this.elevationMin || from > this.elevationMax ) {
      console.error(`changePixelElevationValues from value must be between ${this.elevationMin} and ${this.elevationMax}`);
      return;
    }

    if ( to < this.elevationMin || to > this.elevationMax ) {
      console.error(`changePixelElevationValues to value must be between ${this.elevationMin} and ${this.elevationMax}`);
      return;
    }

    from = this.clampElevation(from);
    to = this.clampElevation(to);

    const fromPixelChannels = this.elevationToPixelChannels(from);
    const toPixelChannels = this.elevationToPixelChannels(to);

    this.renderElevation(); // Just in case

    // Extract pixels from the renderTexture (combined graphics + underlying sprite)
    const sceneRect = canvas.dimensions.sceneRect;
    const { pixels, width, height } = this._extractFromElevationTexture(sceneRect);

    const ln = pixels.length;
    for ( let i = 0; i < ln; i += 4 ) {
      if ( pixels[i] === fromPixelChannels.r && pixels[i + 1] === fromPixelChannels.g ) {
        pixels[i] = toPixelChannels.r;
        pixels[i + 1] = toPixelChannels.g;
      }
    }
  }

  /**
   * Set the elevation for the grid space that contains the point.
   * If this is a hex grid, it will fill in the hex grid space.
   * @param {Point} p             Point within the grid square/hex.
   * @param {number} [elevation=0]          The elevation used to fill the space, in grid units.
   * @param {object}  [opts]   Options passed to setElevationForShape
   * @param {boolean} [options.useHex]      If true, use a hex grid; if false use square.
   *   Defaults to canvas.grid.isHexagonal.
   *
   * @returns {PIXI.Graphics} The child graphics added to the _graphicsContainer
   */
  setElevationForGridSpace(p, elevation = 0, { useHex = canvas.grid.isHexagonal, ...opts } = {}) {
    const shape = useHex ? this._hexGridShape(p) : this._squareGridShape(p);
    return this.setElevationForShape(shape, elevation, opts);
  }


  /**
   * Set elevation for a circle centered at the provided location.
   * @param {PolygonVertex} p
   * @param {number} [elevation]          The elevation, in grid units.
   * @param {object}  [opts]   Options passed to setElevationForShape
   */
  setElevationForCircle(p, elevation, opts) {
    const shape = this._circleShape(p);
    return this.setElevationForShape(shape, elevation, opts);
  }

  /**
   * Set elevation for a given PIXI shape.
   * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Ellipse|PIXI.Polygon} shape
   * @param {number} [elevation=0]          The elevation use to fill the grid space, in grid units.
   * @param {object}  [opts]   Options passed to _setElevationForGraphics.
   */
  setElevationForShape(shape, elevation, opts) {
    const graphics = new PIXI.Graphics();

    // Set width = 0 to avoid drawing a border line. The border line will use antialiasing
    // and that causes a lighter-color border to appear outside the shape.
    const draw = new Draw(graphics);
    draw.shape(shape, { width: 0, fill: this.elevationColor(elevation) });
    return this._setElevationForGraphics(graphics, elevation, opts);
  }

  /**
   * Set elevation for a given PIXI graphics, in which shapes are already drawn.
   * @param {PIXI.Graphics} graphics
   * @param {number} [elevation=0]          The elevation use to fill the grid space, in grid units.
   * @param {object}  [opts]
   * @param {boolean} [opts.temporary]      If true, don't immediately require a save.
   *   This does not prevent a save if the user further modifies the canvas.
   */
  _setElevationForGraphics(graphics, elevation = 0, { temporary = false } = {}) {
    this._graphicsContainer.addChild(graphics);
    const color = this.elevationColor(elevation);

    // Set width = 0 to avoid drawing a border line. The border line will use antialiasing
    // and that causes a lighter-color border to appear outside the shape.
    this.renderElevation();
    return graphics;
  }

  /* -------------------------------------------- */
  /* NOTE: TOKEN SHAPES */

  _tokenShape(tokenTLCorner, width, height) {
    // For the moment, uneven width/height shapes must use rectangle border
    if ( canvas.grid.isHexagonal && width === height ) return this._hexGridShape(tokenTLCorner, { width, height });
    return new PIXI.Rectangle(tokenTLCorner.x, tokenTLCorner.y, width, height);
  }

  _squareGridShape(p) {
    // Get the top left corner
    const tl = canvas.grid.getTopLeftPoint(p);
    const { sizeX, sizeY } = canvas.grid;
    return new PIXI.Rectangle(tl.x, tl.y, sizeX, sizeY);
  }

  _hexGridShape(p, { width = 1, height = 1 } = {}) {
    // Canvas.grid.grid.getBorderPolygon will return null if width !== height.
    if ( width !== height ) return null;

    // Get the top left corner
    const tl = canvas.grid.getTopLeftPoint(p);
    const points = canvas.grid.grid.getBorderPolygon(width, height, 0); // TO-DO: Should a border be included to improve calc?
    const pointsTranslated = [];
    const ln = points.length;
    for ( let i = 0; i < ln; i += 2) {
      pointsTranslated.push(points[i] + tl.x, points[i+1] + tl.y);
    }

    return new PIXI.Polygon(pointsTranslated);
  }

  /**
   * Remove all elevation data from the scene.
   */
  async clearElevationData() {
    this._clearElevationPixelCache();

    this._graphicsContainer.destroy({children: true});
    this._graphicsContainer = new PIXI.Container();

    await canvas.scene.unsetFlag(MODULE_ID, FLAGS.ELEVATION_IMAGE);
    this.renderElevation();
  }

  /** @type {boolean} */
  #destroyed = false;

  get destroyed() { return this.#destroyed; }

  /**
   * Destroy elevation data when changing scenes or clearing data.
   */
  destroy() {
    if ( this.#destroyed ) return;
    this._clearElevationPixelCache();
    this._graphicsContainer.destroy({children: true});
    this._elevationTexture?.destroy();
    this.#destroyed = true;
  }

  /**
   * (Re)render the graphics stored in the container.
   */
  renderElevation() {
    const dims = canvas.dimensions;
    const transform = new PIXI.Matrix(1, 0, 0, 1, -dims.sceneX, -dims.sceneY);
    canvas.app.renderer.render(this._graphicsContainer, { renderTexture: this._elevationTexture, transform });

    // Destroy the cache
    this._clearElevationPixelCache();
  }

}
