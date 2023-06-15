/* globals
canvas,
CONFIG,
FilePicker,
game,
ImageHelper,
isNewerVersion,
PIXI,
TextureExtractor,
TextureLoader
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";


// Class to manage loading and saving of the elevation texture.

export class ElevationTextureManager {
  /**
   * The maximum allowable visibility texture size.
   * In v11, this is equal to CanvasVisibility.#MAXIMUM_VISIBILITY_TEXTURE_SIZE
   * @type {number}
   */
  static #MAXIMUM_ELEVATION_TEXTURE_SIZE = CONFIG[MODULE_ID]?.elevationTextureSize ?? 4096;

  /** @type {boolean} */
  #initialized = false;

  /** @type {boolean} */
  #useCachedTexture = false;

  /** @type {TextureExtractor} */
  #extractor;

  /** @type {string} */
  #filePath = "";

  /** @type {string} */
  #fileName = "";

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

  /** @type {ElevationTextureConfiguration} */
  #textureConfiguration;

  /**
   * Initialize the elevation texture - resetting it when switching scenes or redrawing canvas.
   * @param {object} [opts]               Optional parameters that affect storage location
   * @param {string} [opts.filePath]      Directory path of the elevation image file
   * @param {string} [opts.fileName]      Name of the file, without file extension (.webp will be added)
   * @param {string} [opts.fileURL]       Full path of the file with file extension.
   *                                      If provided, filePath and fileName are ignored.
   * @returns {Promise<void>}
   */
  async initialize({filePath, fileName, fileURL} = {}) {
    this.#initialized = false;

    // Set default values.
    if ( fileURL ) {
      const pathArr = fileURL.split("/");
      fileName = pathArr.at(-1);
      filePath = pathArr.slice(0, -1).join("/");
    } else {
      const fileExt = "webp";
      filePath ??= `worlds/${game.world.id}/assets/${MODULE_ID}`;
      fileName ??= `${game.world.id}-${canvas.scene.id}-elevationMap`;
      fileName += `.${fileExt}`;
    }

    // Initialize a new TextureExtractor worker.
    this.#extractor ??= new TextureExtractor(canvas.app.renderer, { callName: "ElevatedVision", controlHash: true });
    this.#extractor.reset();

    // Set the file path for the texture and ensure that the folder structure is present
    this.#filePath = await this.constructor.constructSaveDirectory(filePath);
    this.#fileName = fileName;

    this.#textureConfiguration = undefined;

    // Conversion from older versions of EV.
    this.#initialized = await this.convertFromSceneFlag();
  }

  get textureConfiguration() {
    return this.#textureConfiguration ?? (this.#textureConfiguration = this._getElevationTextureConfiguration());
  }

  /**
   * Load the elevation texture from the stored file for the world and scene.
   * @returns {PIXI.Texture}
   */
  async load() {
    const filePath = `${this.#filePath}/${this.#fileName}`;
    try {
      const baseTexture = PIXI.Assets.cache.has(filePath)
        ? (await TextureLoader.loader.getCache(filePath))
        : (await TextureLoader.loader.loadTexture);
      const texture = new PIXI.Texture(baseTexture);
      return this._formatElevationTexture(texture);
    } catch(err) {
      console.warn("ElevatedVision|ElevationTextureManager load threw error", err);
      return undefined; // May or may not be an error depending on whether texture should be there.
    }
  }

  /**
   * Import elevation data from the provided image file location into a texture
   * @param {File} file
   * @returns {PIXI.Texture}
   */
  async loadFromFile(file) {
    try {
      const texture = await PIXI.Texture.fromURL(file);
      return this._formatElevationTexture(texture);

    } catch(err) {
      console.error("ElevatedVision|loadFromFile encountered error", err, file);
      return undefined;
    }
  }

  /**
   * Format a texture for use as an elevation texture.
   * @param {PIXI.Texture}
   * @returns {PIXI.Texture}
   */
  _formatElevationTexture(texture) {
    const { width, height } = canvas.dimensions.sceneRect;
    const resolution = texture.width > texture.height ? texture.width / width : texture.height / height;
    texture.baseTexture.setSize(width, height, resolution);
    texture.baseTexture.setStyle(this.#textureConfiguration.scaleMode, this.#textureConfiguration.mipmap);
    return texture;
  }

  /**
   * Get the elevation data from the scene flag, save it to the folder, and test loading it.
   * If all that works, remove the data from the scene flag and update the scene flag version.
   */
  async convertFromSceneFlag() {
    const elevationImage = canvas.scene.getFlag(MODULE_ID, FLAGS.ELEVATION_IMAGE);
    if ( !elevationImage || !elevationImage.imageData || isNewerVersion(elevationImage.version, "0.5.0") ) return true;

    try {
      const saveRes = await this.constructor.uploadBase64(
        elevationImage.imageData, this.#fileName, this.#filePath, { type: "image", notify: false });
      const texture = await this.load();
      if ( !texture.valid ) throw new Error("Elevation texture is invalid.");

      elevationImage.imageURL = saveRes.path;
      elevationImage.version = game.modules.get(MODULE_ID).version;
      elevationImage.timestamp = Date.now();
      delete elevationImage.imageData;

    } catch(err) {
      console.error("ElevatedVision|Conversion of elevation texture from scene flag failed.", err);
      return false;
    }

    return true;
  }

  /**
   * Extract pixels from a texture.
   * @param {PIXI.Texture} texture
   * @param {object} [opts]         Options that affect the output
   * @param {string} [opts.type]    MIME image type
   * @param {number} [opts.quality] Value that affects some outputs, such as jpeg
   * @returns {Uint8Array}
   */
  async extract(texture, { type = "image/webp", quality = 1 } = {}) {
    return this.#extractor.extract({
      texture,
      compression: TextureExtractor.COMPRESSION_MODES.NONE,
      type,
      quality,
      debug: false
    });
  }

  /**
   * Confirm if a hierarchy of directories exist within the "data" storage location.
   * Create new directories if missing.
   * @param {string} filePath   The directory path, separated by "/".
   * @returns {string} The constructed storage path, not including "data".
   */
  static async constructSaveDirectory(filePath) {
    // Need to build the folder structure in steps or it will error out.
    const dirs = filePath.split("/");
    let storagePath = "";
    for (const dir of dirs) {
      if ( dir === "" ) continue; // E.g., the path ends with a "/"
      storagePath += `${dir}/`;
      await FilePicker.browse("data", storagePath).catch(_error => {  // eslint-disable-line no-loop-func
        FilePicker.createDirectory("data", storagePath);
      });
    }
    return storagePath;
  }

  /**
   * Save the provided texture to the location in "data" provided in the initialization step.
   * Default location is data/worlds/world-id/assets/elevatedvision/
   * @param {PIXI.Texture} texture      Texture to save as the elevation map
   * @returns {Promise<object>}  The response object from FilePicker.upload.
   */
  async save(texture) {
    const base64image = await this.#extractor.extract({
      texture,
      compression: TextureExtractor.COMPRESSION_MODES.BASE64,
      type: "image/webp",
      quality: 1.0,
      debug: false
    });

    return this.constructor.uploadBase64(base64image, this.#fileName, this.#filePath, { type: "image", notify: false });
  }

  /**
   * Like ImageHelper.uploadBase64, but passes notify through to FilePicker.upload.
   * Upload a base64 image string to a persisted data storage location
   * @param {string} base64       The base64 string
   * @param {string} fileName     The file name to upload
   * @param {string} filePath     The file path where the file should be uploaded
   * @param {object} [options]    Additional options which affect uploading
   * @param {string} [options.storage=data]   The data storage location to which the file should be uploaded
   * @param {string} [options.type]           The MIME type of the file being uploaded
   * @returns {Promise<object>}   A promise which resolves to the FilePicker upload response
   */
  static async uploadBase64(base64, fileName, filePath, { storage="data", type, notify = true }={}) {
    type ||= base64.split(";")[0].split("data:")[1];
    const blob = await fetch(base64).then(r => r.blob());
    const file = new File([blob], fileName, {type});
    return FilePicker.upload(storage, filePath, file, { notify });
  }

  /**
   * Convert a texture to a specific image format for saving.
   * @param {PIXI.Texture} texture    Texture from which to pull data
   * @param {object} [opts]           Options that affect the image format returned
   * @param {string} [opts.format]    MIME type image format
   * @param {number} [opts.quality]   Quality, used for some formats such as jpeg.
   * @returns {string}
   */
  async convertTextureToImage(texture, { type = "image/webp", quality = 1 }) {
    const rgbaBuffer = await this.extract(texture, { type, quality });
    const width = Math.round(texture.width * texture.resolution);
    const height = Math.round(texture.height * texture.resolution);

    const canvasElement = ImageHelper.pixelsToCanvas(rgbaBuffer, width, height);
    return ImageHelper.canvasToBase64(canvasElement, type, quality);
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
  _getElevationTextureConfiguration() {
    // In v11, see CanvasVisibility.prototype.#configureVisibilityTexture
    const dims = canvas.scene.dimensions;
    let width = dims.sceneWidth;
    let height = dims.sceneHeight;

    let resolution = Math.clamped(CONFIG[MODULE_ID]?.resolution ?? 0.25, .01, 1);
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
      resolution, // TODO: Remove these defaults
      width,
      height,
      mipmap: PIXI.MIPMAP_MODES.OFF,
      scaleMode: PIXI.SCALE_MODES.NEAREST,
      multisample: PIXI.MSAA_QUALITY.NONE,
      format: PIXI.FORMATS.RG, // 256 * 256 = 65,536 elevation increments in total.
      type: PIXI.TYPES.UNSIGNED_BYTE
    };
  }
}
