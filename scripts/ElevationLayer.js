/* globals

*/
"use strict";

import { log } from "./util.js";
import { ElevationGrid } from "./ElevationGrid.js";
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
    this.elevationGrid = new ElevationGrid(); // Have to set manually after canvas dimensions are set
    this.controls = ui.controls.controls.find(obj => obj.name === "elevation");
  }

  /**
   * The elevationGrid overlay container
   * @type {FullCanvasContainer}
   */
  elevationGridContainer;


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
//     this.weatherOcclusionFilter = InverseOcclusionMaskFilter.create({
//       alphaOcclusion: 0,
//       uMaskSampler: canvas.masks.tileOcclusion.renderTexture,
//       channel: "b"
//     });
    if ( canvas.elevation.active ) this.drawElevation();
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _tearDown(options) {
    this.elevationGridContainer = null;
    return super._tearDown();
  }

  /* -------------------------------------------- */

  applyFilter() {
    const w = new FullCanvasContainer();
    this.container = this.addChild(w);
    this.filter = MyFilter.create();
    w.filters = [this.filter];
  }

  /**
   * Draw the weather container.
   * @returns {FullCanvasContainer|null}    The weather container, or null if no effect is present
   */
  drawElevation() {
    // Draw walls
    for ( const wall of canvas.walls.placeables ) {
      drawing.drawSegment(wall, { color: drawing.COLORS.red });
      drawing.drawPoint(wall.A, { color: drawing.COLORS.red });
      drawing.drawPoint(wall.B, { color: drawing.COLORS.red });
    }

    // Represent the elevation using a filter
    if ( ! this.container ) {
      const w = new FullCanvasContainer();
      this.container = this.addChild(w);

      // The container must be rendering something in order for the shader to show
      w.addChild(new PIXI.Sprite.from(PIXI.Texture.EMPTY));
    }

//     this._currentTexture = this.elevationGrid;

    const spriteForShader = new PIXI.Sprite.from('https://assets.codepen.io/292864/internal/avatars/users/default.png?fit=crop&format=auto&height=512&version=1&width=512')

    const elevationFilter = ElevationFilter.create({
      dimensions: [this.elevationGrid.width, this.elevationGrid.height],
      elevationSampler: spriteForShader.texture
      //uElevation: this.elevationGrid._texture
    });
    this.container.filters = [elevationFilter];
    return this.container;
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
      gl_FragColor = elevation;

//       if ( elevation.a > 0.) {
//         gl_FragColor = vec4(1., 0. , 0., 0.8);
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
