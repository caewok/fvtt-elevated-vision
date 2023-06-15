/* globals
canvas,
TexturExtractor
*/
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";


// Class to manage loading and saving of the elevation texture.

class ElevationTextureManager {

  /** @type {boolean} */
  #initialized = false;

  /** @type {TextureExtractor} */
  #extractor;

  /** @type {string} */
  #filePath = "";

  /** @type {string} */
  #fileName = "";

  /** @type {boolean} */
  //#useCached = true;

  /**
   * Initialize the elevation texture - resetting it when switching scenes or redrawing canvas.
   * @returns {Promise<void>}
   */
  async initialize() {
    this.#initialized = false;
    this.#extractor ??= new TextureExtractor(canvas.app.renderer, { callName: "ElevatedVision", controlHash: true });
    this.#extractor.reset();
//     await this.load();

    // Set the file path for the texture and ensure that the folder structure is present.
    const pack = game.modules.get(MODULE_ID);
    const fileExt = "webp";
    this.#filePath = await this.constructor.constructSaveDirectory("worlds", `${game.world.id}`, "assets", `${MODULE_ID}`);
    this.#fileName = `${game.world.id}-${canvas.scene.id}-elevationMap.${fileExt}`;

    await convertFromSceneFlag();

    this.#initialized = true;
  }



  /**
   * Load the elevation texture from the stored file for the world and scene.
   */
  async load() {
    // const fn = this.#useCached ? TextureLoader.loader.getCache : TextureLoader.loader.loadTexture;
    const fn = TextureLoader.loader.loadTexture;
    const baseTexture = fn(`${this.#filePath}/${this.#fileName}`);
    const texture = new PIXI.Texture(baseTexture);
    // this.#useCached = true;

     width ??= canvas.dimensions.sceneWidth;
     height ??= canvas.dimensions.sceneHeight;
     resolution ??= texture.width > texture.height ? texture.width / width : texture.height / height;
      texture.baseTexture.setSize(width, height, resolution);
      texture.baseTexture.setStyle(this.textureConfiguration.scaleMode, this.textureConfiguration.mipmap);
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

  async extract() {
    const pix = await this.#extractor.extract({
      texture: canvas.elevation._elevationTexture,
      compression: TextureExtractor.COMPRESSION_MODES.NONE,
      type: "image/webp",
      quality: 1.0,
      debug: false
    });


  }

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


  async save() {
    const base64image = await this.#extractor.extract({
      texture: canvas.elevation._elevationTexture,
      compression: TextureExtractor.COMPRESSION_MODES.BASE64,
      type: "image/webp",
      quality: 1.0,
      debug: false
    });

    const saveRes = await this.constructor.uploadBase64(base64image, this.#fileName, this.#filePath, { type: "image", notify: false })
    //this.#useCached = false;
    return saveRes;
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




//   base64image =
//       await extractor.extract({
//         texture: canvas.elevation._elevationTexture,
//         compression: TextureExtractor.COMPRESSION_MODES.BASE64,
//         type: "image/webp",
//         quality: 1.0,
//         debug: false
//       });

  }

  /**
   * Load the elevation texture from the canvas scene flag.
   * @deprecated
   */
//   async loadSceneElevationData() {
//     const elevationImage = canvas.scene.getFlag(MODULE_ID, FLAGS.ELEVATION_IMAGE);
//     if ( !elevationImage ) return;
//
//     if ( isEmpty(elevationImage) || isEmpty(elevationImage.imageData) ) {
//       canvas.scene.unsetFlag(MODULE_ID, FLAGS.ELEVATION_IMAGE);
//       return;
//     }
//
//     // We are loading a saved file, so we only want to require a save if the scene
//     // elevation has already been modified.
//     let neededSave = canvas.elevation._requiresSave;
//
//     await this.importFromImageFile(elevationImage.imageData, {
//       resolution: elevationImage.resolution,
//       width: elevationImage.width,
//       height: elevationImage.height });
//     this._requiresSave = neededSave;
//
//   }


}

  /**
   * Load the elevation data from the image stored in a scene flag.
   */
 //  async loadSceneElevationData() {
//     log("loadSceneElevationData");
//     const elevationImage = canvas.scene.getFlag(MODULE_ID, FLAGS.ELEVATION_IMAGE);
//     if ( !elevationImage ) return;
//
//     if ( isEmpty(elevationImage) || isEmpty(elevationImage.imageData) ) {
//       canvas.scene.unsetFlag(MODULE_ID, FLAGS.ELEVATION_IMAGE);
//       return;
//     }
//
//     // We are loading a saved file, so we only want to require a save if the scene
//     // elevation has already been modified.
//     let neededSave = this._requiresSave;
//
//     // Check if this is an updated version.
//     // v0.4.0 added resolution, width, height.
//     /*
//     if ( isNewerVersion("0.4.0", elevationImage.version) ) {
//       ui.notifications.notify("Detected older version of elevation scene data.
//       Downloading backup in case upgrade goes poorly!");
//       await this.downloadStoredSceneElevationData();
//       neededSave = true;
//     }
//     */
//
//     await this.importFromImageFile(elevationImage.imageData, {
//       resolution: elevationImage.resolution,
//       width: elevationImage.width,
//       height: elevationImage.height });
//     this._requiresSave = neededSave;
//
//     // Following won't work if _resolution.format = PIXI.FORMATS.ALPHA
//     // texImage2D: type FLOAT but ArrayBufferView not Float32Array when using the filter
//     // const { width, height } = this._resolution;
//     // this._elevationBuffer = new Uint8Array(width * height);
//     // this._elevationTexture = PIXI.Texture.fromBuffer(this._elevationBuffer, width, height, this._resolution);
//   }
//
//   /**
//    * Store the elevation data for the scene in a flag for the scene
//    */
//   async saveSceneElevationData() {
//     const format = "image/webp";
//     const imageData = await this._extractElevationImageData(format);
//     const saveObj = {
//       imageData,
//       format,
//       width: this._elevationTexture.width,
//       height: this._elevationTexture.height,
//       resolution: this._elevationTexture.resolution,
//       timestamp: Date.now(),
//       version: game.modules.get(MODULE_ID).version };
//
//     await canvas.scene.setFlag(MODULE_ID, FLAGS.ELEVATION_IMAGE, saveObj);
//     this._requiresSave = false;
//   }
//
//   async _extractElevationImageData(format = "image/webp", quality = 1) {
//     this.renderElevation();
//     // Store only the scene rectangle data
//     // From https://github.com/dev7355608/perfect-vision/blob/3eb3c040dfc83a422fd88d4c7329c776742bef2f/patches/fog.js#L256
//     const { pixels, width, height } = extractPixels(
//       canvas.app.renderer,
//       this._elevationTexture);
//     const canvasElement = pixelsToCanvas(pixels, width, height);
//
//     // Depending on format, may need quality = 1 to avoid lossy compression
//     return await canvasToBase64(canvasElement, format, quality);
//   }
//
//   /**
//    * Import elevation data from the provided image file location into the scene.
//    * @param {File} file
//    */
//   async importFromImageFile(file, { resolution = 1, width, height } = {}) {
//     width ??= canvas.dimensions.sceneWidth;
//     height ??= canvas.dimensions.sceneHeight;
//     log(`import ${width}x${height} ${file} with resolution ${resolution}`, file);
//
//     // See https://stackoverflow.com/questions/41494623/pixijs-sprite-not-loading
//     const texture = await PIXI.Texture.fromURL(file);
//     log(`Loaded texture with dim ${texture.width},${texture.height}`, texture);
//
//     resolution ??= texture.width > texture.height ? texture.width / width : texture.height / height;
//
//     texture.baseTexture.setSize(width, height, resolution);
//     texture.baseTexture.setStyle(this.textureConfiguration.scaleMode, this.textureConfiguration.mipmap);
//
//     // Testing: let sprite = PIXI.Sprite.from("elevation/test_001.png");
//     canvas.elevation._backgroundElevation.texture.destroy();
//     canvas.elevation._backgroundElevation.texture = texture;
//
//     canvas.elevation.renderElevation();
//     canvas.elevation._requiresSave = true;
//   }
