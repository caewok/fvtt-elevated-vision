/* globals

*/
"use strict";

import { log } from "./util.js";

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
    this.elevationGrid = new ElevationGrid();
    this.controls = ui.controls.controls.find(obj => obj.name === "elevation");
  }

  /** @override */
  static get layerOptions() {
    return mergeObject(super.layerOptions, {
      name: "Elevation",
      zIndex: 35
    });
  }

  /** @override */
  async _draw(options) {
    super._draw(options);
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

export class ElevationGrid {
  // Include the padding.
  constructor(width = canvas.scene?.dimensions?.width || 0, height = canvas.scene?.dimensions?.height || 0) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height);
  }

  get elevationStep() {
    return canvas.scene.dimensions.distance;
  }

  get elevationMax() {
    return 255 * this.elevationStep;
  }

  get averageElevation() {
    const sum = this.data.reduce((a, b) => a + b);
    return sum / (this.width * this.height);
  }

  _setLocationToValue(x, y, value) {
    this.data[(x * this.height) + y] = value;
  }

  _valueForLocation(x, y) {
    return this.data[(x * this.height) + y];
  }

  elevationForLocation(x, y) {
    return this._valueForLocation(x, y) * this.elevationStep;
  }

  averageElevationForGridSpace(gx, gy) {
    const { width, height } = canvas.grid.grid;

    const sum = 0;
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
    const [ tlx, tly ] = canvas.grid.grid.getPixelsFromGridPosition(gx, gy);
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
}