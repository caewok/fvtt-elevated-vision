/* globals
PIXI,
foundry
*/
"use strict";

import { GLSL, updateUniformsForSource } from "./Shadow_GLSL.js";

export let FRAGMENT_FUNCTIONS = "";
for ( const fn of GLSL.FUNCTIONS ) {
  FRAGMENT_FUNCTIONS += fn.string;
}

export let UNIFORMS = "";
for ( const uniform of GLSL.UNIFORMS ) {
  const { name, type } = uniform;
  UNIFORMS += `uniform ${type} ${name};\n`;
}


export class ShadowShader extends PIXI.Shader {
  static vertexShader = `
  attribute vec2 aVertexPosition;
  uniform mat3 projectionMatrix;
  uniform mat3 translationMatrix;
  uniform mat3 textureMatrix;
  varying vec2 vTextureCoord;

  ${UNIFORMS}
  // EV-specific variables
  varying vec2 EV_textureCoord;
  varying vec2 EV_pixelXY;

  void main() {
    // EV-specific calcs
    vec3 tPos = translationMatrix * vec3(aVertexPosition, 1.0);
    vec2 vUvs = aVertexPosition * 0.5 + 0.5;
    EV_textureCoord = EV_transform.xy * vUvs + EV_transform.zw;
    // TO-DO: drop vUvs and just use aVertexPosition?

    EV_pixelXY = vec2(vUvs.xy);

    vTextureCoord = (textureMatrix * vec3(aVertexPosition, 1.0)).xy;
    gl_Position = vec4((projectionMatrix * (translationMatrix * vec3(aVertexPosition, 1.0))).xy, 0.0, 1.0);
  }
  `;

  static fragmentShader = `

  varying vec2 vTextureCoord;
  uniform sampler2D sampler;
  uniform float alphaThreshold;
  uniform float depthElevation;

  ${FRAGMENT_FUNCTIONS}

  // EV-specific variables
  varying vec2 EV_textureCoord;
  varying vec2 EV_pixelXY;

  ${UNIFORMS}

  void main() {
    if ( texture2D(sampler, vTextureCoord).a <= alphaThreshold ) {
      discard;
    }

    // Pull the pixel elevation from the Elevated Vision elevation texture
    vec4 backgroundElevation = texture2D(EV_elevationSampler, EV_textureCoord);
    float pixelElevation = canvasElevationFromPixel(backgroundElevation.r, EV_elevationResolution);
    vec3 pixelLocation = vec3(EV_pixelXY.x, EV_pixelXY.y, pixelElevation);

    bool inShadow = pixelInShadow(
      pixelLocation,
      EV_sourceLocation,
      EV_wallCoords,
      EV_numWalls,
      EV_numTerrainWalls
    );

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

  static _program;

  static create(defaultUniforms = {}) {
    const program = this._program ??= PIXI.Program.from(
      this.vertexShader,
      this.fragmentShader
    );

    for ( const uniform of GLSL.UNIFORMS ) {
      const { name, initial } = uniform;
      defaultUniforms[name] = initial;
    }

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
    updateUniformsForSource(this.uniforms, source, { useRadius: true });
  }
}
