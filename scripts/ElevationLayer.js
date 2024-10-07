/* globals
canvas,
CONFIG,
Dialog,
document,
foundry,
FullCanvasObjectMixin,
game,
InteractionLayer,
isEmpty,
mergeObject,
PIXI,
PolygonVertex,
PreciseText,
Ray,
renderTemplate,
saveDataToFile,
ui,
*/
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { PixelCache } from "./geometry/PixelCache.js";
import {
  log,
  readDataURLFromFile,
  convertBase64ToImage,
  drawPolygonWithHoles,
  quotient256,
  mod256 } from "./util.js";
import { testWallsForIntersections } from "./ClockwiseSweepPolygon.js";
import { SCENE_GRAPH } from "./WallTracer.js";
import { setSceneSetting, getSceneSetting, Settings } from "./settings.js";
import { ElevationTextureManager } from "./ElevationTextureManager.js";

import { Draw } from "./geometry/Draw.js";

import { ElevationLayerShader } from "./glsl/ElevationLayerShader.js";
import { EVQuadMesh } from "./glsl/EVQuadMesh.js";

import "./perfect-vision/extract-async.js";

/* Elevation layer

Allow the user to "paint" areas with different elevations. This elevation data will then
be used by the light shader (and eventually the vision shader) to identify areas that
are not in shadow. For example, a mesa at 30' elevation should cast a shadow but should
not cast a shadow on itself.
  _____ <- no shadow
 /     \
/       \--- <- shadow area

Set elevation in grid increments. Maximum 265; use texture (sprite?) to store.

Anticipated UI:

Controls:
- Current elevation for painting. Scroll wheel to increment / decrement
- Tool to fill by grid square
- Tool to fill all space contained between walls
- Tool to fill by pixel. Resize and choose shape: grid square, hex, circle. Reset size to grid size.
- Reset
- Undo

On canvas:
- hover to see the current elevation value
- Elevation indicated as shaded color going from red (low) to blue (high)
- Solid lines representing walls of different heights. Near white for infinite.
*/

// TODO: What should replace this now that FullCanvasContainer is deprecated in v11?
class FullCanvasContainer extends FullCanvasObjectMixin(PIXI.Container) {

}

export class ElevationLayer extends InteractionLayer {
  constructor() {
    super();
    this.controls = ui.controls.controls.find(obj => obj.name === "elevation");
  }

  /**
   * Container to hold objects to display wall information on the canvas
   */
  _wallDataContainer = new PIXI.Container();

  /**
   * Sprite that contains the elevation values from the saved elevation file.
   * This is added to the _graphicsContainer, along with any graphics representing
   * adjustments by the GM to the scene elevation.
   * @type {PIXI.Sprite}
   */
  _backgroundElevation = PIXI.Sprite.from(PIXI.Texture.EMPTY);

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
   * PIXI.Mesh used to display the elevation colors when the layer is active.
   * @type {ElevationLayerShader}
   */
  _elevationColorsMesh;

  /**
   * Container representing the canvas
   * @type {FullCanvasContainer}
   */
  container;

  /**
   * This is the z-order replacement in v10. Not elevation for the terrain!
   * @type {number}
   */
  #elevation = 9000;

  /**
   * Maximum normalized value.
   * 256 values (8 bit) per channel; two channels currently used. Don't forget 0!
   * @type {number}
   */
  #maximumNormalizedElevation = Math.pow(256, 2) - 1;

  /**
   * Flag for when the elevation data has changed for the scene, requiring a save.
   * Currently happens when the user changes the data or uploads a new data file.
   * @type {boolean}
   */
  _requiresSave = false; // Avoid private field here b/c it causes problems for arrow functions

  /** @type {ElevationTextureManager} */
  _textureManager = new ElevationTextureManager();

  /* ------------------------ */

  /**
   * Value used by Foundry for sorting display of the layer. *NOT* related to elevation data.
   * @type {number}
   */
  get elevation() {
    return this.#elevation;
  }

  set elevation(value) {
    this.#elevation = value;
    canvas.primary.sortChildren();
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

  /**
   * Current maximum elevation value for the scene.
   * @type {number}
   */
  #elevationCurrentMax;

  get elevationCurrentMax() {
    return this.#elevationCurrentMax ?? (this.#elevationCurrentMax = this._calculateElevationCurrentMax());
  }

  /**
   * Calculate the current maximum elevation value in the scene.
   * @returns {number}
   */
  _calculateElevationCurrentMax() {
    // Reduce is slow, so do this the hard way.
    let max = Number.NEGATIVE_INFINITY;
    const pix = this.elevationPixelCache.pixels;
    const ln = pix.length;
    for ( let i = 0; i < ln; i += 1 ) max = Math.max(max, pix[i]);
    return this._scaleNormalizedElevation(max);
  }

  /**
   * Update the current elevation maximum to a specific value.
   * @param {number} e    Elevation value
   */
  _updateElevationCurrentMax(e) {
    this.#elevationCurrentMax = Math.max(this.#elevationCurrentMax, e);
    this._elevationColorsMesh.shader.updateMaxCurrentElevation();
  }

  /* ------------------------ */

  /**
   * Stores graphics created when dragging using the fill-by-grid control.
   * @param {Map<PIXI.Graphics>}
   */
  #temporaryGraphics = new Map();

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

  /** @override */
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "Elevation"
    });
  }

  /** @override */
  _activate() {
    log("Activating Elevation Layer.");

    // Draw walls
    for ( const wall of canvas.walls.placeables ) {
      this._drawWallSegment(wall);
      this._drawWallRange(wall);
    }

    this.drawElevation();
    this.container.visible = true;
    canvas.stage.addChild(this._wallDataContainer);
  }

  /** @override */
  _deactivate() {
    log("De-activating Elevation Layer.");
    if ( !this.container ) return;
    canvas.stage.removeChild(this._wallDataContainer);

    this.eraseElevation();

    // TO-DO: keep the wall graphics and labels and just update as necessary.
    // Destroy only in tearDown
    const wallData = this._wallDataContainer.removeChildren();
    wallData.forEach(d => d.destroy(true));

    if ( this._requiresSave ) this.saveSceneElevationData();
    Draw.clearDrawings();
    this.container.visible = false;
  }

  /** @override */
  async _draw(options) {
  // Not needed?
  // if ( canvas.elevation.active ) this.drawElevation();
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _tearDown(options) {
    log("_tearDown Elevation Layer");
    if ( this._requiresSave ) await this.saveSceneElevationData();

    // Probably need to figure out how to destroy and/or remove these objects
    //     this._graphicsContainer.destroy({children: true});
    //     this._graphicsContainer = null;
    this.#destroy();
    this.container = null;
    return super._tearDown(options);
  }

  /* -------------------------------------------- */

  /**
   * Has the elevation layer been initialized?
   * @type {boolean}
   */
  _initialized = false;

  /**
   * Initialize elevation data - resetting it when switching scenes or re-drawing canvas
   */
  async initialize() {
    log("Initializing elevation layer");

    this._initialized = false;
    this._clearElevationPixelCache();

    // Initialize the texture manager for the scene.
    const sceneEVData = canvas.scene.getFlag(MODULE_ID, FLAGS.ELEVATION_IMAGE);
    const fileURL = sceneEVData?.imageURL ?? undefined;
    await this._textureManager.initialize({ fileURL });

    // Initialize container to hold the elevation data and GM modifications
    const w = new FullCanvasContainer();
    this.container = this.addChild(w);

    // Background elevation sprite should start at the upper left scene corner
    const { sceneX, sceneY } = canvas.dimensions;
    this._backgroundElevation.position = { x: sceneX, y: sceneY };

    // Add the render texture for displaying elevation information to the GM
    this._elevationTexture = PIXI.RenderTexture.create(this._textureManager.textureConfiguration);
    // Set the clear color of the render texture to black. The texture needs to be opaque.
    this._elevationTexture.baseTexture.clearColor = [0, 0, 0, 1];

    // Add the sprite that holds the default background elevation settings
    this._graphicsContainer.addChild(this._backgroundElevation);


    await this.loadSceneElevationData();

    // Add the elevation color mesh
    const shader = ElevationLayerShader.create();
    this._elevationColorsMesh = new EVQuadMesh(canvas.dimensions.sceneRect, shader);

    this.renderElevation();

    this._initialized = true;

    // Update the source shadow meshes with the elevation texture.
    const sources = [
      ...canvas.effects.lightSources,
      ...canvas.tokens.placeables.map(t => t.vision).filter(v => Boolean(v))
    ];

    for ( const src of sources ) {
      const ev = src[MODULE_ID];
      if ( !ev ) continue;
      if ( ev.shadowMesh ) {
        ev.shadowMesh.shader.uniforms.uTerrainSampler = canvas.elevation._elevationTexture;
        ev.shadowRenderer.update();
      }

      if ( ev.shadowVisionLOSMesh ) {
        ev.shadowVisionLOSMesh.shader.uniforms.uTerrainSampler = canvas.elevation._elevationTexture;
        ev.shadowVisionLOSRenderer.update();
      }
    }
  }

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

  /**
   * Load the elevation data from the stored image.
   */
  async loadSceneElevationData() {
    log("loadSceneElevationData");

    const elevationImage = canvas.scene.getFlag(MODULE_ID, FLAGS.ELEVATION_IMAGE);
    if ( !elevationImage ) return;

    if ( foundry.utils.isEmpty(elevationImage) || foundry.utils.isEmpty(elevationImage.imageURL) ) {
      canvas.scene.unsetFlag(MODULE_ID, FLAGS.ELEVATION_IMAGE);
      return;
    }

    const texture = await this._textureManager.load();
    if ( !texture || !texture.valid ) {
      const msg = `ElevatedVision|importFromImageFile failed to import expected elevation data from ${elevationImage.imageURL}. Using empty data file instead.`;
      ui.notifications.warn(msg);
      console.warn(msg, elevationImage);
      canvas.scene.unsetFlag(MODULE_ID, FLAGS.ELEVATION_IMAGE);
      this._textureManager.initialize();
      return;
    }

    // We are loading a saved file, so we only want to require a save if the scene
    // elevation has already been modified.
    const neededSave = this._requiresSave;
    this.#replaceBackgroundElevationTexture(texture);
    this._requiresSave = neededSave;
  }

  /**
   * Store the elevation data for the scene.
   * Stores the elevation image to the world folder and stores metadata to the scene flag.
   */
  async saveSceneElevationData() {
    const res = await this._textureManager.save(this._elevationTexture);
    if ( res.status !== "success" ) {
      ui.notifications.error("There was an error saving the elevation texture for the scene. Check the console for details.");
      console.error(res);
      return;
    }

    const saveObj = {
      format: "image/webp",
      imageURL: res.path,
      width: this._elevationTexture.width,
      height: this._elevationTexture.height,
      resolution: this._elevationTexture.resolution,
      timestamp: Date.now(),
      version: game.modules.get(MODULE_ID).version };

    await canvas.scene.setFlag(MODULE_ID, FLAGS.ELEVATION_IMAGE, saveObj);
    this._requiresSave = false;
  }

  /**
   * Import elevation data as png. Same format as download.
   * See importFromJSONDialog in Foundry.
   * @returns {Promise<void>}
   */
  async importDialog() {
    new Dialog({
      title: `Import Elevation Data: ${canvas.scene.name}`,
      content: await renderTemplate("templates/apps/import-data.html", {
        hint1: game.i18n.format("Elevation.ImportDataHint1", {document: "PNG or webp"}),
        hint2: game.i18n.format("Elevation.ImportDataHint2", {name: canvas.scene.name})
      }),
      buttons: {
        import: {
          icon: '<i class="fas fa-file-import"></i>',
          label: "Import",
          callback: html => {
            const form = html.find("form")[0];
            if ( !form.data.files.length ) return ui.notifications.error("You did not upload a data file!");
            log("import", form.data.files);
            readDataURLFromFile(form.data.files[0]).then(dataURL => this.importFromImageFile(dataURL));
          }
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      default: "import"
    }, {
      width: 400
    }).render(true);
  }

  /**
   * Import elevation data from the provided image file location into the scene.
   * @param {File} file
   */
  async importFromImageFile(file) {
    const texture = await this._textureManager.loadFromFile(file);
    if ( !texture || !texture.valid ) {
      const msg = `ElevatedVision|importFromImageFile failed to import ${file.name}.`;
      ui.notifications.error(msg);
      console.error(msg, file);
    }

    log(`Loaded texture with dim ${texture.width},${texture.height}`, texture);
    this.#replaceBackgroundElevationTexture(texture);
  }

  /**
   * Replace the background elevation texture with a new one.
   * Used by loadSceneElevationData and importFromImageFile.
   * @param {PIXI.Texture} texture
   */
  #replaceBackgroundElevationTexture(texture) {
    canvas.elevation._backgroundElevation.texture.destroy();
    canvas.elevation._backgroundElevation.texture = texture;
    canvas.elevation.renderElevation();
    canvas.elevation._requiresSave = true;
  }


  /**
   * Download the elevation data as an image file.
   * @param {object} [opts]  Options that affect how the image file is formatted.
   * @param {string} [opts.format]    Image format, e.g. "image/jpeg" or "image/webp"
   * @param {string} [opts.fileName]  Name of the file. Extension will be added based on format
   * @param {number} [opts.quality]   Value that affects some image types, such as jpeg
   */
  async downloadElevationData({ format = "image/png", fileName = canvas.scene.name, quality } = {}) {
    const imageExtension = format.split("/")[1];
    fileName += `.${imageExtension}`;

    const image64 = await this._textureManager.convertTextureToImage(this._elevationTexture, { type: format, quality });
    saveDataToFile(convertBase64ToImage(image64), format, fileName);
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

    // Reset the elevation maximum, b/c we don't know this value anymore.
    this.#elevationCurrentMax = undefined;

    // This makes vertical lines: newTex = PIXI.Texture.fromBuffer(pixels, width, height)
    const br = new PIXI.BufferResource(pixels, {width, height});
    const bt = new PIXI.BaseTexture(br);
    const newTex = new PIXI.Texture(bt);

    // Save to the background texture (used by the background sprite, like with saved images)
    this.#replaceBackgroundElevationTexture(newTex);
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

    // Update the elevation maximum.
    if ( this.#elevationCurrentMax === from ) this.#elevationCurrentMax = undefined;
    else this._updateElevationCurrentMax(to);

    // Error Makes vertical lines:
    // newTex = PIXI.Texture.fromBuffer(pixels, width, height)
    const br = new PIXI.BufferResource(pixels, {width, height});
    const bt = new PIXI.BaseTexture(br);
    const newTex = new PIXI.Texture(bt);

    // Save to the background texture (used by the background sprite, like with saved images)
    this.#replaceBackgroundElevationTexture(newTex);

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
    this._updateElevationCurrentMax(elevation);

    // Set width = 0 to avoid drawing a border line. The border line will use antialiasing
    // and that causes a lighter-color border to appear outside the shape.
    this.renderElevation();
    this._requiresSave = !temporary;
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

  /* -------------------------------------------- */
  /* NOTE: FILLING ELEVATION ON CANVAS */

  /**
   * Construct a LOS polygon from this point and fill with the provided elevation.
   * @param {Point} origin        Point where viewer is assumed to be.
   * @param {number} [elevation]  Elevation to use for the fill.
   * @param {object} [opts]       Options passed to setElevationForShape
   * @param {string} [opts.type]  Type of line-of-sight to use, which can affect
   *   which walls are included. Defaults to "light".
   * @returns {PIXI.Graphics} The child graphics added to the _graphicsContainer
   */
  fillLOS(origin, elevation, { type = "light", ...opts } = {}) {
    const los = CONFIG.Canvas.polygonBackends[type].create(origin, { type });
    return this.setElevationForShape(los, elevation, opts);
  }


  /**
   * Fill spaces enclosed by walls from a given origin point.
   * @param {Point} origin    Start point for the fill.
   * @param {number} [elevation]
   * @param {object}  [opts]   Options passed to _setElevationForGraphics.
   * @returns {PIXI.Graphics}   The child graphics added to the _graphicsContainer
   */
  fill(origin, elevation, opts) {
    /* Algorithm
      Prelim: Gather set of all walls, including boundary walls.
      1. Shoot a line to the west and identify colliding walls.
      2. Pick closest and remember it.

      Determine open/closed
      3. Follow the wall clockwise and turn clockwise at each intersection or endpoint.
      4. If back to original wall, found the boundary.
      5. If ends without hitting original wall, this wall set is open.
         Remove walls from set; redo from (1).

      Once boundary polygon is found:
      1. Get all (potentially) enclosed walls. Use bounding rect.
      2. Omit any walls whose endpoint(s) lie outside the actual boundary polygon.
      3. For each wall, determine if open or closed using open/closed algorithm.
      4. If open, omit walls from set. If closed, these are holes. If the linked walls travels
         outside the boundary polygon than it can be ignored
    */

    /* testing
    origin = _token.center
    el = canvas.elevation
    api = game.modules.get("elevatedvision").api
    WallTracer = api.WallTracer

    */

    log(`Attempting fill at { x: ${origin.x}, y: ${origin.y} } with elevation ${elevation}`);
    const polys = SCENE_GRAPH.encompassingPolygonWithHoles(origin);
    if ( !polys.length ) {
      // Shouldn't happen, but...
      ui.notifications.warn(`Sorry; cannot locate a closed boundary for the requested fill at { x: ${origin.x}, y: ${origin.y} }!`);
      return;
    }

    // Create the graphics representing the fill!
    const graphics = new PIXI.Graphics();
    drawPolygonWithHoles(polys, { graphics, fillColor: this.elevationColor(elevation) });
    this._setElevationForGraphics(graphics, elevation);
  }

  /**
   * Helper function to get all walls that may intersect a ray, and then
   * return the intersections of those walls.
   * @param {Point} origin        Origin of the ray.
   * @param {Point} destination   Destination of the ray
   * @param {"any"|"all"|"sorted"|"closest"}  mode    Affects return value.
   * @returns {Point3d[][Point3d|boolean|null]}
   *    any: True if any wall intersects.
   *    all: Array of intersections that intersect.
   *    sorted: Sorted array by distance from origin.
   *    closest: Closest intersection from origin.
   * Intersections each have the respective wall attached as the "wall" property.
   */
  _getAllWallCollisions(origin, destination, mode) {
    const ray = new Ray(origin, destination);
    const walls = canvas.walls.quadtree.getObjects(ray.bounds);
    return testWallsForIntersections(origin, destination, walls, mode);
  }

  /**
   * Walk from a starting wall, turning right at each intersection or endpoint,
   * to determine whether the wall is part of a closed polygon boundary.
   * @param {WallTracer} startingWall
   * @param {PolygonVertex} startingEndpoint
   * @param {Map<Wall, WallTracer>} wallTracerMap
   * @param {Set<WallTracer>} wallTracerSet         Walls encountered will be removed from this set.
   * @param {Point} startingIx                      Where to start on the starting wall.
   * @returns {PIXI.Polygon|false} Return the closed polygon or false if no closed polygon found.
   */
  _testForClosedBoundaryWalls(startingWall, startingEndpoint, wallTracerMap, wallTracerSet, startingIx) {
    const poly = new PIXI.Polygon();

    /* Debug
      drawSegment(startingWall)
      drawPoint(startingEndpoint, {color: COLORS.black})
    */

    let maxIter = 1000;
    let i = 0;
    let currWall = startingWall;
    let currEndpoint = startingEndpoint;
    let startDistance2 = 0;

    if ( startingIx ) {
      startDistance2 = PIXI.Point.distanceSquaredBetween(startingEndpoint, startingIx);
    } else {
      poly.addPoint(startingEndpoint);
    }
    let currDistance2 = startDistance2;
    let passedStartingPoint = false;

    while ( i < maxIter ) {
      wallTracerSet.delete(currWall);

      // Determine ccw and cw endpoints
      // If origin --> A --> B is cw, then A is ccw, B is cw
      if ( currWall.numIntersections ) currWall.processIntersections(wallTracerMap);
      let next = currWall.nextFromStartingEndpoint(currEndpoint, currDistance2);

      /* Debug
      drawSegment(next.wall)
      drawPoint(next.startingEndpoint, {color: COLORS.black})
      */

      let pointToAdd;
      if ( !next ) {
        // Need to reverse directions
        currEndpoint = currWall.otherEndpoint(currEndpoint);
        currDistance2 = 0;
        pointToAdd = currEndpoint;
      } else {
        currWall = next.wall;
        currEndpoint = next.startingEndpoint;
        if ( next.ix ) {
          currDistance2 = PIXI.Point.distanceSquaredBetween(currEndpoint, next.ix);
          pointToAdd = next.ix;
        } else {
          currDistance2 = 0;
          pointToAdd = currEndpoint;
        }
      }

      poly.addPoint(pointToAdd);

      // Stop when returning to the first point.
      // This is tricky because it is possible to return to the starting wall multiple times.
      // 1. Simple polygon. Connects at the starting wall endpoint.
      // 2. Starting below an intersection. Intersection may return to starting wall.
      //    Need to pass the starting point before returning.
      // 3. Starting above an intersection.
      //    Must pass the starting point after processing the intersection at end.
      if ( currWall === startingWall && currDistance2 <= startDistance2 ) passedStartingPoint = true;

      const firstPoint = new PIXI.Point(poly.points[0], poly.points[1]);
      if ( passedStartingPoint && firstPoint.almostEqual(pointToAdd) ) break;

      i += 1;
    }

    if ( poly.isClosed ) return poly;
    return false;
  }

  /**
   * Remove all elevation data from the scene.
   */
  async clearElevationData() {
    this._clearElevationPixelCache();
    this._backgroundElevation.destroy();
    this._backgroundElevation = PIXI.Sprite.from(PIXI.Texture.EMPTY);

    this._graphicsContainer.destroy({children: true});
    this._graphicsContainer = new PIXI.Container();

    await canvas.scene.unsetFlag(MODULE_ID, FLAGS.ELEVATION_IMAGE);
    this._requiresSave = false;
    this.#elevationCurrentMax = 0;
    this.renderElevation();
  }

  /**
   * Destroy elevation data when changing scenes or clearing data.
   */
  #destroy() {
    this._clearElevationPixelCache();
    this._backgroundElevation.destroy();
    this._backgroundElevation = PIXI.Sprite.from(PIXI.Texture.EMPTY);
    this._elevationColorsMesh?.destroy();

    this._graphicsContainer.destroy({children: true});
    this._graphicsContainer = new PIXI.Container();

    this._elevationTexture?.destroy();
  }

  /* -------------------------------------------- */
  /* NOTE: DRAWING ELEVATION ON CANVAS */

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

  /**
   * Draw the elevation container.
   */
  drawElevation() {
    this.container.addChild(this._elevationColorsMesh);
  }

  /**
   * Remove the elevation color shading.
   */
  eraseElevation() {
    this.container.removeChild(this._elevationColorsMesh);
  }

  _updateMinColor() {
    this._elevationColorsMesh.shader.updateMinColor();
  }

  /**
   * Draw wall segments
   */
  _drawWallSegment(wall) {
    const g = new PIXI.Graphics();
    const draw = new Draw(g);
    const color = wall.isOpen ? Draw.COLORS.blue : Draw.COLORS.red;
    const alpha = wall.isOpen ? 0.5 : 1;

    draw.segment(wall, { color, alpha });
    draw.point(wall.edge.a, { color: Draw.COLORS.red });
    draw.point(wall.edge.b, { color: Draw.COLORS.red });
    this._wallDataContainer.addChild(g);
  }

  /**
   * From https://github.com/theripper93/wall-height/blob/12c204b44e6acfa1e835464174ac1d80e77cec4a/scripts/patches.js#L318
   * Draw the wall lower and upper heights on the canvas.
   */
  _drawWallRange(wall) {
    // Fill in for WallHeight.getWallBounds
    const bounds = {
      top: wall.document.flags?.["wall-height"]?.top ?? Number.POSITIVE_INFINITY,
      bottom: wall.document.flags?.["wall-height"]?.bottom ?? Number.NEGATIVE_INFINITY
    };
    if ( bounds.top === Infinity && bounds.bottom === -Infinity ) return;

    const style = CONFIG.canvasTextStyle.clone();
    style.fontSize /= 1.5;
    style.fill = wall._getWallColor();
    if ( bounds.top === Infinity ) bounds.top = "Inf";
    if ( bounds.bottom === -Infinity ) bounds.bottom = "-Inf";
    const range = `${bounds.top} / ${bounds.bottom}`;

    // This would mess with the existing text used in walls layer, which may not be what we want.
    // const oldText = wall.children.find(c => c.name === "wall-height-text");
    // const text = oldText ?? new PreciseText(range, style);
    const text = new PreciseText(range, style);
    text.text = range;
    text.name = "wall-height-text";
    let angle = (Math.atan2( wall.coords[3] - wall.coords[1], wall.coords[2] - wall.coords[0] ) * ( 180 / Math.PI ));
    angle = ((angle + 90 ) % 180) - 90;
    text.position.set(wall.center.x, wall.center.y);
    text.anchor.set(0.5, 0.5);
    text.angle = angle;

    this._wallDataContainer.addChild(text);
  }

  /* ----- Event Listeners and Handlers ----- /*

  /**
   * If the user clicks a canvas location, change its elevation using the selected tool.
   * @param {PIXI.InteractionEvent} event
   */
  _onClickLeft(event) {
    const o = event.interactionData.origin;
    const activeTool = game.activeTool;
    const currE = this.controls.currentElevation;

    log(`clickLeft at ${o.x},${o.y} with tool ${activeTool} and elevation ${currE}`, event);

    switch ( activeTool ) {
      case "fill-by-grid":
        this.setElevationForGridSpace(o, currE);
        break;
      case "fill-by-los":
        this.fillLOS(o, currE);
        break;
      case "fill-by-pixel":
        this.setElevationForCircle(o, currE);
        break;
      case "fill-space":
        this.fill(o, currE);
        break;
    }

    // Standard left-click handling
    super._onClickLeft(event);
  }

  /**
   * If the user initiates a drag-left:
   * - fill-by-grid: keep a temporary set of left corner grid locations and draw the grid
   */
  _onDragLeftStart(event) {
    const o = event.interactionData.origin;
    const activeTool = game.activeTool;
    const currE = this.controls.currentElevation;
    log(`dragLeftStart at ${o.x}, ${o.y} with tool ${activeTool} and elevation ${currE}`, event);

    switch ( activeTool ) {
      case "fill-by-grid": {
        this.#temporaryGraphics.clear(); // Should be accomplished elsewhere already
        const tl = canvas.grid.getTopLeftPoint(o);
        const p = new foundry.canvas.edges.PolygonVertex(tl.x, tl.y);
        const child = this.setElevationForGridSpace(o, currE, { temporary: true });
        this.#temporaryGraphics.set(p.key, child);
      }
        break;
      case "fill-by-pixel": {
        this.#temporaryGraphics.clear(); // Should be accomplished elsewhere already
        const p = new foundry.canvas.edges.PolygonVertex(o.x, o.y);
        const child = this.setElevationForCircle(p, currE, { temporary: true });
        this.#temporaryGraphics.set(p.key, child);
      }
        break;
    }
  }

  /**
   * User continues a drag left.
   * - fill-by-grid: If new grid space, add.
   */
  _onDragLeftMove(event) {
    const o = event.interactionData.origin;
    const d = event.interactionData.destination;
    const activeTool = game.activeTool;
    const currE = this.controls.currentElevation;

    // TO-DO: What if the user changes the elevation mid-drag? (if MouseWheel enabled)

    switch ( activeTool ) {
      case "fill-by-grid": {
        const tl = canvas.grid.getTopLeftPoint(d);
        const p = new foundry.canvas.edges.PolygonVertex(tl.x, tl.y);
        if ( !this.#temporaryGraphics.has(p.key) ) {
          log(`dragLeftMove from ${o.x},${o.y} to ${d.x}, ${d.y} with tool ${activeTool} and elevation ${currE}`, event);
          const child = this.setElevationForGridSpace(d, currE, { temporary: true });
          this.#temporaryGraphics.set(p.key, child);
        }
      }
        break;
      case "fill-by-pixel": {
        const p = new foundry.canvas.edges.PolygonVertex(d.x, d.y);
        if ( !this.#temporaryGraphics.has(p.key) ) {
          log(`dragLeftMove from ${o.x},${o.y} to ${d.x}, ${d.y} with tool ${activeTool} and elevation ${currE}`, event);
          const child = this.setElevationForCircle(p, currE, { temporary: true });
          this.#temporaryGraphics.set(p.key, child);
        }
      }
        break;
    }
  }

  /**
   * User commits the drag
   */
  _onDragLeftDrop(event) {
    const o = event.interactionData.origin;
    const d = event.interactionData.destination;
    const activeTool = game.activeTool;
    const currE = this.controls.currentElevation;
    log(`dragLeftDrop at ${o.x}, ${o.y} to ${d.x},${d.y} with tool ${activeTool} and elevation ${currE}`, event);

    if ( activeTool === "fill-by-grid" ) {
      const tl = canvas.grid.grid.getTopLeftPoint(d);
      const p = new foundry.canvas.edges.PolygonVertex(tl.x, tl.y);
      if ( !this.#temporaryGraphics.has(p.key) ) {
        const child = this.setElevationForGridSpace(d, currE, { temporary: true });
        this.#temporaryGraphics.set(p.key, child);
      }

      this.#temporaryGraphics.clear(); // Don't destroy children b/c added already to main graphics
      this._requiresSave = true;
    }
  }

  /**
   * User cancels the drag.
   * Currently does not appear triggered by anything, but conceivably could be triggered
   * by hitting escape while in a drag.
   */
  _onDragLeftCancel(event) {
    const activeTool = game.activeTool;
    const currE = this.controls.currentElevation;

    if ( activeTool === "fill-by-grid" ) {
      if ( !this.#temporaryGraphics.size ) return;
      log(`dragLeftCancel with tool ${activeTool} and elevation ${currE}`, event);

      // Remove the temporary graphics from main graphics
      this.#temporaryGraphics.forEach(child => {
        this._graphicsContainer.removeChild(child);
        child.destroy();
      });
      this.#temporaryGraphics.clear();
    }
  }

  /**
   * User scrolls the mouse wheel. Currently does nothing in response.
   */
  _onMouseWheel(event) {
    const o = event.interactionData.origin;
    const activeTool = game.activeTool;
    const currE = this.controls.currentElevation;
    log(`mouseWheel at ${o.x}, ${o.y} with tool ${activeTool} and elevation ${currE}`, event);
  }

  /**
   * User hits delete key. Currently not triggered (at least on this M1 Mac).
   */
  async _onDeleteKey(event) {
    const o = event.interactionData.origin;
    const activeTool = game.activeTool;
    const currE = this.controls.currentElevation;
    log(`deleteKey at ${o.x}, ${o.y} with tool ${activeTool} and elevation ${currE}`, event);
  }

}

// NOTE: Testing elevation texture pixels
/*
api = game.modules.get("elevatedvision").api
extractPixels = api.extract.extractPixels

let { pixels, width, height } = extractPixels(canvas.app.renderer, canvas.elevation._elevationTexture)

filterPixelsByChannel = function(pixels, channel = 0, numChannels = 4) {
  if ( numChannels === 1 ) return;
  if ( channel < 0 || numChannels < 0 ) {
    console.error("channels and numChannels must be greater than 0.");
  }
  if ( channel >= numChannels ) {
    console.error("channel must be less than numChannels. (First channel is 0.)");
  }

  const numPixels = pixels.length;
  const filteredPixels = new Array(Math.floor(numPixels / numChannels));
  for ( let i = channel, j = 0; i < numPixels; i += numChannels, j += 1 ) {
    filteredPixels[j] = pixels[i];
  }
  return filteredPixels;
}


pixelRange = function(pixels) {
  const out = {
    min: pixels.reduce((acc, curr) => Math.min(curr, acc), Number.POSITIVE_INFINITY),
    max: pixels.reduce((acc, curr) => Math.max(curr, acc), Number.NEGATIVE_INFINITY)
  };

  out.nextMin = pixels.reduce((acc, curr) => curr > out.min ? Math.min(curr, acc) : acc, Number.POSITIVE_INFINITY);
  out.nextMax = pixels.reduce((acc, curr) => curr < out.max ? Math.max(curr, acc) : acc, Number.NEGATIVE_INFINITY);
  return out;
}
uniquePixels = function(pixels) {
  s = new Set();
  pixels.forEach(px => s.add(px))
  return s;
}

countPixels = function(pixels, value) {
  let sum = 0;
  pixels.forEach(px => sum += px === value);
  return sum;
}
*/
