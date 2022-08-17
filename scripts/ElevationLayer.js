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

    // Create the effect and begin playback
//     if ( !this.elevationGridContainer ) {
      const w = new FullCanvasContainer();
//       const w = new PIXI.Container();
//       w.width = this.elevationGrid.width;
//       w.height = this.elevationGrid.height;
//       this.filterArea =
      this.elevationGridContainer = this.addChild(w);
//     }

    const { width, height } = this.elevationGrid;

    this.geometry = new PIXI.Geometry()
      .addAttribute("aVertexPosition",
        [0, 0,
         width, 0,
         width, height,
         0, height], 2)
      .addAttribute("aUvs",
        [0, 0,
         1, 0,
         1, 1,
         0, 1], 2)
      .addIndex([0, 1, 2, 0, 2, 3]);

    this.shader = ColorAdjustmentsSamplerShader.create({ tintAlpha: [.1, 1, 0, .8] });
    const quad = new PIXI.Mesh(this.geometry, this.shader);

    quad.position.set(0, 0);
    w.addChild(quad);
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

  varying vec2 vTextureCoord;
  varying vec3 tPos;
  varying vec2 vSamplerUvs;

  uniform vec4 inputSize;
  uniform vec4 outputFrame;
  uniform vec2 screenDimensions;

  vec4 filterVertexPosition( void )
  {
      vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.)) + outputFrame.xy;

      return vec4((projectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
  }

  vec2 filterTextureCoord( void )
  {
      return aVertexPosition * (outputFrame.zw * inputSize.zw);
  }

  void main(void)
  {
      gl_Position = filterVertexPosition();
      vTextureCoord = filterTextureCoord();
      tPos = vec3(aVertexPosition, 1.0);
      vSamplerUvs = tPos.xy / screenDimensions;
  }
  `

  static fragmentShader = `
    varying vec2 vTextureCoord;
    uniform sampler2D uSampler;
    varying vec2 vSamplerUvs;

    void main() {
      vec4 tex = texture2D(uSampler, vTextureCoord);
      if ( vSamplerUvs.x > 1000.) {
        gl_FragColor = vec4(1., 0. , 0., 1.);
      } else {
        gl_FragColor = tex;
      }
    }
  `
}

class ColorAdjustmentFilter extends AbstractBaseFilter {
  static defaultUniforms = {
    gamma: 1,
    saturation: 1,
    contrast: 1,
    brightness: 1,
    red: 1,
    green: 1,
    blue: 1,
    alpha: 1,
  }

  static fragmentShader = `
    varying vec2 vTextureCoord;
    uniform sampler2D uSampler;

    uniform float gamma;
    uniform float contrast;
    uniform float saturation;
    uniform float brightness;
    uniform float red;
    uniform float green;
    uniform float blue;
    uniform float alpha;

    void main(void)
    {
        vec4 c = texture2D(uSampler, vTextureCoord);

        if (c.a > 0.0) {
            c.rgb /= c.a;

            float g = max(0.0001, gamma);

            vec3 rgb = pow(c.rgb, vec3(1. / g));
            rgb = mix(vec3(.5), mix(vec3(dot(vec3(.2125, .7154, .0721), rgb)), rgb, saturation), contrast);
            rgb.r *= red;
            rgb.g *= green;
            rgb.b *= blue;
            c.rgb = rgb * brightness;

            c.rgb *= c.a;
        }

        gl_FragColor = c * alpha;
    }
  `

}

class ElevationFilter extends AbstractBaseFilter {
  static defaultUniforms = {

  };


  static fragmentShader = `


  `

}


/*
renderer = canvas.app.renderer
gl = renderer.gl;

*/
