/* globals
canvas,
PIXI
*/
"use strict";

export class ElevationGrid {

  /**
   * Status flag for whether layer initialization has succeeded.
   * @type {boolean}
   * @private
   */
  #initialized = false;

  get data() {
    return this._data;
  }

  _data = new Uint8Array();

  get texture() {
    return this._texture;
  }

  _texture;

  /**
   * The configured resolution used for the saved elevation texture.
   * @type {FogResolution}
   */
  get resolution() {
    return this.#resolution;
  }

  /** @private */
  #resolution;

  /**
   * Choose a resolution based on scene size.
   * In the future, resolution may be downscaled similar to how FogManager does it.
   * @returns {FogResolution}
   */
  _configureResolution() {
    // Use width/height instead of sceneWidth/sceneHeight for simplicity
    const { width, height } = canvas.dimensions;
    this.width = width;
    this.height = height;
    this.area = width * height;

    return this.#resolution = {
      resolution: 1.0,
      mipmap: PIXI.MIPMAP_MODES.OFF,
      scaleMode: PIXI.SCALE_MODES.LINEAR,
      multisample: PIXI.MSAA_QUALITY.NONE,
      format: PIXI.FORMATS.ALPHA,
      alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA,
      type: PIXI.TYPES.UNSIGNED_INT
    };
  }

  /**
   * Initialize the elevation grid for this scene.
   * @returns {Promise<void>}
   */
  async initialize() {
    this.#initialized = false;
    this._configureResolution();
    await this.load();
    this.#initialized = true;
  }

  /**
   * Load existing elevation data from local storage and populate the initial sprite.
   * @returns {Promise<(PIXI.Texture|void)>}
   */
  async load() {
    // For the moment, just create a new texture.
    // In the future, will load from database.
    // TO-DO: Also allow loading from an image file provided by user?
    this._data = new Uint8Array(this.area);
    this._texture = PIXI.BaseTexture.fromBuffer(this.data, this.width, this.height, {
      scaleMode: PIXI.SCALE_MODES.NEAREST,
      format: PIXI.FORMATS.ALPHA
    });
    return this._texture;
  }

  get elevationStep() {
    return canvas.scene.dimensions.distance;
  }

  get elevationMax() {
    return 255 * this.elevationStep;
  }

  averageElevation() {
    const sum = this._data.reduce((a, b) => a + b);
    return sum / (this.width * this.height);
  }

  _setLocationToValue(x, y, value) {
    this._data[(x * this.height) + y] = value;
  }

  _valueForLocation(x, y) {
    return this._data[(x * this.height) + y];
  }

  elevationForLocation(x, y) {
    return this._valueForLocation(x, y) * this.elevationStep;
  }

  averageElevationForGridSpace(gx, gy) {
    const { width, height } = canvas.grid.grid;

    let sum = 0;
    const maxX = gx + width;
    const maxY = gy + height;
    for ( let x = gx; x < maxX; x += 1 ) {
      for ( let y = gy; y < maxY; y += 1 ) {
        sum += this._valueForLocation(x, y);
      }
    }

    const numPixels = width * height;
    return (sum / numPixels) / this.elevationStep;
  }

  clampElevation(e) {
    e = isNaN(e) ? 0 : e;
    e = Math.round(e / this.elevationStep) * this.elevationStep;
    return Math.clamped(e, 0, this.elevationMax);
  }

  setGridSpaceToElevation(gx, gy, elevation = 0) {
    // Get the top left corner, then fill in the values in the grid
    const [tlx, tly] = canvas.grid.grid.getPixelsFromGridPosition(gx, gy);

    const size = canvas.scene.dimensions.size;

    const value = this.clampElevation(elevation) / this.elevationStep;
    const maxX = tlx + size;
    const maxY = tly + size;
    for ( let x = tlx; x < maxX; x += 1 ) {
      for ( let y = tly; y < maxY; y += 1 ) {
        this._setLocationToValue(x, y, value);
      }
    }
  }

  downloadPNG() {
    const sprite = new PIXI.Sprite(this._texture);
    canvas.app.renderer.extract.canvas(sprite).toBlob(function(b) {
      const a = document.createElement("a");
      document.body.append(a);
      a.download = "elevation.png";
      a.href = URL.createObjectURL(b);
      a.click();
      a.remove();
    }, "image/png");
  }
}
