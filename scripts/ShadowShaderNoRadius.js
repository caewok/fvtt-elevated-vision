/* globals
PIXI,
canvas,
foundry
*/
"use strict";

import { perpendicularPoint, distanceBetweenPoints } from "./util.js";
import { FRAGMENT_FUNCTIONS } from "./lighting.js";

// In GLSL 2, cannot use dynamic arrays. So set a maximum number of walls for a given light.
const MAX_NUM_WALLS = 100;

export class ShadowShaderNoRadius extends PIXI.Shader {
  static vertexShader = `
  attribute vec2 aVertexPosition;
  uniform mat3 projectionMatrix;
  uniform mat3 translationMatrix;
  uniform mat3 textureMatrix;
  uniform vec2 EV_canvasDims;
  varying vec2 vTextureCoord;
  varying vec2 vEVTextureCoord;

  void main() {
    vTextureCoord = (textureMatrix * vec3(aVertexPosition, 1.0)).xy;
    vEVTextureCoord = vTextureCoord / EV_canvasDims;
    gl_Position = vec4((projectionMatrix * (translationMatrix * vec3(aVertexPosition, 1.0))).xy, 0.0, 1.0);
  }
  `;

  static fragmentShader = `
  #define MAX_NUM_WALLS ${MAX_NUM_WALLS}

  varying vec2 vTextureCoord;
  uniform sampler2D sampler;
  uniform float alphaThreshold;
  uniform float depthElevation;

  ${FRAGMENT_FUNCTIONS}

  // EV-specific variables
  uniform sampler2D EV_elevationSampler;
  uniform vec4 EV_elevationResolution;
  uniform float EV_sourceElevation;
  uniform int EV_numWalls;
  uniform vec2 EV_center;
  varying vec2 vEVTextureCoord;

  // Wall data, in coordinate space
  uniform vec4 EV_wallCoords[MAX_NUM_WALLS];
  uniform float EV_wallElevations[MAX_NUM_WALLS];
  uniform float EV_wallDistances[MAX_NUM_WALLS];



  void main() {
    if ( texture2D(sampler, vTextureCoord).a <= alphaThreshold ) {
      discard;
    }

    vec4 backgroundElevation = texture2D(EV_elevationSampler, vEVTextureCoord);
    float pixelCanvasElevation = canvasElevationFromPixel(backgroundElevation.r, EV_elevationResolution);
    bool inShadow = false;
    float percentDistanceFromWall;
    int wallsToProcess = EV_numWalls;

    if ( pixelCanvasElevation > EV_sourceElevation ) {
        inShadow = true;
        wallsToProcess = 0;
    }

    for ( int i = 0; i < MAX_NUM_WALLS; i++ ) {
      if ( i >= wallsToProcess ) break;

      bool thisWallInShadow = locationInWallShadow(
        EV_wallCoords[i],
        EV_wallElevations[i],
        EV_wallDistances[i],
        EV_sourceElevation,
        EV_center,
        pixelCanvasElevation,
        vTextureCoord,
        percentDistanceFromWall
      );

      if ( thisWallInShadow ) {
        // Current location is within shadow of this wall
        inShadow = true;
        break;
      }
    }

    if ( inShadow ) {
      discard;
    } else {
      gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
    }
  }
  `;

  static defaultUniforms = {
    sampler: PIXI.Texture.WHITE,
    textureMatrix: PIXI.Matrix.IDENTITY,
    alphaThreshold: 0.75,
    depthElevation: 0
  };

  static #program;

  static create(defaultUniforms = {}) {
    const program = ShadowShaderNoRadius.#program ??= PIXI.Program.from(
      ShadowShaderNoRadius.vertexShader,
      ShadowShaderNoRadius.fragmentShader
    );
    const uniforms = foundry.utils.mergeObject(
      this.defaultUniforms,
      defaultUniforms,
      { inplace: false, insertKeys: false }
    );

    return new this(program, uniforms);
  }

  /**
   * The texture.
   * @type {PIXI.Texture}
   */
  get texture() {
    return this.uniforms.sampler;
  }

  set texture(value) {
    this.uniforms.sampler = value;
  }

  /**
   * The texture matrix.
   * @type {PIXI.Texture}
   */
  get textureMatrix() {
    return this.uniforms.textureMatrix;
  }

  set textureMatrix(value) {
    this.uniforms.textureMatrix = value;
  }

  /**
   * The alpha threshold.
   * @type {number}
   */
  get alphaThreshold() {
    return this.uniforms.alphaThreshold;
  }

  set alphaThreshold(value) {
    this.uniforms.alphaThreshold = value;
  }

  /**
   * The depth elevation.
   * @type {number}
   */
  get depthElevation() {
    return this.uniforms.depthElevation;
  }

  set depthElevation(value) {
    this.uniforms.depthElevation = value;
  }


  updateUniforms(source) {
    const uniforms = this.uniforms;

    // Screen-space to local coords:
    // https://ptb.discord.com/channels/732325252788387980/734082399453052938/1010914586532261909
    // shader.uniforms.EV_canvasMatrix ??= new PIXI.Matrix();
    // shader.uniforms.EV_canvasMatrix
    //   .copyFrom(canvas.stage.worldTransform)
    //   .invert()
    //   .append(mesh.transform.worldTransform);

    const { elevationMin, elevationStep, maximumPixelValue } = canvas.elevation;
    const { size, distance, width, height } = canvas.dimensions;
    const { x, y } = source;


    uniforms.EV_elevationSampler = canvas.elevation?._elevationTexture || PIXI.Texture.EMPTY;

    // [min, step, maxPixValue, canvasMult]
    const elevationMult = size * (1 / distance);
    uniforms.EV_elevationResolution = [elevationMin, elevationStep, maximumPixelValue, elevationMult];

    // Uniforms based on source
    uniforms.EV_sourceElevation = source.elevationZ;


    // Construct wall data
    const center = {x, y};
    const walls = source.los.wallsBelowSource || new Set();
    let wallCoords = [];
    let wallElevations = [];
    let wallDistances = [];
    for ( const w of walls ) {
      const a = w.A;
      const b = w.B;

      // Point where line from light, perpendicular to wall, intersects
      const wallIx = perpendicularPoint(a, b, center);
      if ( !wallIx ) continue; // Likely a and b not proper wall.

      const wallOriginDist = distanceBetweenPoints(center, wallIx);
      wallDistances.push(wallOriginDist);
      wallElevations.push(w.topZ);
      wallCoords.push(a.x, a.y, b.x, b.y);
    }

    uniforms.EV_numWalls = wallElevations.length;

    if ( !wallCoords.length ) wallCoords = new Float32Array(MAX_NUM_WALLS*4);
    if ( !wallElevations.length ) wallElevations = new Float32Array(MAX_NUM_WALLS);
    if ( !wallDistances.length ) wallDistances = new Float32Array(MAX_NUM_WALLS);

    uniforms.EV_wallCoords = wallCoords;
    uniforms.EV_wallElevations = wallElevations;
    uniforms.EV_wallDistances = wallDistances;
    uniforms.EV_center = [center.x, center.y];
    uniforms.EV_canvasDims = [width, height];
  }
}
