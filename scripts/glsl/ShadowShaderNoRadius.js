/* globals
CONFIG,
foundry,
PIXI
*/
"use strict";

import { MODULE_ID } from "../const.js";
import { FRAGMENT_FUNCTIONS } from "../lighting.js";

import { shadowUniforms } from "./shader_uniforms.js";

// In GLSL 2, cannot use dynamic arrays. So set a maximum number of walls for a given light.
// const MAX_NUM_WALLS = 100;
// const MAX_NUM_WALL_ENDPOINTS = MAX_NUM_WALLS * 2;

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
  varying vec2 vTextureCoord;
  uniform sampler2D sampler;
  uniform float alphaThreshold;
  uniform float depthElevation;

  ${FRAGMENT_FUNCTIONS}

  // EV-specific variables
  uniform sampler2D EV_elevationSampler;
  uniform vec4 EV_elevationResolution;
  uniform vec3 EV_sourceLocation;
  uniform int EV_numWalls;
  uniform int EV_numTerrainWalls;
  uniform vec4 EV_sceneDims;

  varying vec2 vEVTextureCoord;

  // Wall data, in coordinate space
  uniform vec3 EV_wallCoords[MAX_NUM_WALL_ENDPOINTS];
  uniform float EV_wallDistances[MAX_NUM_WALLS];
  uniform vec3 EV_terrainWallCoords[MAX_NUM_WALL_ENDPOINTS];
  uniform float EV_terrainWallDistances[MAX_NUM_WALLS];

  void main() {
    if ( texture2D(sampler, vTextureCoord).a <= alphaThreshold ) {
      discard;
    }

    float sceneLeft = EV_sceneDims.x;
    float sceneTop = EV_sceneDims.y;
    float sceneWidth = EV_sceneDims.z;
    float sceneHeight = EV_sceneDims.w;
    float sceneRight = sceneLeft + sceneWidth;
    float sceneBottom = sceneTop + sceneHeight;

    // Elevation texture spans the scene width/height.
    vec2 evTextureCoord = (vTextureCoord - EV_sceneDims.xy) / EV_sceneDims.zw;
    vec4 backgroundElevation = texture2D(EV_elevationSampler, evTextureCoord);
    //vec4 backgroundElevation = texture2D(EV_elevationSampler, vEVTextureCoord);
    float pixelElevation = canvasElevationFromPixel(backgroundElevation.r, EV_elevationResolution);

    bool inShadow = false;
    float percentDistanceFromWall;
    int wallsToProcess = EV_numWalls;
    int terrainWallsToProcess = EV_numTerrainWalls;


    if ( vTextureCoord.x < sceneLeft
      || vTextureCoord.x > sceneRight
      || vTextureCoord.y < sceneTop
      || vTextureCoord.y > sceneBottom
      || EV_sourceLocation.z < EV_elevationResolution.r  ) {

      // Skip if we are outside the scene boundary or under minimum scene elevation
      wallsToProcess = 0;
      terrainWallsToProcess = 0;
    } else if ( pixelElevation > EV_sourceLocation.z ) {

      // Pixel higher than source; automatically shadow.
      inShadow = true;
      wallsToProcess = 0;
      terrainWallsToProcess = 0;
    }

    vec3 pixelLocation = vec3(vTextureCoord.xy, pixelElevation);
    for ( int i = 0; i < MAX_NUM_WALLS; i++ ) {
      if ( i >= wallsToProcess ) break;

      vec3 wallTL = EV_wallCoords[i * 2];
      vec3 wallBR = EV_wallCoords[(i * 2) + 1];

      bool thisWallInShadow = locationInWallShadow(
        wallTL,
        wallBR,
        EV_wallDistances[i],
        EV_sourceLocation,
        pixelLocation,
        percentDistanceFromWall
      );

      if ( thisWallInShadow ) {
        // Current location is within shadow of this wall
        inShadow = true;
        break;
      }
    }

    // If terrain walls are present, see if at least 2 walls block this pixel from the light.
    if ( !inShadow && terrainWallsToProcess > 1 ) {
      bool terrainWallShadows = false;
      for ( int j = 0; j < MAX_NUM_WALLS; j++ ) {
        if ( j >= terrainWallsToProcess ) break;

        vec3 terrainWallTL = EV_terrainWallCoords[j * 2];
        vec3 terrainWallBR = EV_terrainWallCoords[(j * 2) + 1];

        bool thisTerrainWallInShadow = locationInWallShadow(
          terrainWallTL,
          terrainWallBR,
          EV_terrainWallDistances[j],
          EV_sourceLocation,
          pixelLocation,
          percentDistanceFromWall
        );

        if ( thisTerrainWallInShadow && terrainWallShadows ) {
          inShadow = true;
        }

        if ( thisTerrainWallInShadow ) {
          terrainWallShadows = true;
        }
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
    const vShader = ShadowShaderNoRadius.vertexShader;
    const defines =
`
  #define MAX_NUM_WALLS ${CONFIG[MODULE_ID].maxShaderWalls}
  #define MAX_NUM_WALL_ENDPOINTS ${CONFIG[MODULE_ID].maxShaderWalls * 2}
`;
    const fShader = defines + ShadowShaderNoRadius.fragmentShader;

    const program = ShadowShaderNoRadius.#program ??= PIXI.Program.from(
      vShader,
      fShader
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
    shadowUniforms(source, false, this.uniforms);
  }
}
