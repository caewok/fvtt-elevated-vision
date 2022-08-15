/* globals

*/
"use strict";

import { log } from "./util.js";
import { ElevationGrid } from "./ElevationGrid.js";

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
    this.elevationGrid = new ElevationGrid(); // Have to set manually after canvas dimensions are set
    this.controls = ui.controls.controls.find(obj => obj.name === "elevation");
  }

  /**
   * The weather overlay container
   * @type {FullCanvasContainer}
   */
  weather;

  /**
   * The currently active weather effect
   * @type {ParticleEffect}
   */
  weatherEffect;

  /**
   * An occlusion filter that prevents weather from being displayed in certain regions
   * @type {AbstractBaseMaskFilter}
   */
  weatherOcclusionFilter;

  get elevation() {
    return this.#elevation;
  }

  set elevation(value) {
    this.#elevation = value;
    canvas.primary.sortChildren();
  }

  #elevation = 9000;

  /** @override */
  static get layerOptions() {
    return mergeObject(super.layerOptions, {
      name: "Elevation",
    });
  }

  /** @override */
  async _draw(options) {
    this.weatherOcclusionFilter = InverseOcclusionMaskFilter.create({
      alphaOcclusion: 0,
      uMaskSampler: canvas.masks.tileOcclusion.renderTexture,
      channel: "b"
    });
    this.drawWeather();
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _tearDown(options) {
    this.weatherEffect?.destroy();
    this.weather = this.weatherEffect = null;
    return super._tearDown();
  }

  /* -------------------------------------------- */

  /**
   * Draw the weather container.
   * @returns {FullCanvasContainer|null}    The weather container, or null if no effect is present
   */
  drawWeather() {
    if ( this.weatherEffect ) this.weatherEffect.stop();
    const effect = CONFIG.weatherEffects[canvas.scene.elevation];
    if ( !effect ) {
      this.weatherOcclusionFilter.enabled = false;
      return null;
    }

    // Create the effect and begin playback
    if ( !this.weather ) {
      const w = new FullCanvasContainer();
      w.accessibleChildren = w.interactiveChildren = false;
      w.filterArea = canvas.app.renderer.screen;
      this.weather = this.addChild(w);
    }
    this.weatherEffect = new effect(this.weather);
    this.weatherEffect.play();

    // Apply occlusion filter
    this.weatherOcclusionFilter.enabled = true;
    this.weather.filters = [this.weatherOcclusionFilter];
    return this.weather;
  }

  /* ----- Event Listeners and Handlers ----- /*

  /**
   * If the user clicks a canvas location, change its elevation using the selected tool.
   * @param {PIXI.InteractionEvent} event
   */
  _onClickLeft(event) {
    const { x, y } = event.data.origin;
    const activeTool = this.controls.activeTool;
    const currE = this.controls.currentElevation;

    log(`clickLeft at ${x},${y} with tool ${activeTool} and elevation ${currE}`, event);

    switch ( activeTool ) {
      case "fill-by-grid":
        this._fillGridSpace(x, y, currE);
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

   _fillGridSpace(x, y, elevation) {
     const [gx, gy] = canvas.grid.grid.getGridPositionFromPixels(x, y);
     this.elevationGrid.setGridSpaceToElevation(gx, gy, elevation)
   }

}



/*
renderer = canvas.app.renderer
gl = renderer.gl;

*/
