/* globals
PIXI,
canvas,
foundry,
CONFIG
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { FRAGMENT_FUNCTIONS, pointCircleCoord } from "./lighting.js";
import { Point3d } from "./geometry/3d/Point3d.js";

// In GLSL 2, cannot use dynamic arrays. So set a maximum number of walls for a given light.
// const MAX_NUM_WALLS = 100;
// const MAX_NUM_WALL_ENDPOINTS = MAX_NUM_WALLS * 2;

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
  uniform vec3 EV_sourceLocation;
  uniform int EV_numWalls;
  uniform int EV_numTerrainWalls;
  uniform vec4 EV_sceneDims;

  // Wall data, in vUvs coordinate space
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

    // Elevation texture spans the scene width/height
    vec2 evTextureCoord = (vTextureCoord - EV_sceneDims.xy) / EV_sceneDims.zw;
    vec4 backgroundElevation = texture2D(EV_elevationSampler, evTextureCoord);
    // vec4 backgroundElevation = texture2D(EV_elevationSampler, EV_textureCoord);
    float pixelElevation = canvasElevationFromPixel(backgroundElevation.r, EV_elevationResolution);

    bool inShadow = false;
    float percentDistanceFromWall;
    int wallsToProcess = EV_numWalls;
    int terrainWallsToProcess = EV_numTerrainWalls;

    if ( vUvs.x < sceneLeft
      || vUvs.x > sceneRight
      || vUvs.y < sceneTop
      || vUvs.y > sceneBottom
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

    vec3 pixelLocation = vec3(vUvs.xy, pixelElevation);
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
    const vShader = ShadowShader.vertexShader;
    const defines =
`
  #define MAX_NUM_WALLS ${CONFIG[MODULE_ID].maxShaderWalls}
  #define MAX_NUM_WALL_ENDPOINTS ${CONFIG[MODULE_ID].maxShaderWalls * 2}
`;
    const fShader = defines + ShadowShader.fragmentShader;

    const program = ShadowShader.#program ??= PIXI.Program.from(
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
    uniforms.EV_sourceLocation = [0.5, 0.5, source.elevationZ * 0.5 * r_inv];

    // Alternative version using vUvs, given that light source mesh have no rotation
    // https://ptb.discord.com/channels/732325252788387980/734082399453052938/1010999752030171136

    uniforms.EV_transform = [
      radius * 2 / width,
      radius * 2 / height,
      (x - radius) / width,
      (y - radius) / height
    ];

    // Construct wall data
    // const center = {x, y};
    // const center_shader = {x: 0.5, y: 0.5};
    let heightWalls = source.los._elevatedvision?.heightWalls || new Set();
    let terrainWalls = source.los._elevatedvision?.terrainWalls || new Set();

    // Sort the walls from distance to the origin point
    // This should help when the maximum wall limit is reached.
    const originPt = {x, y};
    heightWalls = [...heightWalls];
    terrainWalls = [...terrainWalls]

    heightWalls.forEach(w => {
      const pt = foundry.utils.closestPointToSegment(originPt, w.A, w.B);
      w._distance2 = PIXI.Point.distanceSquaredBetween(originPt, pt);
    });
    terrainWalls.forEach(w => {
      const pt = foundry.utils.closestPointToSegment(originPt, w.A, w.B);
      w._distance2 = PIXI.Point.distanceSquaredBetween(originPt, pt);
    });

    heightWalls.sort((a, b) => a._distance2 - b._distance2);
    terrainWalls.sort((a, b) => a._distance2 - b.distance2);

    let terrainWallCoords = [];
    let terrainWallDistances = [];
    const numWalls = CONFIG[MODULE_ID].numShaderWalls;
    for ( const w of terrainWalls.slice(0, numWalls) ) {
      addWallDataToShaderArrays(w, terrainWallDistances, terrainWallCoords, source, r_inv);
    }
    uniforms.EV_numTerrainWalls = terrainWallDistances.length;

    if ( !terrainWallCoords.length ) terrainWallCoords = [0, 0, 0, 0, 0, 0];
    if ( !terrainWallDistances.length ) terrainWallDistances = [0];

    uniforms.EV_terrainWallCoords = terrainWallCoords;
    uniforms.EV_terrainWallDistances = terrainWallDistances;


    let wallCoords = [];
    let wallDistances = [];
    for ( const w of heightWalls.slice(0, numWalls) ) {
      addWallDataToShaderArrays(w, wallDistances, wallCoords, source, r_inv);
    }

    uniforms.EV_numWalls = wallDistances.length;

    if ( !wallCoords.length ) wallCoords = [0, 0, 0, 0, 0, 0];
    if ( !wallDistances.length ) wallDistances = [0];

    uniforms.EV_wallCoords = wallCoords;
    uniforms.EV_wallDistances = wallDistances;

    const { sceneX, sceneY, sceneWidth, sceneHeight } = canvas.dimensions;
    uniforms.EV_sceneDims = [sceneX, sceneY, sceneWidth, sceneHeight];
  }
}

function addWallDataToShaderArrays(w, wallDistances, wallCoords, source, r_inv = 1 / source.radius) {
  // Because walls are rectangular, we can pass the top-left and bottom-right corners
  const { x, y, radius } = source;
  const center = {x, y};

  const wallPoints = Point3d.fromWall(w, { finite: true });

  const a = pointCircleCoord(wallPoints.A.top, radius, center, r_inv);
  const b = pointCircleCoord(wallPoints.B.bottom, radius, center, r_inv);

  // Point where line from light, perpendicular to wall, intersects
  const center_shader = {x: 0.5, y: 0.5};
  const wallIx = CONFIG.GeometryLib.utils.perpendicularPoint(a, b, center_shader);
  if ( !wallIx ) return; // Likely a and b not proper wall
  const wallOriginDist = PIXI.Point.distanceBetween(center_shader, wallIx);
  wallDistances.push(wallOriginDist);

  wallCoords.push(a.x, a.y, a.z, b.x, b.y, b.z);
}
