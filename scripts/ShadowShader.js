/* globals
PIXI,
canvas,
foundry
*/
"use strict";

import { FRAGMENT_FUNCTIONS, pointCircleCoord } from "./lighting.js";

// In GLSL 2, cannot use dynamic arrays. So set a maximum number of walls for a given light.
const MAX_NUM_WALLS = 100;

export class ShadowShader extends PIXI.Shader {
  static vertexShader = `
  attribute vec2 aVertexPosition;
  uniform mat3 projectionMatrix;
  uniform mat3 translationMatrix;
  uniform mat3 textureMatrix;
  varying vec2 vTextureCoord;

  // EV-specific variables
  uniform vec4 EV_transform;
  varying vec2 vUvs;
  varying vec2 vSamplerUvs;
  varying vec2 EV_textureCoord;

  void main() {
    // EV-specific calcs
    vec3 tPos = translationMatrix * vec3(aVertexPosition, 1.0);
    vUvs = aVertexPosition * 0.5 + 0.5;
    EV_textureCoord = EV_transform.xy * vUvs + EV_transform.zw;
    // TO-DO: drop vUvs and just use aVertexPosition?

    vTextureCoord = (textureMatrix * vec3(aVertexPosition, 1.0)).xy;
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
  varying vec2 EV_textureCoord;
  varying vec2 vUvs;
  uniform sampler2D EV_elevationSampler;
  uniform vec4 EV_elevationResolution;
  uniform float EV_sourceElevation;
  uniform int EV_numWalls;

  // Wall data, in vUvs coordinate space
  uniform vec4 EV_wallCoords[MAX_NUM_WALLS];
  uniform float EV_wallElevations[MAX_NUM_WALLS];
  uniform float EV_wallDistances[MAX_NUM_WALLS];

  // Defined constants
  const vec2 center = vec2(0.5);

  void main() {
    if ( texture2D(sampler, vTextureCoord).a <= alphaThreshold ) {
      discard;
    }

    vec4 backgroundElevation = texture2D(EV_elevationSampler, EV_textureCoord);
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
        center,
        pixelCanvasElevation,
        vUvs,
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
    const program = ShadowShader.#program ??= PIXI.Program.from(
      ShadowShader.vertexShader,
      ShadowShader.fragmentShader
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

    // To avoid a bug in PolygonMesher and because ShadowShader assumes normalized geometry
    // based on radius, set radius to 1 if radius is 0.
    const radius = source.radius || 1;

    const r_inv = 1 / radius;

    uniforms.EV_elevationSampler = canvas.elevation?._elevationTexture || PIXI.Texture.EMPTY;

    // [min, step, maxPixValue, canvasMult]
    const elevationMult = size * (1 / distance) * 0.5 * r_inv;
    uniforms.EV_elevationResolution = [elevationMin, elevationStep, maximumPixelValue, elevationMult];

    // Uniforms based on source
    uniforms.EV_sourceElevation = source.elevationZ * 0.5 * r_inv;

    // Alternative version using vUvs, given that light source mesh have no rotation
    // https://ptb.discord.com/channels/732325252788387980/734082399453052938/1010999752030171136

    uniforms.EV_transform = [
      radius * 2 / width,
      radius * 2 / height,
      (x - radius) / width,
      (y - radius) / height
    ];

    // Construct wall data
    const center = {x, y};
    const center_shader = {x: 0.5, y: 0.5};
    const walls = source.los.wallsBelowSource || new Set();
    let wallCoords = [];
    let wallElevations = [];
    let wallDistances = [];
    for ( const w of walls ) {
      const a = pointCircleCoord(w.A, radius, center, r_inv);
      const b = pointCircleCoord(w.B, radius, center, r_inv);

      // Point where line from light, perpendicular to wall, intersects
      const wallIx = CONFIG.GeometryLib.utils.perpendicularPoint(a, b, center_shader);
      if ( !wallIx ) continue; // Likely a and b not proper wall.

      const wallOriginDist = PIXI.Point.distanceBetween(center_shader, wallIx);
      wallDistances.push(wallOriginDist);
      wallElevations.push(w.topZ * 0.5 * r_inv);
      wallCoords.push(a.x, a.y, b.x, b.y);
    }

    uniforms.EV_numWalls = wallElevations.length;

    if ( !wallCoords.length ) wallCoords = new Float32Array(MAX_NUM_WALLS*4);
    if ( !wallElevations.length ) wallElevations = new Float32Array(MAX_NUM_WALLS);
    if ( !wallDistances.length ) wallDistances = new Float32Array(MAX_NUM_WALLS);

    uniforms.EV_wallCoords = wallCoords;
    uniforms.EV_wallElevations = wallElevations;
    uniforms.EV_wallDistances = wallDistances;
  }
}
