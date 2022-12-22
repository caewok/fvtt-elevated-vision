/* globals
PIXI,
canvas,
foundry
*/
"use strict";

import { FRAGMENT_FUNCTIONS } from "./lighting.js";
import { Point3d } from "./geometry/3d/Point3d.js";

// In GLSL 2, cannot use dynamic arrays. So set a maximum number of walls for a given light.
const MAX_NUM_WALLS = 100;
const MAX_NUM_WALL_ENDPOINTS = MAX_NUM_WALLS * 2;

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
  #define MAX_NUM_WALL_ENDPOINTS ${MAX_NUM_WALL_ENDPOINTS}

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

    vec4 backgroundElevation = texture2D(EV_elevationSampler, vEVTextureCoord);
    float pixelElevation = canvasElevationFromPixel(backgroundElevation.r, EV_elevationResolution);

    bool inShadow = false;
    float percentDistanceFromWall;
    int wallsToProcess = EV_numWalls;
    int terrainWallsToProcess = EV_numTerrainWalls;

    if ( pixelElevation > EV_sourceLocation.z ) {
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
    uniforms.EV_sourceLocation = [x, y, source.elevationZ];

    // Construct wall data
    const center = {x, y};
    const heightWalls = source.los._elevatedvision?.heightWalls || new Set();
    const terrainWalls = source.los._elevatedvision?.terrainWalls || new Set();

    let terrainWallCoords = [];
    let terrainWallDistances = [];
    for ( const w of terrainWalls ) {
      addWallDataToShaderArrays(w, terrainWallDistances, terrainWallCoords, source)
    }
    uniforms.EV_numTerrainWalls = terrainWallDistances.length;

    if ( !terrainWallCoords.length ) terrainWallCoords = [0, 0, 0, 0, 0, 0];
    if ( !terrainWallDistances.length ) terrainWallDistances = [0];

    uniforms.EV_terrainWallCoords = terrainWallCoords;
    uniforms.EV_terrainWallDistances = terrainWallDistances;

    let wallCoords = [];
    let wallDistances = [];
    for ( const w of heightWalls ) {
      addWallDataToShaderArrays(w, wallDistances, wallCoords, source);
    }

    uniforms.EV_numWalls = wallDistances.length;

    if ( !wallCoords.length ) wallCoords = [0, 0, 0, 0, 0, 0];
    if ( !wallDistances.length ) wallDistances = [0];

    uniforms.EV_wallCoords = wallCoords;
    uniforms.EV_wallDistances = wallDistances;
    uniforms.EV_center = [center.x, center.y];
    uniforms.EV_canvasDims = [width, height];
  }
}

function addWallDataToShaderArrays(w, wallDistances, wallCoords, source) {
  // Because walls are rectangular, we can pass the top-left and bottom-right corners
  const { x, y } = source;
  const center = {x, y};

  const wallPoints = Point3d.fromWall(w, { finite: true });

  const a = wallPoints.A.top;
  const b = wallPoints.B.bottom;

  // Point where line from light, perpendicular to wall, intersects
  const center_shader = {x: 0.5, y: 0.5};
  const wallIx = CONFIG.GeometryLib.utils.perpendicularPoint(a, b, center);
  if ( !wallIx ) return; // Likely a and b not proper wall
  const wallOriginDist = PIXI.Point.distanceBetween(center, wallIx);
  wallDistances.push(wallOriginDist);

  wallCoords.push(a.x, a.y, a.z, b.x, b.y, b.z);
}
