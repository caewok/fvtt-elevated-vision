/* globals
AbstractBaseFilter,
canvas,
CONFIG,
Dialog,
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

import { MODULE_ID, FLAG_ELEVATION_IMAGE } from "./const.js";
import { PixelCache } from "./PixelCache.js";
import {
  log,
  readDataURLFromFile,
  convertBase64ToImage,
  drawPolygonWithHoles } from "./util.js";
import { Draw } from "./geometry/Draw.js";
import { testWallsForIntersections } from "./clockwise_sweep.js";
import { SCENE_GRAPH } from "./WallTracer.js";
import { FILOQueue } from "./FILOQueue.js";
import { extractPixels, pixelsToCanvas, canvasToBase64 } from "./perfect-vision/extract-pixels.js";
import { setSceneSetting, getSceneSetting, getSetting, SETTINGS } from "./settings.js";
import { CoordinateElevationCalculator } from "./CoordinateElevationCalculator.js";
import { TokenPointElevationCalculator } from "./TokenPointElevationCalculator.js";
import { TokenAverageElevationCalculator } from "./TokenAverageElevationCalculator.js";
import { TravelElevationCalculator } from "./TravelElevationCalculator.js";

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
  constructor(...args) {
    super(...args);
  }
}

export function _onMouseMoveCanvas(wrapper, event) {
  wrapper(event);
  canvas.elevation._onMouseMove(event);
}

export class ElevationLayer extends InteractionLayer {
  constructor() {
    super();
    this.controls = ui.controls.controls.find(obj => obj.name === "elevation");

    this.undoQueue = new FILOQueue();
    this._activateHoverListener();
  }

  // Imported methods
  TravelElevationCalculator = TravelElevationCalculator;
  CoordinateElevationCalculator = CoordinateElevationCalculator;

  /**
   * Activate a listener to display elevation values when the mouse hovers over an area
   * of the canvas in the elevation layer.
   * See Ruler.prototype._onMouseMove
   */
  _onMouseMove(event) {
    if ( !canvas.ready
      || !canvas.elevation.active
      || !this.elevationLabel ) return;

    // Get the canvas position of the mouse pointer.
    const pos = event.getLocalPosition(canvas.app.stage);
    if ( !canvas.dimensions.sceneRect.contains(pos.x, pos.y) ) {
      this.elevationLabel.visible = false;
      return;
    }

    // Update the numeric label with the elevation at this position.
    this.updateElevationLabel(pos);
    this.elevationLabel.visible = true;
  }

  _activateHoverListener() {
    log("activatingHoverListener");
    const textStyle = PreciseText.getTextStyle({
      fontSize: 24,
      fill: "#333333",
      strokeThickness: 2,
      align: "right",
      dropShadow: false
    });

    this.elevationLabel = new PreciseText(undefined, textStyle);
    this.elevationLabel.anchor = {x: 0, y: 1};
    canvas.stage.addChild(this.elevationLabel);
  }

  /**
   * Update the elevation label to the elevation value at the provided location,
   * and move the label to that location.
   * @param {number} x
   * @param {number} y
   */
  updateElevationLabel({x, y}) {
    const value = this.elevationAt({x, y});

    this.elevationLabel.text = value.toString();
//     log(`Updating elevation label at ${x},${y} to ${this.elevationLabel.text}`);
    this.elevationLabel.position = {x, y};
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
   * Maximum pixel value. Currently pixels range between 0 and 255 for a color channel.
   * @type {number}
   */
  #maximumPixelValue = 255;

  get maximumPixelValue() { return this.#maximumPixelValue; }

  /**
   * The maximum allowable visibility texture size.
   * In v11, this is equal to CanvasVisibility.#MAXIMUM_VISIBILITY_TEXTURE_SIZE
   * @type {number}
   */
  static #MAXIMUM_ELEVATION_TEXTURE_SIZE = CONFIG[MODULE_ID]?.elevationTextureSize ?? 4096;

  /** @type ElevationTextureConfiguration */
  #textureConfiguration;

  /**
   * The configured options used for the saved elevation texture.
   * @type {ElevationTextureConfiguration}
   */
  get textureConfiguration() {
    return this.#textureConfiguration;
  }

  /**
   * Flag for when the elevation data has changed for the scene, requiring a save.
   * Currently happens when the user changes the data or uploads a new data file.
   * @type {boolean}
   */
  _requiresSave = false; // Avoid private field here b/c it causes problems for arrow functions

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
    const step = getSceneSetting(SETTINGS.ELEVATION_INCREMENT);
    return step ?? canvas.scene.dimensions.distance;
  }

  set elevationStep(stepNew) {
    if ( stepNew < 0.1 ) {
      console.warn("elevationStep should be a positive integer or float, to be rounded to 1 decimal place.");
      return;
    }

    stepNew = Number.isInteger(stepNew) ? stepNew : Math.round((stepNew * 10)) / 10;

    // Function to set the new pixel value such that elevation stays (mostly) the same.
    // e = min + value * step.
    // min + value * step = min + valueNew * stepNew
    // valueNew * stepNew = min + value * step - min
    // valueNew = value * step / stepNew
    const step = this.elevationStep;
    const mult = step / stepNew;
    const stepAdjust = function(pixel) {
      const out = Math.clamped(Math.round(mult * pixel), 0, 255);
      return out || 0;
    };

    setSceneSetting(SETTINGS.ELEVATION_INCREMENT, stepNew);
    this.changePixelValuesUsingFunction(stepAdjust);
  }

  /* ------------------------ */

  /**
   * Minimum elevation value for a scene.
   * @type {number}
   */
  get elevationMin() {
    const min = getSceneSetting(SETTINGS.ELEVATION_MINIMUM);
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
      const out = Math.clamped(Math.round(adder + pixel), 0, 255);
      return out || 0; // In case of NaN, etc.
    };

    setSceneSetting(SETTINGS.ELEVATION_MINIMUM, minNew);
    this.changePixelValuesUsingFunction(minAdjust);
  }

  /* ------------------------ */

  /**
   * Calculated maximum elevation value for the scene.
   * @type {number}
   */
  get elevationMax() {
    return this.elevationMin + (this.#maximumPixelValue * this.elevationStep);
  }

  /* ------------------------ */

  /**
   * Stores graphics created when dragging using the fill-by-grid control.
   * @param {Map<PIXI.Graphics>}
   */
  #temporaryGraphics = new Map();

  /**
   * Convert a pixel value to an elevation value.
   * @param {number} value    Pixel value
   * @returns {number}
   */
  pixelValueToElevation(value) {
    return this.elevationMin + (Math.round(value * this.elevationStep * 10) / 10);
  }

  /**
   * Convert an elevation value to a pixel value between 0 and 255
   * @param {number} value    Elevation
   * @returns {number}
   */
  elevationToPixelValue(elevation) {
    elevation = this.clampElevation(elevation);
    return (elevation - this.elevationMin) / this.elevationStep;
  }

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
    const value = this.elevationToPixelValue(elevation);

    // Gradient from red (255, 0, 0) to blue (0, 0, 255)
    // Flip at 128
    // Helps visualization
    // const r = value;
    // const g = 0;
    // const b = value - 255;

    log(`elevationHex elevation ${elevation}, value ${value}`);
    return new PIXI.Color([value / this.#maximumPixelValue, 0, 0]);
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
    return Math.clamped(e, this.elevationMin, this.elevationMax);
  }

  /** @override */
  static get layerOptions() {
    return mergeObject(super.layerOptions, {
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
    canvas.stage.addChild(this.elevationLabel);
    canvas.stage.addChild(this._wallDataContainer);
  }

  /** @override */
  _deactivate() {
    log("De-activating Elevation Layer.");
    if ( !this.container ) return;
    canvas.stage.removeChild(this._wallDataContainer);

    // TO-DO: keep the wall graphics and labels and just update as necessary.
    // Destroy only in tearDown
    const wallData = this._wallDataContainer.removeChildren();
    wallData.forEach(d => d.destroy(true));

    canvas.stage.removeChild(this.elevationLabel);
    if ( this._requiresSave ) this.saveSceneElevationData();
    Draw.clearDrawings();
    this.container.visible = false;
  }

  /** @override */
  async _draw(options) { // eslint-disable-line no-unused-vars
    if ( canvas.elevation.active ) this.drawElevation();
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

    this.TokenElevationCalculator = getSetting(SETTINGS.AUTO_AVERAGING)
      ? TokenAverageElevationCalculator : TokenPointElevationCalculator;

    this._initialized = false;
    this._clearElevationPixelCache()
    this.#textureConfiguration = this._configureElevationTexture();

    // Initialize container to hold the elevation data and GM modifications
    const w = new FullCanvasContainer();
    this.container = this.addChild(w);

    // Background elevation sprite should start at the upper left scene corner
    const { sceneX, sceneY } = canvas.dimensions;
    this._backgroundElevation.position = { x: sceneX, y: sceneY };

    // Add the render texture for displaying elevation information to the GM
    this._elevationTexture = PIXI.RenderTexture.create(this.textureConfiguration);
    // Set the clear color of the render texture to black. The texture needs to be opaque.
    this._elevationTexture.baseTexture.clearColor = [0, 0, 0, 1];

    // Add the sprite that holds the default background elevation settings
    this._graphicsContainer.addChild(this._backgroundElevation);

    await this.loadSceneElevationData();
    this.renderElevation();

//     this._updateMinimumElevationFromSceneTiles();

    this._initialized = true;
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
   * @typedef {object} ElevationTextureConfiguration
   * @property {number} resolution    Resolution of the texture
   * @property {number} width         Width, based on sceneWidth
   * @property {number} height        Height, based on sceneHeight
   * @property {PIXI.MIPMAP_MODES} mipmap
   * @property {PIXI.SCALE_MODES} scaleMode
   * @property {PIXI.MSAA_QUALITY} multisample
   * @property {PIXI.FORMATS} format
   */

  /**
   * Values used when rendering elevation data to a texture representing the scene canvas.
   * It may be important that width/height of the elevation texture is evenly divisible
   * by the downscaling resolution. (It is important for fog manager to prevent drift.)
   * @returns {ElevationTextureConfiguration}
   */
  _configureElevationTexture() {
    // In v11, see CanvasVisibility.prototype.#configureVisibilityTexture
    const dims = canvas.scene.dimensions;
    const size = dims.size;
    let width = dims.sceneWidth;
    let height = dims.sceneHeight;

    let resolution = Math.clamped(CONFIG[MODULE_ID]?.resolution ?? 0.25, .01, 1);
    const maxSize = Math.min(
      ElevationLayer.#MAXIMUM_ELEVATION_TEXTURE_SIZE,
      resolution * Math.max(width, height));

    if ( width >= height ) {
      resolution = maxSize / width;
      height = Math.ceil(height * resolution) / resolution;
    } else {
      resolution = maxSize / height;
      width = Math.ceil(width * resolution) / resolution;
    }

    return {
      resolution, // TODO: Remove these defaults
      width,
      height,
      mipmap: PIXI.MIPMAP_MODES.OFF,
      scaleMode: PIXI.SCALE_MODES.NEAREST,
      multisample: PIXI.MSAA_QUALITY.NONE,
      format: PIXI.FORMATS.RED
      // Cannot be extracted ( GL_INVALID_OPERATION: Invalid format and type combination)
      // format: PIXI.FORMATS.RED_INTEGER,
      // type: PIXI.TYPES.INT
    };
  }

  /**
   * Load the elevation data from the image stored in a scene flag.
   */
  async loadSceneElevationData() {
    log("loadSceneElevationData");
    const elevationImage = canvas.scene.getFlag(MODULE_ID, FLAG_ELEVATION_IMAGE);
    if ( !elevationImage ) return;

    if ( isEmpty(elevationImage) || isEmpty(elevationImage.imageData) ) {
      canvas.scene.unsetFlag(MODULE_ID, FLAG_ELEVATION_IMAGE);
      return;
    }

    // We are loading a saved file, so we only want to require a save if the scene
    // elevation has already been modified.
    let neededSave = this._requiresSave;

    // Check if this is an updated version.
    // v0.4.0 added resolution, width, height.
//     if ( isNewerVersion("0.4.0", elevationImage.version) ) {
//       ui.notifications.notify("Detected older version of elevation scene data. Downloading backup in case upgrade goes poorly!");
//       await this.downloadStoredSceneElevationData();
//       neededSave = true;
//     }

    await this.importFromImageFile(elevationImage.imageData, {
      resolution: elevationImage.resolution,
      width: elevationImage.width,
      height: elevationImage.height });
    this._requiresSave = neededSave;

    // Following won't work if _resolution.format = PIXI.FORMATS.ALPHA
    // texImage2D: type FLOAT but ArrayBufferView not Float32Array when using the filter
    // const { width, height } = this._resolution;
    // this._elevationBuffer = new Uint8Array(width * height);
    // this._elevationTexture = PIXI.Texture.fromBuffer(this._elevationBuffer, width, height, this._resolution);
  }

  /**
   * Store the elevation data for the scene in a flag for the scene
   */
  async saveSceneElevationData() {
    const format = "image/webp";
    const imageData = await this._extractElevationImageData(format);
    const saveObj = {
      imageData,
      format,
      width: this._elevationTexture.width,
      height: this._elevationTexture.height,
      resolution: this._elevationTexture.resolution,
      timestamp: Date.now(),
      version: game.modules.get(MODULE_ID).version };

    await canvas.scene.setFlag(MODULE_ID, FLAG_ELEVATION_IMAGE, saveObj);
    this._requiresSave = false;
  }

  async _extractElevationImageData(format = "image/webp", quality = 1) {
    this.renderElevation();
    // Store only the scene rectangle data
    // From https://github.com/dev7355608/perfect-vision/blob/3eb3c040dfc83a422fd88d4c7329c776742bef2f/patches/fog.js#L256
    const { pixels, width, height } = extractPixels(
      canvas.app.renderer,
      this._elevationTexture);
      //canvas.dimensions.sceneRect);
    const canvasElement = pixelsToCanvas(pixels, width, height);

    // Depending on format, may need quality = 1 to avoid lossy compression
    return await canvasToBase64(canvasElement, format, quality);
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
  async importFromImageFile(file, { resolution = 1, width, height } = {}) {
    width ??= canvas.dimensions.sceneWidth;
    height ??= canvas.dimensions.sceneHeight;
    log(`import ${width}x${height} ${file} with resolution ${resolution}`, file);

    // See https://stackoverflow.com/questions/41494623/pixijs-sprite-not-loading
    const texture = await PIXI.Texture.fromURL(file);
    log(`Loaded texture with dim ${texture.width},${texture.height}`, texture);

    resolution ??= texture.width > texture.height ? texture.width / width : texture.height / height;

    texture.baseTexture.setSize(width, height, resolution);
    texture.baseTexture.setStyle(this.textureConfiguration.scaleMode, this.textureConfiguration.mipmap);

    // Testing: let sprite = PIXI.Sprite.from("elevation/test_001.png");
    canvas.elevation._backgroundElevation.texture.destroy();
    canvas.elevation._backgroundElevation.texture = texture;

    canvas.elevation.renderElevation();
    canvas.elevation._requiresSave = true;
  }

  /**
   * Download the elevation data as an image file.
   * Currently writes the texture elevation data to red channel.
   * @param {object} [options]  Options that affect how the image file is formatted.
   * @param {string} [options.format] Image format, e.g. "image/jpeg" or "image/webp".
   * @param {string} [options.fileName] Name of the file. Extension will be added based on format.
   */
  async downloadElevationData({ format = "image/png", fileName = canvas.scene.name } = {}) {
    const imageExtension = format.split("/")[1];
    fileName += `.${imageExtension}`;

    const image64 = await this._extractElevationImageData(format);
    saveDataToFile(convertBase64ToImage(image64), format, fileName);
  }

  /**
   * Download the stored elevation data for the scene.
   */
  async downloadStoredSceneElevationData({ fileName = "elevation-" + canvas.scene.name } = {}) {
    const elevationImage = canvas.scene.getFlag(MODULE_ID, FLAG_ELEVATION_IMAGE);
    if ( !elevationImage || isEmpty(elevationImage) || isEmpty(elevationImage.imageData) ) return;
    saveDataToFile(convertBase64ToImage(elevationImage.imageData), elevationImage.format, fileName);
  }

  // TO-DO: Preferably download as alpha, possibly by constructing a new texture?

  //     const { width, height } = this._resolution;
  //     const tex = PIXI.Texture.fromBuffer(this.pixelArray, width, height, {
  //       resolution: 1.0,
  //       mipmap: PIXI.MIPMAP_MODES.OFF,
  //       scaleMode: PIXI.SCALE_MODES.LINEAR,
  //       multisample: PIXI.MSAA_QUALITY.NONE,
  //       format: PIXI.FORMATS.ALPHA
  //     })
  //
  //     const s = new PIXI.Sprite(texture);
  //     const png = canvas.app.renderer.extract.image(s, "image/png")


  /* -------------------------------------------- */
  /* NOTE: ELEVATION PIXEL DATA */

  /**
   * @typedef {object} PixelFrame
   * @property {number[]} pixels
   * @property {number} width
   * @property {number} height
   * @property {number} [resolution]
   */

  /** @type {PixelFrame} */
  #elevationPixelCache;

  get elevationPixelCache() {
    return this.#elevationPixelCache ?? (this.#elevationPixelCache = this.#refreshElevationPixelCache());
  }

  /**
   * Refresh the pixel array cache from the elevation texture.
   */
  #refreshElevationPixelCache() {
    // TODO: This needs to handle textures with resolutions less than 1.
    const { sceneX: x, sceneY: y } = canvas.dimensions;
    return PixelCache.fromTexture(this._elevationTexture, { x, y });
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
    return this.pixelValueToElevation(value);
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
    return this.pixelValueToElevation(average);
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
  averageElevationForGridSpace(row, col, { useHex = canvas.grid.isHex } = {}) {
    const [x, y] = canvas.grid.grid.getPixelsFromGridPosition(row, col);
    return this.averageElevationAtGridPoint(x, y, { useHex });
  }

  /**
   * Retrieve the average elevation of the grid space that encloses these
   * coordinates.
   * @param {Point} pt
   * @returns {number} Elevation value.
   */
  averageElevationAtGridPoint(pt, { useHex = canvas.grid.isHex } = {}) {
    const shape = useHex ? this._hexGridShape(pt) : this._squareGridShape(pt);
    return this.averageElevationWithinShape(shape);
  }

  /* -------------------------------------------- */
  /* NOTE: CHANGE ELEVATION VALUES */

  /**
   * Apply a function to every pixel value.
   * @param {function} fn   Function to use.
   *  It should take a single elevation value and return a different elevation value.
   *  Note that these are pixel values, not elevation values.
   */
  changePixelValuesUsingFunction(fn) {
    this.renderElevation(); // Just in case

    // Because we just re-rendered the elevation, it would be pointless to use the cache.
    const sceneRect = canvas.dimensions.sceneRect;
    const { pixels, width, height } = this._extractFromElevationTexture(sceneRect);
    const ln = pixels.length;
    for ( let i = 0; i < ln; i += 1 ) pixels[i] = fn(pixels[i]);

    // This makes vertical lines: newTex = PIXI.Texture.fromBuffer(pixels, width, height)
    const br = new PIXI.BufferResource(pixels, {width, height});
    const bt = new PIXI.BaseTexture(br);
    const newTex = new PIXI.Texture(bt);

    // Save to the background texture (used by the background sprite, like with saved images)
    this._backgroundElevation.texture.destroy();
    this._backgroundElevation.texture = newTex;

    this.renderElevation();
    this._requiresSave = true;
  }

  /**
   * Change elevation of every pixel that currently is set to X value.
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

    const fromPixelValue = this.elevationToPixelValue(from);
    const toPixelValue = this.elevationToPixelValue(to);

    this.renderElevation(); // Just in case

    // Extract pixels from the renderTexture (combined graphics + underlying sprite)
    const sceneRect = canvas.dimensions.sceneRect;
    const { pixels, width, height } = this._extractFromElevationTexture(sceneRect);

    const ln = pixels.length;
    for ( let i = 0; i < ln; i += 4 ) {
      if ( pixels[i] === fromPixelValue ) pixels[i] = toPixelValue;
    }

    // Error Makes vertical lines:
    // newTex = PIXI.Texture.fromBuffer(pixels, width, height)
    const br = new PIXI.BufferResource(pixels, {width, height});
    const bt = new PIXI.BaseTexture(br);
    const newTex = new PIXI.Texture(bt);

    // Save to the background texture (used by the background sprite, like with saved images)
    this._backgroundElevation.texture.destroy();
    this._backgroundElevation.texture = newTex;

    this.renderElevation();
    this._requiresSave = true;
  }

  /**
   * Set the elevation for the grid space that contains the point.
   * If this is a hex grid, it will fill in the hex grid space.
   * @param {Point} p             Point within the grid square/hex.
   * @param {number} elevation    Elevation to use to fill the grid space
   * @param {object}  [options]   Options that affect setting this elevation
   * @param {boolean} [options.temporary]   If true, don't immediately require a save.
   *   This setting does not prevent a save if the user further modifies the canvas.
   * @param {boolean} [options.useHex]      If true, use a hex grid; if false use square.
   *   Defaults to canvas.grid.isHex.
   *
   * @returns {PIXI.Graphics} The child graphics added to the _graphicsContainer
   */
  setElevationForGridSpace(p, elevation = 0, { temporary = false, useHex = canvas.grid.isHex } = {}) {
    const shape = useHex ? this._hexGridShape(p) : this._squareGridShape(p);
    const graphics = this._graphicsContainer.addChild(new PIXI.Graphics());
    const draw = new Draw(graphics);
    const color = this.elevationColor(elevation);
    draw.shape(shape, { color, fill: color });

    this.renderElevation();

    this._requiresSave = !temporary;
    this.undoQueue.enqueue(graphics);
    return graphics;
  }

  /* -------------------------------------------- */
  /* NOTE: TOKEN SHAPES */

  _tokenShape(tokenTLCorner, width, height) {
    // For the moment, uneven width/height shapes must use rectangle border
    if ( canvas.grid.isHex && width === height ) return this._hexGridShape(tokenTLCorner, { width, height });
    return new PIXI.Rectangle(tokenTLCorner.x, tokenTLCorner.y, width, height);
  }

  _squareGridShape(p) {
    // Get the top left corner
    const [tlx, tly] = canvas.grid.grid.getTopLeft(p.x, p.y);
    const { w, h } = canvas.grid;
    return new PIXI.Rectangle(tlx, tly, w, h);
  }

  _hexGridShape(p, { width = 1, height = 1 } = {}) {
    // Canvas.grid.grid.getBorderPolygon will return null if width !== height.
    if ( width !== height ) return null;

    // Get the top left corner
    const [tlx, tly] = canvas.grid.grid.getTopLeft(p.x, p.y);
    const points = canvas.grid.grid.getBorderPolygon(width, height, 0); // TO-DO: Should a border be included to improve calc?
    const pointsTranslated = [];
    const ln = points.length;
    for ( let i = 0; i < ln; i += 2) {
      pointsTranslated.push(points[i] + tlx, points[i+1] + tly);
    }

    return new PIXI.Polygon(pointsTranslated);
  }

  /* -------------------------------------------- */
  /* NOTE: FILLING ELEVATION ON CANVAS */

  /**
   * Construct a LOS polygon from this point and fill with the provided elevation.
   * @param {Point} origin        Point where viewer is assumed to be.
   * @param {number} elevation    Elevation to use for the fill.
   * @param {object} [options]    Options that affect the fill.
   * @param {string} [options.type]   Type of line-of-sight to use, which can affect
   *   which walls are included. Defaults to "light".
   * @returns {PIXI.Graphics} The child graphics added to the _graphicsContainer
   */
  fillLOS(origin, elevation = 0, { type = "light"} = {}) {
    const los = CONFIG.Canvas.polygonBackends[type].create(origin, { type });

    const graphics = this._graphicsContainer.addChild(new PIXI.Graphics());
    const draw = new Draw(graphics);
    const color = this.elevationColor(elevation);
    draw.shape(los, { color, width: 0, fill: color });

    this.renderElevation();

    this._requiresSave = true;
    this.undoQueue.enqueue(graphics);

    return graphics;
  }


  /**
   * Fill spaces enclosed by walls from a given origin point.
   * @param {Point} origin    Start point for the fill.
   * @param {number} elevation
   * @returns {PIXI.Graphics}   The child graphics added to the _graphicsContainer
   */
  fill(origin, elevation) {
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
    const graphics = this._graphicsContainer.addChild(new PIXI.Graphics());
    drawPolygonWithHoles(polys, { graphics, fillColor: this.elevationColor(elevation) });

    this.renderElevation();

    this._requiresSave = true;
    this.undoQueue.enqueue(graphics);

    return graphics;
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
   * Undo the prior graphics addition.
   */
  undo() {
    const g = this.undoQueue.dequeue();
    if ( !g ) return;
    this._graphicsContainer.removeChild(g);
    g.destroy();
    this._requiresSave = true;
    this.renderElevation();
  }

  /**
   * Remove all elevation data from the scene.
   */
  async clearElevationData() {
    this.#destroy();
    await canvas.scene.unsetFlag(MODULE_ID, FLAG_ELEVATION_IMAGE);
    this._requiresSave = false;
    this.renderElevation();
  }

  /**
   * Destroy elevation data when changing scenes or clearing data.
   */
  #destroy() {
    this._clearElevationPixelCache();
    this._backgroundElevation.destroy();
    this._backgroundElevation = PIXI.Sprite.from(PIXI.Texture.EMPTY);

    this._graphicsContainer.destroy({children: true});
    this._graphicsContainer = new PIXI.Container();
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
    this.#elevationPixelCache = undefined;
  }

  /**
   * Draw the elevation container.
   * @returns {FullCanvasContainer|null}    The elevation container
   */
  drawElevation() {
    const { width, height } = this.elevationPixelCache;
    const elevationFilter = ElevationFilter.create({
      dimensions: [width, height],
      elevationSampler: this._elevationTexture
    });
    this.container.filters = [elevationFilter];
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
    draw.point(wall.A, { color: Draw.COLORS.red });
    draw.point(wall.B, { color: Draw.COLORS.red });
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
        log("fill-by-pixel not yet implemented.");
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

    if ( activeTool === "fill-by-grid" ) {
      this.#temporaryGraphics.clear(); // Should be accomplished elsewhere already
      const [tlx, tly] = canvas.grid.grid.getTopLeft(o.x, o.y);
      const p = new PolygonVertex(tlx, tly);
      const child = this.setElevationForGridSpace(o, currE, { temporary: true });
      this.#temporaryGraphics.set(p.key, child);
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

    if ( activeTool === "fill-by-grid" ) {
      const [tlx, tly] = canvas.grid.grid.getTopLeft(d.x, d.y);
      const p = new PolygonVertex(tlx, tly);
      if ( !this.#temporaryGraphics.has(p.key) ) {
        log(`dragLeftMove from ${o.x},${o.y} to ${d.x}, ${d.y} with tool ${activeTool} and elevation ${currE}`, event);
        const child = this.setElevationForGridSpace(d, currE, { temporary: true });
        this.#temporaryGraphics.set(p.key, child);
      }
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
      const [tlx, tly] = canvas.grid.grid.getTopLeft(d.x, d.y);
      const p = new PolygonVertex(tlx, tly);
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

/**
 * Filter used to display the elevation layer coloration of elevation data.
 * elevationSampler is a texture that stores elevation data in the red channel.
 * Elevation data currently displayed as a varying red color with varying alpha.
 * Alpha is gamma corrected to ensure only darker alphas and red shades are used, to
 * ensure the lower elevation values are perceivable.
 */
class ElevationFilter extends AbstractBaseFilter {
  static vertexShader = `
    attribute vec2 aVertexPosition;

    uniform mat3 projectionMatrix;
    uniform mat3 canvasMatrix;
    uniform vec4 inputSize;
    uniform vec4 outputFrame;
    uniform vec2 dimensions;

    varying vec2 vTextureCoord;
//     varying vec2 vCanvasCoord;
    varying vec2 vCanvasCoordNorm;

    void main(void)
    {
       vTextureCoord = aVertexPosition * (outputFrame.zw * inputSize.zw);
       vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.)) + outputFrame.xy;
       vec2 canvasCoord = (canvasMatrix * vec3(position, 1.0)).xy;
       vCanvasCoordNorm = canvasCoord / dimensions;
       gl_Position = vec4((projectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
    }
  `;

  static fragmentShader = `
    varying vec2 vTextureCoord;
    varying vec2 vCanvasCoord;
    varying vec2 vCanvasCoordNorm;

    uniform sampler2D uSampler;
    uniform sampler2D elevationSampler;

    void main() {
      vec4 tex = texture2D(uSampler, vTextureCoord);
      vec4 elevation = texture2D(elevationSampler, vCanvasCoordNorm);


      if ( elevation.r == 0.
        || vCanvasCoordNorm.x < 0.
        || vCanvasCoordNorm.y < 0.
        || vCanvasCoordNorm.x > 1.
        || vCanvasCoordNorm.y > 1. ) {
        // Outside the scene boundary or no elevation set: use the background texture.
        gl_FragColor = tex;
      } else {
        // Adjust alpha to avoid extremely light alphas
        // basically a gamma correction
        float alphaAdj = pow(elevation.r, 1. / 2.2);
        gl_FragColor = vec4(alphaAdj, 0., 0., alphaAdj);
      }
    }
  `;

  /** @override */
  // Thanks to https://ptb.discord.com/channels/732325252788387980/734082399453052938/1009287977261879388
  apply(filterManager, input, output, clear, currentState) {
    const { sceneX, sceneY } = canvas.dimensions;
    this.uniforms.canvasMatrix ??= new PIXI.Matrix();
    this.uniforms.canvasMatrix.copyFrom(canvas.stage.worldTransform);
//     this.uniforms.canvasMatrix.translate(sceneX, sceneY);
    this.uniforms.canvasMatrix.invert();
    this.uniforms.canvasMatrix.translate(-sceneX, -sceneY);
    return super.apply(filterManager, input, output, clear, currentState);
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
