/* globals
InteractionLayer,
ui,
canvas,
PIXI,
mergeObject,
FullCanvasContainer,
AbstractBaseFilter,
saveDataToFile,
Dialog,
renderTemplate,
game,
isEmpty
*/
"use strict";

import { MODULE_ID, FLAG_ELEVATION_IMAGE } from "./const.js";
import { log, readDataURLFromFile, convertBase64ToImage, extractPixels } from "./util.js";
import * as drawing from "./drawing.js";

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

export class ElevationLayer extends InteractionLayer {
  constructor() {
    super();
    this.controls = ui.controls.controls.find(obj => obj.name === "elevation");
  }

  _backgroundElevation = new PIXI.Sprite.from(PIXI.Texture.EMPTY);

  /**
   * Container to hold the current graphics objects representing elevation
   */
  _graphicsContainer = new PIXI.Container();

  /**
   * Sprite representing the background elevation
   */

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
   * Flag for when the elevation data has changed for the scene, requiring a save.
   * Currently happens when the user changes the data or uploads a new data file.
   */
  _requiresSave = false; // Avoid private field here b/c it causes problems for arrow functions

  get elevation() {
    return this.#elevation;
  }

  set elevation(value) {
    this.#elevation = value;
    canvas.primary.sortChildren();
  }

  /**
   * Increment between elevation measurements. Should be a positive integer.
   * @type {number}
   */
  #elevationStep = undefined; // Undefined b/c canvas.scene could be null on first load.

  get elevationStep() {
    return this.#elevationStep ?? canvas.scene.dimensions.distance;
  }

  set elevationStep(value) {
    if ( value < 1 || !Number.isInteger(value) ) {
      console.warn("elevationStep should be a positive integer.");
      return;
    }
    this.#elevationStep = value;
  }

  #elevationMin = 0;

  get elevationMin() {
    return this.#elevationMin;
  }

  set elevationMin(value) {
    this.#elevationMin = value;
  }

  get elevationMax() {
    return (255 * this.elevationStep) - this.elevationMin;
  }

  pixelValueToElevation(value) {
    return (Math.round(value) * this.elevationStep) - this.elevationMin;
  }


  /**
   * Color used to store this elevation value.
   * @param {number} e  Proposed elevation value. May be corrected by clampElevation.
   * @return {Hex}
   */
  elevationHex(e) {
    e = this.clampElevation(e);
    const value = (e + this.elevationMin) / this.elevationStep;

    // Gradient from red (255, 0, 0) to blue (0, 0, 255)
    // Flip at 128
    // Helps visualization
    // const r = value;
    // const g = 0;
    // const b = value - 255;

    log(`elevationHex elevation ${e}, value ${value}`);

    return PIXI.utils.rgb2hex([value / 255, 0, 0]);
  }

  /**
   * Ensure the elevation value is an integer that matches the specified step,
   * and is between the min and max elevation values.
   * Required so that translation to an integer-based color texture works.
   * @param {number} e  Proposed elevation value
   * @return {number}   The elevation integer between elevationMin and elevationMax.
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
    this.drawElevation();
    this.container.visible = true;
  }

  /** @override */
  _deactivate() {
    log("De-activating Elevation Layer.");
    if ( !this.container ) return;
    if ( this._requiresSave ) this.saveSceneElevationData();
    drawing.clearDrawings();
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
    // Probably need to figure out how to destroy and/or remove these objects
    //     this._graphicsContainer.destroy({children: true});
    //     this._graphicsContainer = null;
    this.#destroy();
    this.container = null;
    return super._tearDown(options);
  }

  /* -------------------------------------------- */

  applyFilter() {
    const w = new FullCanvasContainer();
    this.container = this.addChild(w);
    this.filter = MyFilter.create();
    w.filters = [this.filter];
  }

  _initialized = false;

  /**
   * Initialize elevation data - resetting it when switching scenes or re-drawing canvas
   */
  async initialize() {
    log("Initializing elevation layer");

    this._initialized = false;
    this._resolution = this._configureResolution();

    // Initialize container to hold the elevation data and GM modifications
    const w = new FullCanvasContainer();
    this.container = this.addChild(w);

    // Add the render texture for displaying elevation information to the GM
    this._elevationTexture = PIXI.RenderTexture.create(this._resolution);

    // Add the sprite that holds the default background elevation settings
    this._graphicsContainer.addChild(this._backgroundElevation);

    await this.loadSceneElevationData();

    this._initialized = true;
  }

  _configureResolution() {
    return {
      resolution: 1.0,
      width: canvas.dimensions.width,
      height: canvas.dimensions.height,
      mipmap: PIXI.MIPMAP_MODES.OFF,
      scaleMode: PIXI.SCALE_MODES.LINEAR,
      multisample: PIXI.MSAA_QUALITY.NONE
    };
  }

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
    const neededSave = this._requiresSave;
    await this.importFromImageFile(elevationImage.imageData);
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
    this.renderElevation();

     // Depending on format, may need quality = 1 to avoid lossy compression
    const imageData = canvas.app.renderer.extract.base64(this._elevationTexture, format, 1);
    const saveObj = { imageData, format };

    await canvas.scene.setFlag(MODULE_ID, FLAG_ELEVATION_IMAGE, saveObj);
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

  async importFromImageFile(file) {
    log(`import ${file}`, file);

    // See https://stackoverflow.com/questions/41494623/pixijs-sprite-not-loading
    const texture = await PIXI.Texture.fromURL(file);
    log(`Loaded texture with dim ${texture.width},${texture.height}`, texture);

    // Adjust position for sprite if necessary; abort if no match found.
    const { width, height, sceneWidth, sceneHeight, sceneRect } = canvas.dimensions;
    if ( texture.width === sceneWidth && texture.height === sceneHeight ) {
      texture.position = sceneRect;
    } else if ( texture.width !== width && texture.height !== height ) {
      ui.notifications.error("Image elevation file dimensions do not match the scene. Try resizing the image file to the scene size.");
      return;
    }

    log("rendering image file");

    // Testing: let sprite = PIXI.Sprite.from("elevation/test_001.png");
    canvas.elevation._backgroundElevation.texture.destroy();
    canvas.elevation._backgroundElevation.texture = texture;

    canvas.elevation.renderElevation();
    canvas.elevation._requiresSave = true;
  }

  /**
   * Download the elevation data as an image file.
   * Currently writes the texture as RGBA?
   * @param {object} [options]  Options that affect how the image file is formatted.
   * @param {string} [options.format] Image format, e.g. "image/jpeg" or "image/webp".
   * @param {string} [options.fileName] Name of the file. Extension will be added based on format.
   */
  async downloadElevationData({ format = "image/png", fileName = "elevation"} = {}) {
    const imageExtension = format.split("/")[1];
    fileName += `.${imageExtension}`;

    this.renderElevation();

    // Depending on format, may need quality = 1 to avoid lossy compression
    const image64 = canvas.app.renderer.extract.image(this._elevationTexture, format, 1);
    saveDataToFile(convertBase64ToImage(image64), format, fileName);
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


  elevationAt(x, y) {
    const gridRect = new PIXI.Rectangle(x, y, 1, 1);
    return this.averageElevation(gridRect);
  }

  averageElevationForGridSpace(row, col) {
    const [x, y] = canvas.grid.grid.getPixelsFromGridPosition(row, col);
    return this.averageElevationForGridPoint(x, y);
  }

  averageElevationAtGridPoint(x, y) {
    const { w, h } = canvas.grid.grid;
    const [tlx, tly] = canvas.grid.grid.getTopLeft(x, y);

    const gridRect = new PIXI.Rectangle(tlx, tly, w, h);
    return this.averageElevation(gridRect);
  }

  averageElevation(gridRect = new PIXI.Rectangle(0, 0, this._resolution.width, this._resolution.height)) {
    const arr = extractPixels(this._elevationTexture, gridRect);
    let sum = 0;
    const ln = arr.length;
    for ( let i = 0; i < ln; i += 4 ) {
      sum += arr[i];
    }
    return this.pixelValueToElevation(sum) / (gridRect.width * gridRect.height);
  }


  /**
   * Set the elevation for the grid space that contains the point.
   * @param {Point} p   Point within the grid square/hex.
   * @param {number} elevation
   */
  setElevationForGridSpace(p, elevation = 0) {
    // Get the top left corner, then fill in the values in the grid
    const [tlx, tly] = canvas.grid.grid.getTopLeft(p.x, p.y);
    const { w, h } = canvas.grid;

    const graphics = this._graphicsContainer.addChild(new PIXI.Graphics());
    graphics.beginFill(this.elevationHex(elevation), 1.0);
    graphics.drawRect(tlx, tly, w, h);
    graphics.endFill();

    this.renderElevation();

    this._requiresSave = true;

    // TO-DO: Destroy graphics? Clear graphics and reuse?
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
    this._backgroundElevation.destroy();
    this._backgroundElevation = new PIXI.Sprite.from(PIXI.Texture.EMPTY);

    this._graphicsContainer.destroy({children: true});
    this._graphicsContainer = new PIXI.Container()
  }

  /**
   * (Re)render the graphics stored in the container.
   */
  renderElevation() {
    canvas.app.renderer.render(this._graphicsContainer, this._elevationTexture);
  }

  /**
   * Draw the weather container.
   * @returns {FullCanvasContainer|null}    The weather container, or null if no effect is present
   */
  drawElevation() {

    // Draw walls
    // TO-DO: Add to the layer render using graphics instead of the debug display?
    for ( const wall of canvas.walls.placeables ) {
      drawing.drawSegment(wall, { color: drawing.COLORS.red });
      drawing.drawPoint(wall.A, { color: drawing.COLORS.red });
      drawing.drawPoint(wall.B, { color: drawing.COLORS.red });
    }

    const elevationFilter = ElevationFilter.create({
      dimensions: [this._resolution.width, this._resolution.height],
      elevationSampler: this._elevationTexture
    });
    this.container.filters = [elevationFilter];
  }

  /* ----- Event Listeners and Handlers ----- /*

  /**
   * If the user clicks a canvas location, change its elevation using the selected tool.
   * @param {PIXI.InteractionEvent} event
   */
  _onClickLeft(event) {
    const o = event.data.origin;
    const activeTool = this.controls.activeTool;
    const currE = this.controls.currentElevation;

    log(`clickLeft at ${o.x},${o.y} with tool ${activeTool} and elevation ${currE}`, event);

    switch ( activeTool ) {
      case "fill-by-grid":
        this.setElevationForGridSpace(o, currE);
        break;
      case "fill-by-pixel":
        log("fill-by-pixel not yet implemented.");
        break;
      case "fill-space":
        log("fill-space not yet implemented.");
        break;
    }

    // Standard left-click handling
    super._onClickLeft(event);
  }
}

class MyFilter extends AbstractBaseFilter {
  static vertexShader = `
    attribute vec2 aVertexPosition;

    uniform mat3 projectionMatrix;
    uniform mat3 canvasMatrix;
    uniform vec4 inputSize;
    uniform vec4 outputFrame;

    varying vec2 vTextureCoord;
    varying vec2 vCanvasCoord;

    void main(void)
    {
       vTextureCoord = aVertexPosition * (outputFrame.zw * inputSize.zw);
       vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.)) + outputFrame.xy;
       vCanvasCoord = (canvasMatrix * vec3(position, 1.0)).xy;
       gl_Position = vec4((projectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
    }
  `;

  static fragmentShader = `
    varying vec2 vTextureCoord;
    varying vec2 vCanvasCoord;

    uniform sampler2D uSampler;

    void main() {
      vec4 tex = texture2D(uSampler, vTextureCoord);
      if ( vCanvasCoord.x > 1000.) {
        gl_FragColor = vec4(1., 0. , 0., 1.);
      } else {
        gl_FragColor = tex;
      }
    }
  `;

  /** @override */
  // Thanks to https://ptb.discord.com/channels/732325252788387980/734082399453052938/1009287977261879388
  apply(filterManager, input, output, clear, currentState) {
    this.uniforms.canvasMatrix ??= new PIXI.Matrix();
    this.uniforms.canvasMatrix.copyFrom(canvas.stage.worldTransform).invert();
    return super.apply(filterManager, input, output, clear, currentState);
  }
}

class ElevationFilter extends AbstractBaseFilter {
  static vertexShader = `
    attribute vec2 aVertexPosition;

    uniform mat3 projectionMatrix;
    uniform mat3 canvasMatrix;
    uniform vec4 inputSize;
    uniform vec4 outputFrame;
    uniform vec2 dimensions;

    varying vec2 vTextureCoord;
    varying vec2 vCanvasCoord;
    varying vec2 vCanvasCoordNorm;

    void main(void)
    {
       vTextureCoord = aVertexPosition * (outputFrame.zw * inputSize.zw);
       vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.)) + outputFrame.xy;
       vCanvasCoord = (canvasMatrix * vec3(position, 1.0)).xy;
       vCanvasCoordNorm = vCanvasCoord / dimensions;
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

      if ( elevation.r == 0.0 ) {
        gl_FragColor = tex;
      } else {
        // Adjust alpha to avoid extremely light alphas
        // basically a gamma correction
        float alphaAdj = pow(elevation.r, 1. / 2.2);
        gl_FragColor = vec4(alphaAdj, 0., 0., alphaAdj);
      }

//       gl_FragColor = elevation;

//       if ( elevation.x > .5) {
//         gl_FragColor = elevation;
//       } else {
//         gl_FragColor = tex;
//       }
    }
  `;

  /** @override */
  // Thanks to https://ptb.discord.com/channels/732325252788387980/734082399453052938/1009287977261879388
  apply(filterManager, input, output, clear, currentState) {
    this.uniforms.canvasMatrix ??= new PIXI.Matrix();
    this.uniforms.canvasMatrix.copyFrom(canvas.stage.worldTransform).invert();
    return super.apply(filterManager, input, output, clear, currentState);
  }

}


/*
renderer = canvas.app.renderer
gl = renderer.gl;

*/

/*
function smoothstep(edge0, edge1, x) {
  const t = Math.clamped((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3.0 - 2.0 * t);
}

new FilePicker({activeSource: "data", current: "icons/magic/earth"}).render(true);

png64 = ImageHelper.textureToImage(el._elevationTexture, { format: "image/png" })
webp64 = ImageHelper.textureToImage(el._elevationTexture, { format: "image/webp", quality: 1 })

*/
