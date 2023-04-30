/* globals
canvas,
CONST,
PIXI
*/
"use strict";

import { Matrix } from "./geometry/Matrix.js";
import { Point3d } from "./geometry/3d/Point3d.js";

import {
  shadowRenderShader,
  depthShader,
  terrainDepthShader } from "./shaders.js";

import {
  perspectiveMatrix,
  orthographicMatrix,
  toColMajorArray } from "./util.js";

/* Testing
// let walls = canvas.walls.placeables;
// let walls = canvas.walls.controlled;

api = game.modules.get("elevatedvision").api
SourceDepthShadowMap = api.SourceDepthShadowMap
Point3d = CONFIG.GeometryLib.threeD.Point3d


lightOrigin = new Point3d(100, 100, 1600);

map = new SourceDepthShadowMap(lightOrigin, { walls });
map._depthTest();
map._endDepthTest();
map._shadowRenderTest();
map._endShadowRenderTest();

// update walls
map._updateWallGeometry(walls);


map = new SourceDepthShadowMap(lightOrigin, { walls });
map._shadowRenderTest();

// view and orthographic matrix for a wall
wall = walls[0]

topA = new Point3d(wall.A.x, wall.A.y, wall.topZ)
topB = new Point3d(wall.B.x, wall.B.y, wall.topZ)
bottomA = new Point3d(wall.A.x, wall.A.y, wall.bottomZ)
bottomB = new Point3d(wall.B.x, wall.B.y, wall.bottomZ)

for ( const v of [topA, topB, bottomA, bottomB] ) {
  const vCamera = map.viewMatrix.multiplyPoint3d(v);
  const vProj = map.projectionMatrix.multiplyPoint3d(vCamera);

  console.log(`(${v.x},${v.y},${v.z})
    --> (${vCamera.x.toPrecision(3)},${vCamera.y.toPrecision(3)},${vCamera.z.toPrecision(3)})
    --> (${vProj.x.toPrecision(3)},${vProj.y.toPrecision(3)},${vProj.z.toPrecision(3)})`);
}

sceneRect = canvas.dimensions.sceneRect
testPoints = [
  new Point3d(100 + sceneRect.x, 100 + sceneRect.y, 0),
  new Point3d(300 + sceneRect.x, 100 + sceneRect.y, 0),
  new Point3d(1400, 900, 100),
  new Point3d(1400, 900, 0),
  new Point3d(1400, 900, -100),
]
for ( const v of testPoints ) {
  const vCamera = map.viewMatrix.multiplyPoint3d(v);
  const vProj = map.projectionMatrix.multiplyPoint3d(vCamera);

  console.log(`(${v.x},${v.y},${v.z})
    --> (${vCamera.x.toPrecision(3)},${vCamera.y.toPrecision(3)},${vCamera.z.toPrecision(3)})
    --> (${vProj.x.toPrecision(3)},${vProj.y.toPrecision(3)},${vProj.z.toPrecision(3)})`);
}

*/

export class SourceDepthShadowMap {
  // TODO: Can we make any of these empty and just update the object?

  #viewMatrix;

  #projectionMatrix;

  #lightPosition;

  #radius;

  #depthMesh;

  #terrainDepthMesh;

  #depthTexture;

  #depthSprite;

  #shadowRender;

  #hasTerrainWalls = false;

  /**
   * Construct a new SourceDepthShadowMap instance.
   * @param {Point3d} lightPosition   Position of the light
   * @param {object} [options]
   * @param {Wall[]} [options.walls]
   * @param {PIXI.Geometry} [options.wallGeometry]
   * @param {boolean} [options.directional]
   */
  constructor(lightPosition, { walls, wallGeometry, directional = true, radius }) {
    // TODO: Use LightSource instead or alternatively allow as an option?
    this.#lightPosition = lightPosition;
    this.directional = directional;

    if ( !directional && typeof radius === "undefined" ) {
      console.error("SourceDepthShadowMap requires radius for point source.");
      this.#radius = canvas.dimensions.size;
    }

    if ( !wallGeometry ) {
      walls ??= canvas.walls.placeables;
      this.wallGeometry = new PIXI.Geometry();
      this.wallGeometry.addAttribute("aVertexPosition", [], 3);
      this.wallGeometry.addAttribute("aTerrain", [], 1);
      this.wallGeometry.addIndex([]);
    } else {
      this.wallGeometry = wallGeometry;

      // Confirm we have a valid geometry
      if ( !Object.hasOwn(wallGeometry.attributes, "aVertexPosition") ) {
        console.error("SourceDepthShadowMap|wallGeometry has no aVertexPosition.");
        this.wallGeometry.addAttribute("aVertexPosition", [], 3);
      }

      if ( !Object.hasOwn(wallGeometry.attributes, "aTerrain") ) {
        console.error("SourceDepthShadowMap|wallGeometry has no aTerrain.");
        this.wallGeometry.addAttribute("aTerrain", [], 1);
      }

      if ( !wallGeometry.indexBuffer ) {
        console.error("SourceDepthShadowMap|wallGeometry has no index.");
        this.wallGeometry.addIndex([]);
      }
    }

    if ( walls ) this._updateWallGeometry(walls);
  }

  // Getters / Setters

  /** @type {Matrix} */
  get viewMatrix() {
    return this.#viewMatrix || (this.#viewMatrix = this._constructViewMatrix());
  }

  /** @type {Matrix} */
  get projectionMatrix() {
    this.#projectionMatrix ??= this.directional
      ? this._constructOrthogonalMatrix() : this._constructPerspectiveMatrix();

    return this.#projectionMatrix;
  }

  /** @type {Point3d} */
  get lightPosition() { return this.#lightPosition; }

  set lightPosition(value) {
    this._resetLight();
    this.#lightPosition = value.copy();

    if ( !this.directional ) {
      console.error("Not yet implemented.");
      // Need to refilter walls based on light radius and update wall geometry
    }
  }

  /** @type {number} */
  get radius() { return this.#radius; }

  set radius(value) {
    this._resetLight();
    this.#radius = value;
  }

  /** @type {PIXI.Mesh} */
  get depthMesh() {
    return this.#depthMesh || (this.#depthMesh = this._constructDepthMesh("depthShader"));
  }

  /** @type {PIXI.Mesh} */
  get terrainDepthMesh() {
    return this.#terrainDepthMesh || (this.#terrainDepthMesh = this._constructDepthMesh("terrainDepthShader"));
  }

  /** @type {PIXI.Texture} */
  get depthTexture() {
    return this.#depthTexture || (this.#depthTexture = this._renderDepth());
  }

  /** @type {number} */
  get minElevation() {
    const elevationMin = canvas.elevation.elevationMin;
    return (this.lightPosition.z > elevationMin)
      ? elevationMin : this.lightPosition.z - canvas.dimensions.size;
  }

  /**
   * Reset all cached variables related to light.
   * TODO: distinguish between position, elevation, and type?
   */
  _resetLight() {
    // #lightPosition?
    // #radius?
    this.#viewMatrix = undefined; // Defined by light position.
    this._resetDepth();
  }

  /**
   * Reset all cached variables related to walls.
   */
  _resetWalls() {
    // TODO: Make this an empty matrix instead and fill it? Same for #viewMatrix?
    // TODO: Do we need to destroy or update the texture, mesh, sprite?
    this.#hasTerrainWalls = false;
    this.#projectionMatrix = undefined; // Requires wall elevations.
    this._resetDepth();
  }

  /**
   * Reset all cached variables related to depth.
   */
  _resetDepth() {
    this.#depthMesh = undefined; // Requires viewM and projectionM
    this.#terrainDepthMesh = undefined; // Requires viewM and projectionM
    this.#depthTexture = undefined; // Requires depthMesh
    this.#depthSprite = undefined;  // Based on depthTexture
    this.#shadowRender = undefined; // Based on depthTexture
  }

  /**
   * Build the wall coordinates and indices from an array of walls.
   * @param {Wall[]} walls
   * @returns {object} { coordinates: {Number[]}, indices: {Number[]}}
   */
  _constructWallCoordinates(walls) {
    let hasTerrainWalls = false;

    // TODO: Filter walls for given light source type and, for point source, the radius?
    // TODO: Vary according to source type
    walls = walls.filter(w => w.document["light"] !== CONST.WALL_SENSE_TYPES.NONE);

    const nWalls = walls.length;
    const coordinates = new Float32Array(nWalls * 12); // Coords: x,y,z for top and bottom A, top and bottom B
    const indices = new Uint16Array(nWalls * 6); // 2 triangles to form a square
    const terrain = new Float32Array(nWalls * 4); // 1 per wall coordinate

    // Need to cut off walls at the top/bottom bounds of the scene, otherwise they
    // will be given incorrect depth values b/c there is no floor or ceiling.
    const maxElevation = this.lightPosition.z;
    const minElevation = this.minElevation;

    for ( let w = 0, j = 0, idx = 0, i = 0; w < nWalls; w += 1, j += 12, idx += 6, i += 4 ) {
      const wall = walls[w];
      const topZ = Math.min(maxElevation, wall.topZ);
      const bottomZ = Math.max(minElevation, wall.bottomZ);
      if ( topZ <= bottomZ ) continue; // Wall is above or below the viewing box.

      // Even vertex (0) is bottom A
      coordinates[j] = wall.A.x;
      coordinates[j + 1] = wall.A.y;
      coordinates[j + 2] = bottomZ;

      // Odd vertex (1) is top A
      coordinates[j + 3] = wall.A.x;
      coordinates[j + 4] = wall.A.y;
      coordinates[j + 5] = topZ;

      // Even vertex (2) is bottom B
      coordinates[j + 6] = wall.B.x;
      coordinates[j + 7] = wall.B.y;
      coordinates[j + 8] = bottomZ;

      // Odd vertex (3) is top B
      coordinates[j + 9] = wall.B.x;
      coordinates[j + 10] = wall.B.y;
      coordinates[j + 11] = topZ;

      // Indices are [0, 1, 2, 1, 3, 2]
      // aBottom -- aTop -- bBottom, aTop -- bTop -- bBottom
      indices[idx] = i;
      indices[idx + 1] = i + 1;
      indices[idx + 2] = i + 2;
      indices[idx + 3] = i + 1;
      indices[idx + 4] = i + 3;
      indices[idx + 5] = i + 2;

      // Check for terrain walls and mark accordingly
      // TODO: Vary according to source type
      const isTerrain = wall.document["light"] === CONST.WALL_SENSE_TYPES.LIMITED;
      terrain[i] = isTerrain;
      terrain[i + 1] = isTerrain;
      terrain[i + 2] = isTerrain;
      terrain[i + 3] = isTerrain;
      hasTerrainWalls ||= isTerrain;
    }
    return { coordinates, indices, terrain, hasTerrainWalls };
  }

  /**
   * Update the wall geometry and reset cached matrices.
   * @param {Wall[]} walls
   */
  _updateWallGeometry(walls) {
    this._resetWalls();
    const { coordinates, indices, terrain, hasTerrainWalls } = this._constructWallCoordinates(walls);
    this.#hasTerrainWalls = hasTerrainWalls;

    // Update the buffer attributes and index.
    this.wallGeometry.getBuffer("aVertexPosition").update(coordinates);
    this.wallGeometry.getBuffer("aTerrain").update(terrain);
    this.wallGeometry.getIndex().update(indices);

    // TODO: Make this an empty matrix instead and fill it? Same for #viewMatrix?
    // TODO: Do we need to destroy or update the texture, mesh, sprite?
    this.#projectionMatrix = undefined;
    this.#depthMesh = undefined;
    this.#depthTexture = undefined;
    this.#depthSprite = undefined;
    this.#shadowRender = undefined;
  }

  /**
   * Build the view matrix from light to:
   * - Directional: center of scene
   * - Point source: directly down to the canvas
   * @returns {Matrix}
   */
  _constructViewMatrix() {
    const lightPosition = this.lightPosition;

    // If the light is under or equal to minimum elevation, look down one grid unit.
    const sceneElevation = this.lightPosition.z > canvas.elevation.elevationMin
      ? canvas.elevation.elevationMin
      : lightPosition.z - canvas.dimensions.size;

    const target = this.directional
      ? new Point3d(canvas.dimensions.width * 0.5, canvas.dimensions.height * 0.5, sceneElevation)
      : new Point3d(lightPosition.x, lightPosition.y, sceneElevation);

    return Matrix.lookAt(lightPosition, target, new Point3d(0, 0, -1)).Minv;
  }

  /**
   * Build an orthogonal projection matrix.
   * @returns {Matrix}
   */
  _constructOrthogonalMatrix() {
    const pts = this._boundaryPoints();

    // Get the min/max for the sceneCameraPoints
    const cameraPoints = pts.map(pt => this.viewMatrix.multiplyPoint3d(pt));
    const xMinMax = Math.minMax(...cameraPoints.map(pt => pt.x));
    const yMinMax = Math.minMax(...cameraPoints.map(pt => pt.y));
    const zMinMax = Math.minMax(...cameraPoints.map(pt => pt.z));
    return SourceDepthShadowMap.orthographicMatrix(
      xMinMax.min, xMinMax.max,
      yMinMax.min, yMinMax.max,
      -zMinMax.max, -zMinMax.min);
  }

  /**
   * Build a perspective projection matrix
   * @returns {Matrix}
   */
  _constructPerspectiveMatrix() {
    const pts = this._boundaryPoints();

    // Get the min/max for the sceneCameraPoints
    const cameraPoints = pts.map(pt => this.viewMatrix.multiplyPoint3d(pt));
    const xMinMax = Math.minMax(...cameraPoints.map(pt => pt.x));
    const yMinMax = Math.minMax(...cameraPoints.map(pt => pt.y));
    const zMinMax = Math.minMax(...cameraPoints.map(pt => pt.z));
    return SourceDepthShadowMap.perspectiveMatrix(
      xMinMax.min, xMinMax.max,
      yMinMax.min, yMinMax.max,
      -zMinMax.max, -zMinMax.min);
  }

  /**
   * Get the points representing the edge of the boundary volume for the depth render.
   * Orthographic: based on scene
   * Perspective: based on light-radius cylinder
   * @returns {Point3d[]}
   */
  _boundaryPoints() {
    const { lightPosition, radius } = this;

    const coordinates = this.wallGeometry.getBuffer("aVertexPosition").data;
    const zCoords = coordinates.filter((e, i) => (i + 1) % 3 === 0);
    const maxElevation = Math.min(Math.max(...zCoords), this.lightPosition.z); // Don't care about what is above the light
    const minElevation = this.minElevation;

    let { top, bottom, left, right } = canvas.dimensions.sceneRect;
    if ( !this.directional ) {
      top = lightPosition.y - radius;
      bottom = lightPosition.y + radius;
      right = lightPosition.x - radius;
      left = lightPosition.x + radius;
    }

    const bounds = [
      // Top
      new Point3d(left, top, maxElevation), // TL
      new Point3d(right, top, maxElevation), // TR
      new Point3d(right, bottom, maxElevation), // BR
      new Point3d(left, bottom, maxElevation), // BL

      // Bottom
      new Point3d(left, top, minElevation), // TL
      new Point3d(right, top, minElevation), // TR
      new Point3d(right, bottom, minElevation), // BR
      new Point3d(left, bottom, minElevation) // BL
    ];

    return bounds;
  }

  /**
   * Construct the mesh used by the depth shader for the given geometry.
   * @param {"depthShader"|"terrainDepthShader"} type
   * @returns {PIXI.Mesh}
   */
  _constructDepthMesh(shaderType = "depthShader") {
    const uniforms = {
      projectionM: SourceDepthShadowMap.toColMajorArray(this.projectionMatrix),
      viewM: SourceDepthShadowMap.toColMajorArray(this.viewMatrix)
    };

    // Depth Map goes from 0 to 1, where 1 is furthest away (the far edge).
    const { vertexShader, fragmentShader } = SourceDepthShadowMap[shaderType];
    const depthShader = PIXI.Shader.from(vertexShader, fragmentShader, uniforms);

    // TODO: Can we save and update a single PIXI.Mesh?
    const mesh = new PIXI.Mesh(this.wallGeometry, depthShader);
    mesh.state.depthTest = true;
    mesh.state.depthMask = true;
    return mesh;
  }

  /**
   * Render the depth of each wall in the scene, saved to a depth texture.
   * @returns {PIXI.Texture}
   */
  _renderDepth() {
    const renderTexture = PIXI.RenderTexture.create({width: 1024, height: 1024});
    renderTexture.framebuffer.addDepthTexture();
    renderTexture.framebuffer.enableDepth();
    canvas.app.renderer.render(this.depthMesh, { renderTexture });

    if ( this.#hasTerrainWalls ) {
      // Run a second pass over depth, to set all frontmost terrain walls to
      // "transparent" (depth = 1).
      canvas.app.renderer.render(this.terrainDepthMesh, { renderTexture });
    }

    // TODO: Can we store a PIXI.Texture and just update it?
    const depthTex = new PIXI.Texture(renderTexture.framebuffer.depthTexture);

    // Save the frameBuffer to avoid GC
    // https://ptb.discord.com/channels/732325252788387980/734082399453052938/1101602468221173771
    // https://github.com/pixijs/pixijs/pull/9409
    depthTex.framebuffer = renderTexture.framebuffer;

    return depthTex;
  }

  /**
   * Render a sprite to the screen to test the depth
   */
  _depthTest() {
    if ( this.#depthSprite ) canvas.stage.removeChild(this.#depthSprite);
    this.#depthSprite = new PIXI.Sprite(this.depthTexture);
    canvas.stage.addChild(this.#depthSprite);
  }

  _endDepthTest() {
    if ( this.#depthSprite ) canvas.stage.removeChild(this.#depthSprite);
  }

  /**
   * Render a test of the shadows to the canvas
   */
  _shadowRenderTest() {
    if ( this.#shadowRender ) canvas.stage.removeChild(this.#shadowRender);

    const geometryShadowRender = new PIXI.Geometry();
    const sceneRect = canvas.dimensions.sceneRect;
    const minElevation = this.minElevation;
    geometryShadowRender.addAttribute("aVertexPosition", [
      sceneRect.left, sceneRect.top, minElevation,      // TL
      sceneRect.right, sceneRect.top, minElevation,   // TR
      sceneRect.right, sceneRect.bottom, minElevation, // BR
      sceneRect.left, sceneRect.bottom, minElevation  // BL
    ], 3);

    // Texture coordinates:
    // BL: 0,0; BR: 1,0; TL: 0,1; TR: 1,1
    geometryShadowRender.addAttribute("texCoord", [
      0, 1, // TL
      1, 1, // TR
      1, 0, // BR
      0, 0 // BL
    ], 2);
    geometryShadowRender.addIndex([0, 1, 2, 0, 2, 3]);

    const shadowRenderUniforms = {
      projectionM: SourceDepthShadowMap.toColMajorArray(this.projectionMatrix),
      viewM: SourceDepthShadowMap.toColMajorArray(this.viewMatrix),
      depthMap: this.depthTexture
    };

    const { vertexShader, fragmentShader } = SourceDepthShadowMap.shadowRenderShader;
    const shadowRenderShader = PIXI.Shader.from(vertexShader, fragmentShader, shadowRenderUniforms);
    this.#shadowRender = new PIXI.Mesh(geometryShadowRender, shadowRenderShader);
    canvas.stage.addChild(this.#shadowRender);
  }

  _endShadowRenderTest() {
    if ( this.#shadowRender ) canvas.stage.removeChild(this.#shadowRender);
  }

  static toColMajorArray = toColMajorArray;

  static orthographicMatrix = orthographicMatrix;

  static perspectiveMatrix = perspectiveMatrix;

  static shadowRenderShader = shadowRenderShader;

  static depthShader = depthShader;

  static terrainDepthShader = terrainDepthShader;
}
