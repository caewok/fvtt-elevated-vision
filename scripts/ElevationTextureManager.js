/* globals
canvas,
TexturExtractor
*/
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";


// Class to manage loading and saving of the elevation texture.

class ElevationTextureManager {
  /**
   * The maximum allowable visibility texture size.
   * In v11, this is equal to CanvasVisibility.#MAXIMUM_VISIBILITY_TEXTURE_SIZE
   * @type {number}
   */
  static #MAXIMUM_ELEVATION_TEXTURE_SIZE = CONFIG[MODULE_ID]?.elevationTextureSize ?? 4096;

  /** @type {boolean} */
  #initialized = false;

  /** @type {boolean} */
  #useCachedTexture = true;

  /** @type {TextureExtractor} */
  #extractor;

  /** @type {string} */
  #filePath = "";

  /** @type {string} */
  #fileName = "";

  /** @type {boolean} */
  //#useCached = true;

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
   * @param {string[]} [opts.filePath]    Array of directory names, in order, for the file path
   * @param {string} [opts.fileName]      Name of the file, without file extension. (.webp will be added.)
   * @returns {Promise<void>}
   */
  async initialize({filePath, fileName} = {}) {
    this.#initialized = false;

    // Set default values.
    const fileExt = "webp";
    filePath ??= ["worlds", `${game.world.id}`, "assets", `${MODULE_ID}`];
    fileName ??= `${game.world.id}-${canvas.scene.id}-elevationMap`;
    fileName += `.${fileExt}`;

    // Initialize a new TextureExtractor worker.
    this.#extractor ??= new TextureExtractor(canvas.app.renderer, { callName: "ElevatedVision", controlHash: true });
    this.#extractor.reset();

    // Set the file path for the texture and ensure that the folder structure is present
    this.#filePath = await this.constructor.constructSaveDirectory(...filePath));
    this.#fileName = fileName;

    // Set up the texture configuration.
    this.#textureConfiguration = this._configureElevationTexture();

    // Conversion from older versions of EV.
    await convertFromSceneFlag();

    this.#initialized = true;
  }

  /**
   * Load the elevation texture from the stored file for the world and scene.
   * @returns {PIXI.Texture}
   */
  async load() {
    const fn = this.#useCached ? TextureLoader.loader.getCache : TextureLoader.loader.loadTexture;
    const baseTexture = fn(`${this.#filePath}/${this.#fileName}`);
    const texture = new PIXI.Texture(baseTexture);
    // this.#useCached = true;
    const { width, height } = canvas.dimensions.sceneRect;
    const resolution = texture.width > texture.height ? texture.width / width : texture.height / height;
    texture.baseTexture.setSize(width, height, resolution);
    texture.baseTexture.setStyle(this.#textureConfiguration.scaleMode, this.#textureConfiguration.mipmap);

    this.#useCachedTexture = true;
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
        elevationImage.imageData, this.#fileName, this.#filePath, { type: "image", notify: false })
      const texture = this.load();
      if ( !texture.valid ) throw new Error("Elevation texture is invalid.");

      elevationImage.imageURL = `${this.#filePath}/${this.#fileName}`;
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
   * @returns {Uint8Array}
   */
  async extract(texture) {
    return await this.#extractor.extract({
      texture,
      compression: TextureExtractor.COMPRESSION_MODES.NONE,
      type: "image/webp",
      quality: 1.0,
      debug: false
    });
  }

  /**
   * Confirm if a hierarchy of directories exist within the "data" storage location.
   * Create new directories if missing.
   * @param {string} ...dirs      Each argument is a string with the name of a folder
   * @returns {string} The constructed storage path, not including "data".
   */
  static async constructSaveDirectory(...dirs) {
    // Need to build the folder structure in steps or it will error out.
    let storagePath = "";
    for (const dir of dirs) {
      storagePath += `${dir}/`;
      await FilePicker.browse("data", storagePath).catch(error => {
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

    this.#useCachedTexture = false;
    return this.constructor.uploadBase64(base64image, this.#fileName, this.#filePath, { type: "image", notify: false })
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
   * Values used when rendering elevation data to a texture representing the scene canvas.
   * It may be important that width/height of the elevation texture is evenly divisible
   * by the downscaling resolution. (It is important for fog manager to prevent drift.)
   * @returns {ElevationTextureConfiguration}
   */
  _configureElevationTexture() {
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
