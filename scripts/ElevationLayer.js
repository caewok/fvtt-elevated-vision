/* globals

*/
"use strict";

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

}

export class ElevationGrid {
  // Include the padding.
  constructor(width = canvas.scene?.dimensions?.width || 0, height = canvas.scene?.dimensions?.height || 0) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height);
  }

  get elevationstep() {
    return canvas.scene.dimensions.distance;
  }

  get elevationmax() {
    return 255 * this.elevationstep;
  }

  _setLocationToValue(x, y, value) {
    this.data[(x * this.height) + y];
  }

  _valueForLocation(x, y) {
    return this.data[(x * this.height) + y];
  }

  elevationForLocation(x, y) {
    return this._valueForLocation(x, y) * this.elevationstep;
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
    return (sum / numPixels) / this.elevationstep;
  }

  clampElevation(e) {
    e = Math.round(e / this.elevationstep) * this.elevationstep;
    return Math.clamped(e, 0, this.elevationmax);
  }

  setGridSpace(gx, gy, elevation = 0) {
    const value = this.clampElevation(elevation) / this.elevationstep;
    const maxX = gx + canvas.grid.grid.width;
    const maxY = gy + canvas.grid.grid.height;
    for ( let x = gx; x < maxX; x += 1 ) {
      for ( let y = gy; y < maxY; y += 1 ) {
        this._setLocationToValue(x, y, value);
      }
    }
  }
}