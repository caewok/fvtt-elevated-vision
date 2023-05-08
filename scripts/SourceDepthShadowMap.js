/* globals
canvas,
CONST,
foundry,
PIXI
*/
"use strict";

import { Matrix } from "./geometry/Matrix.js";
import { Point3d } from "./geometry/3d/Point3d.js";

import {
  shadowRenderShaderGLSL,
  depthShaderGLSL,
  terrainDepthShaderGLSL,
  getWallCoordinatesShaderGLSL } from "./shaders.js";

import {
  perspectiveMatrix,
  orthographicMatrix,
  toColMajorArray } from "./util.js";

/* Testing

// let walls = canvas.walls.placeables;
// let walls = canvas.walls.controlled;

api = game.modules.get("elevatedvision").api
Draw = CONFIG.GeometryLib.Draw;
Draw.clearDrawings()

SourceDepthShadowMap = api.SourceDepthShadowMap
Point3d = CONFIG.GeometryLib.threeD.Point3d


lightOrigin = new Point3d(100, 100, 1600);
// lightOrigin = new Point3d(100, canvas.dimensions.height - 100, 1600);

Draw.point(lightOrigin, { color: Draw.COLORS.yellow });
Draw.segment({A: lightOrigin, B: canvas.dimensions.sceneRect.center })

map = new SourceDepthShadowMap(lightOrigin, { walls });
map._depthTest();
map._endDepthTest();

map._terrainDepthTest();
map._endTerrainDepthTest();

map._wallCoordinateTest("A", "x");
map._endWallCoordinateTest();

map._shadowRenderTest();
map._endShadowRenderTest();


texture = PIXI.Texture.from(map.baseDepthTexture)
s = new PIXI.Sprite(texture);
canvas.stage.addChild(s);
canvas.stage.removeChild(s);


// update walls
map._updateWallGeometry(walls);

extractPixels = api.extract.extractPixels
extractPixelsFromFloat = api.extract.extractPixelsFromFloat
let { pixels, width, height } = extractPixelsFromFloat(canvas.app.renderer, map.terrainDepthTexture);
s = new Set()
pixels.forEach(px => s.add(px))
s
s.size

pixelRange = function(pixels) {
  return {
    min: pixels.reduce((curr, acc) => Math.min(curr, acc), Number.POSITIVE_INFINITY),
    max: pixels.reduce((curr, acc) => Math.max(curr, acc), Number.NEGATIVE_INFINITY)
  }
}
pixelRange(pixels)


extractPixels = api.extract.extractPixels
extractPixelsFromFloat = api.extract.extractPixelsFromFloat
let { pixels, width, height } = extractPixelsFromFloat(canvas.app.renderer, map.wallCoordinateTextures["A"]["x"]);
s = new Set()
pixels.forEach(px => s.add(px))
s
s.size

let { pixels, width, height } = extractPixelsFromInt4(canvas.app.renderer, map.wallACoordinatesTexture);
s = new Set()
pixels.forEach(px => s.add(px))
s
s.size

// Check coordinates for each
extractPixels = api.extract.extractPixels
extractPixelsFromFloat = api.extract.extractPixelsFromFloat



for ( const endpoint of ["A", "B"] ) {
  console.log(endpoint);
  for ( const coord of ["x", "y", "z"] ) {
    console.log(coord);
    const { pixels, width, height } = extractPixelsFromFloat(canvas.app.renderer, map.wallCoordinateTextures[endpoint][coord]);
    const s = new Set()
    pixels.forEach(px => s.add(px))
    const values = [...s].sort((a, b) => a - b);
    console.table(...values)
  }
}




// Locate non-zero pixels and map
m = new Map()
s = new Set()
for ( let i = 1; i < (width * height * 4); i += 4 ) {
  s.add(pixels[i])
}

pixels.reduce((curr, acc) => Math.min(curr, acc), Number.POSITIVE_INFINITY)
pixels.reduce((curr, acc) => Math.max(curr, acc), Number.NEGATIVE_INFINITY)
pixels.reduce((curr, acc) => acc += curr, 0);

// Draw x coordinates in s
s = s.map(x => canvas.dimensions.width * (1 - x))

Draw = CONFIG.GeometryLib.Draw;
s.forEach(x => Draw.segment({A: {x, y: 0}, B: {x, y: canvas.dimensions.height}}))

s.forEach(y => Draw.segment({A: {x: 0, y}, B: {x: canvas.dimensions.width, y}}))

let { pixels, width, height } = extractPixels(canvas.app.renderer, this.baseDepthTexture);


let { pixels, width, height } = extractPixels(canvas.app.renderer, this.terrainDepthTexture);

let { pixels, width, height } = extractPixels(canvas.app.renderer, this.depthTexture);

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


Plane = CONFIG.GeometryLib.threeD.Plane
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw
let [wall] = canvas.walls.controlled
token = _token

center = token.center
rayOrigin = new Point3d(center.x, center.y, 0)
lightPosition = map.lightPosition
rayDirection = lightPosition.subtract(rayOrigin)
Draw.segment({A: rayOrigin, B: lightPosition})


A = wall.A
B = wall.B

v0 = new Point3d(A.x, A.y, wall.topZ)
v1 = new Point3d(B.x, B.y, wall.topZ)
v2 = new Point3d(B.x, B.y, wall.bottomZ)
v3 = new Point3d(A.x, A.y, wall.bottomZ)

t1 = Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, v0, v1, v2)
t2 = Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, v0, v2, v3)
t = t1 ?? t2

ix = rayOrigin.projectToward(lightPosition, t)
Draw.point(ix)


rayOrigin.add(rayDirection.multiplyScalar(t))



*/

export class SourceDepthShadowMap {
  // TODO: Can we make any of these empty and just update the object?

  #viewMatrix;

  #projectionMatrix;

  #lightPosition;

  #lightSize;

  #radius;

  // Stage I: Render the depth of walls to a texture
  #depthTexture;

  #depthSprite; // For debugging

  // Stage II: Render the depth of walls, accounting for terrain walls, to a texture
  #terrainDepthTexture;

  #terrainDepthSprite; // For debugging

  // Stage III: Render wall coordinates for the closest wall
  #wallCoordinateTextures;

  #wallCoordinateSprite;

  #shadowRender; // For debugging

  #hasTerrainWalls = false;

  /**
   * Construct a new SourceDepthShadowMap instance.
   * @param {Point3d} lightPosition   Position of the light
   * @param {object} [options]
   * @param {Wall[]} [options.walls]
   * @param {PIXI.Geometry} [options.wallGeometry]
   * @param {boolean} [options.directional]
   */
  constructor(lightPosition, { walls, wallGeometry, directional = true, radius, size = 1 }) {
    // TODO: Use LightSource instead or alternatively allow as an option?
    this.#lightPosition = lightPosition;
    this.#lightSize = size;
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
      this.wallGeometry.addAttribute("aWallA", [], 3, false, PIXI.TYPES.INT);
      this.wallGeometry.addAttribute("aWallB", [], 3, false, PIXI.TYPES.INT);
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

      if ( !Object.hasOwn(wallGeometry.attributes, "aWallA") ) {
        console.error("SourceDepthShadowMap|wallGeometry has no aWallA.");
        this.wallGeometry.addAttribute("aWallA", [], 3, false, PIXI.TYPES.INT);
      }

      if ( !Object.hasOwn(wallGeometry.attributes, "aWallB") ) {
        console.error("SourceDepthShadowMap|wallGeometry has no aWallB.");
        this.wallGeometry.addAttribute("aWallB", [], 3, false, PIXI.TYPES.INT);
      }

      if ( !wallGeometry.indexBuffer ) {
        console.error("SourceDepthShadowMap|wallGeometry has no index.");
        this.wallGeometry.addIndex([]);
      }
    }

    if ( walls ) this._updateWallGeometry(walls);

    // Add min blending mode
    if ( typeof PIXI.BLEND_MODES.MIN === "undefined" ) {
      const renderer = PIXI.autoDetectRenderer();
      const gl = renderer.gl;
      PIXI.BLEND_MODES.MIN = renderer.state.blendModes.push([gl.ONE, gl.ONE, gl.ONE, gl.ONE, gl.MIN, gl.MIN]) - 1;
      PIXI.BLEND_MODES.MAX = renderer.state.blendModes.push([gl.ONE, gl.ONE, gl.ONE, gl.ONE, gl.MAX, gl.MAX]) - 1;
    }
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

  /** @type {PIXI.Texture} */
  get depthTexture() {
    if ( typeof this.#depthTexture === "undefined" ) this._renderDepth();
    return this.#depthTexture;
  }

  /** @type {PIXI.Texture} */
  get terrainDepthTexture() {
    if ( typeof this.#terrainDepthTexture === "undefined" ) this._renderDepth();
    return this.#terrainDepthTexture;
  }

  get wallCoordinateTextures() {
    if ( typeof this.#wallCoordinateTextures === "undefined" ) this._renderDepth();
    return this.#wallCoordinateTextures;
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
    this.#depthTexture = undefined; // Requires viewMatrix, projectionMatrix
    this.#terrainDepthTexture = undefined; // Requires depthTexture

    // End any debugging tests that may have been active.
    this._endShadowRenderTest();
    this._endTerrainDepthTest();
    this._endDepthTest();
  }

  /**
   * Build the wall coordinates and indices from an array of walls.
   * @param {Wall[]} walls
   * @returns {object} { coordinates: {Number[]}, indices: {Number[]}}
   */
  _constructWallCoordinates(walls) {
    let hasTerrainWalls = false;

    // TODO: Shrink the wall and construct a border around the wall shape to represent the penumbra?
    //       Mark that separately? Could work for everything except terrain walls...

    // TODO: Filter walls for given light source type and, for point source, the radius?
    // TODO: Vary according to source type
    walls = walls.filter(w => w.document["light"] !== CONST.WALL_SENSE_TYPES.NONE);

    const nWalls = walls.length;
    const coordinates = new Float32Array(nWalls * 12); // Coords: x,y,z for top and bottom A, top and bottom B
    const indices = new Uint16Array(nWalls * 6); // 2 triangles to form a square
    const terrain = new Float32Array(nWalls * 4); // 1 per wall coordinate
    const wallA = new Int32Array(nWalls * 4 * 3); // 1 per wall coordinate, 3 values
    const wallB = new Int32Array(nWalls * 4 * 3); // 1 per wall coordinate, 3 values

    // Need to cut off walls at the top/bottom bounds of the scene, otherwise they
    // will be given incorrect depth values b/c there is no floor or ceiling.
    const maxElevation = this.lightPosition.z;
    const minElevation = this.minElevation;

    for ( let w = 0, j = 0, idx = 0, i = 0; w < nWalls; w += 1, j += 12, idx += 6, i += 4 ) {
      const wall = walls[w];
      const orientWall = foundry.utils.orient2dFast(wall.A, wall.B, this.lightPosition);
      if ( orientWall.almostEqual(0) ) continue; // Wall is collinear to the light.

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

      // Record the x and y for the wall
      // A endpoint is one that makes A --> B --> light CW
      const [A, B] = orientWall > 0 ? [wall.A, wall.B] : [wall.B, wall.A];
      wallA[j] = A.x;
      wallA[j + 1] = A.y;
      wallA[j + 2] = topZ;
      wallA[j + 3] = A.x;
      wallA[j + 4] = A.y;
      wallA[j + 5] = topZ;
      wallA[j + 6] = A.x;
      wallA[j + 7] = A.y;
      wallA[j + 8] = topZ;
      wallA[j + 9] = A.x;
      wallA[j + 10] = A.y;
      wallA[j + 11] = topZ;

      wallB[j] = B.x;
      wallB[j + 1] = B.y;
      wallB[j + 2] = bottomZ;
      wallB[j + 3] = B.x;
      wallB[j + 4] = B.y;
      wallB[j + 5] = bottomZ;
      wallB[j + 6] = B.x;
      wallB[j + 7] = B.y;
      wallB[j + 8] = bottomZ;
      wallB[j + 9] = B.x;
      wallB[j + 10] = B.y;
      wallB[j + 11] = bottomZ;
    }
    return { coordinates, indices, terrain, hasTerrainWalls, wallA, wallB };
  }

  /**
   * Update the wall geometry and reset cached matrices.
   * @param {Wall[]} walls
   */
  _updateWallGeometry(walls) {
    this._resetWalls();
    const { coordinates, indices, terrain, hasTerrainWalls, wallA, wallB } = this._constructWallCoordinates(walls);
    this.#hasTerrainWalls = hasTerrainWalls;

    // Update the buffer attributes and index.
    this.wallGeometry.getBuffer("aVertexPosition").update(coordinates);
    this.wallGeometry.getBuffer("aTerrain").update(terrain);
    this.wallGeometry.getBuffer("aWallA").update(wallA);
    this.wallGeometry.getBuffer("aWallB").update(wallB);
    this.wallGeometry.getIndex().update(indices);
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
   * Treats terrain walls just like any other wall.
   * @returns {PIXI.Mesh}
   */
  _constructDepthMesh() {
    const uniforms = {
      uProjectionM: SourceDepthShadowMap.toColMajorArray(this.projectionMatrix),
      uViewM: SourceDepthShadowMap.toColMajorArray(this.viewMatrix)
    };

    // Depth Map goes from 0 to 1, where 1 is furthest away (the far edge).
    const { vertexShader, fragmentShader } = SourceDepthShadowMap.depthShaderGLSL;
    const depthShader = PIXI.Shader.from(vertexShader, fragmentShader, uniforms);

    // TODO: Can we save and update a single PIXI.Mesh?
    const mesh = new PIXI.Mesh(this.wallGeometry, depthShader);
    mesh.state.depthTest = true;
    mesh.state.depthMask = true;
    mesh.blendMode = PIXI.BLEND_MODES.MIN;
    return mesh;
  }

  _constructTerrainDepthMesh() {
    const { x, y, z } = this.lightPosition;
    const uniforms = {
      uLightPosition: [x, y, z],
      uProjectionM: SourceDepthShadowMap.toColMajorArray(this.projectionMatrix),
      uViewM: SourceDepthShadowMap.toColMajorArray(this.viewMatrix),
      depthMap: this.depthTexture
    };

    // Depth Map goes from 0 to 1, where 1 is furthest away (the far edge).
    const { vertexShader, fragmentShader } = SourceDepthShadowMap.terrainDepthShaderGLSL;
    const depthShader = PIXI.Shader.from(vertexShader, fragmentShader, uniforms);

    // TODO: Can we save and update a single PIXI.Mesh?
    const mesh = new PIXI.Mesh(this.wallGeometry, depthShader);
    mesh.state.depthTest = true;
    mesh.state.depthMask = true;
    mesh.blendMode = PIXI.BLEND_MODES.MIN;
    return mesh;
  }

  _constructWallCoordinatesMesh(endpoint = "A", coord = "x") {
    const uniforms = {
      depthMap: this.terrainDepthTexture,
      uProjectionM: SourceDepthShadowMap.toColMajorArray(this.projectionMatrix),
      uViewM: SourceDepthShadowMap.toColMajorArray(this.viewMatrix)
    };

    // Depth Map goes from 0 to 1, where 1 is furthest away (the far edge).
    const { vertexShader, fragmentShader } = SourceDepthShadowMap.getWallCoordinatesShaderGLSL(endpoint, coord);
    const depthShader = PIXI.Shader.from(vertexShader, fragmentShader, uniforms);

    // TODO: Can we save and update a single PIXI.Mesh?
    const mesh = new PIXI.Mesh(this.wallGeometry, depthShader);
    mesh.state.depthTest = true;
    mesh.state.depthMask = false;
    // FAILS: mesh.blend = false;
    // FAILS: mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
    mesh.blendMode = PIXI.BLEND_MODES.MIN; // TODO: Not sure why this works...
    return mesh;
  }

  /**
   * Render the depth of each wall in the scene.
   * Phase 1: save z values to a RED float texture.
   * @returns {PIXI.Texture}
   */
  _renderDepth() {
    // TODO: Can we change the depth render so it also outputs distance?
    //       Then we can skip the second render if no terrain walls are present.

    const width = 4096; //1024;
    const height = 4096; //1024;

    this.baseDepthTexture = new PIXI.BaseRenderTexture({
      scaleMode: PIXI.SCALE_MODES.NEAREST,
      resolution: 1,
      width,
      height,
      mipmap: PIXI.MIPMAP_MODES.OFF,
      format: PIXI.FORMATS.DEPTH_COMPONENT,
      type: PIXI.TYPES.UNSIGNED_SHORT
    });

    const depthMesh = this._constructDepthMesh();

    // TODO: Set width and height more intelligently; handle point light radii.
    // Get a RenderTexture
    const depthRenderTexture = PIXI.RenderTexture.create({
      width,
      height,
      format: PIXI.FORMATS.RED,
      type: PIXI.TYPES.FLOAT, // Rendering to a float texture is only supported if EXT_color_buffer_float is present (renderer.context.extensions.colorBufferFloat)
      scaleMode: PIXI.SCALE_MODES.NEAREST // LINEAR is only supported if OES_texture_float_linear is present (renderer.context.extensions.floatTextureLinear)
    });
    depthRenderTexture.framebuffer.addDepthTexture(this.baseDepthTexture);
    depthRenderTexture.framebuffer.enableDepth();

    // Render depth and extract the rendered texture
    canvas.app.renderer.render(depthMesh, { renderTexture: depthRenderTexture });
    this.#depthTexture = depthRenderTexture;

    // Phase II: Re-run to remove frontmost terrain walls.
    const terrainDepthMesh = this._constructTerrainDepthMesh();
    const terrainRenderTexture = PIXI.RenderTexture.create({
      width,
      height,
      format: PIXI.FORMATS.RED,
      type: PIXI.TYPES.FLOAT, // Rendering to a float texture is only supported if EXT_color_buffer_float is present (renderer.context.extensions.colorBufferFloat)
      scaleMode: PIXI.SCALE_MODES.NEAREST // LINEAR is only supported if OES_texture_float_linear is present (renderer.context.extensions.floatTextureLinear)
    });
    terrainRenderTexture.framebuffer.addDepthTexture(this.baseDepthTexture);
    terrainRenderTexture.framebuffer.enableDepth();

    canvas.app.renderer.render(terrainDepthMesh, { renderTexture: terrainRenderTexture });
    this.#terrainDepthTexture = terrainRenderTexture;

    // Phase III: Wall endpoint coordinates
    this.#wallCoordinateTextures = {
      A: { x: undefined, y: undefined, z: undefined },
      B: { x: undefined, y: undefined, z: undefined }
    };

    for ( const endpoint of ["A", "B"] ) {
      for ( const coord of ["x", "y", "z"] ) {
        const mesh = this._constructWallCoordinatesMesh(endpoint, coord);
        const renderTexture = PIXI.RenderTexture.create({
          width,
          height,
          format: PIXI.FORMATS.RED,
          type: PIXI.TYPES.FLOAT, // Rendering to a float texture is only supported if EXT_color_buffer_float is present (renderer.context.extensions.colorBufferFloat)
          scaleMode: PIXI.SCALE_MODES.NEAREST // LINEAR is only supported if OES_texture_float_linear is present (renderer.context.extensions.floatTextureLinear)
        });
        renderTexture.baseTexture.clearColor = [-1, -1, -1, -1];
        renderTexture.framebuffer.addDepthTexture(this.baseDepthTexture);
        renderTexture.framebuffer.enableDepth();
        canvas.app.renderer.render(mesh, { renderTexture });
        this.#wallCoordinateTextures[endpoint][coord] = renderTexture;
      }
    }
  }

  /**
   * Render a sprite to the screen to test the depth
   */
  _depthTest() {
    this._endDepthTest();
    this.#depthSprite = new PIXI.Sprite(this.depthTexture);
    canvas.stage.addChild(this.#depthSprite);
  }

  _endDepthTest() {
    if ( this.#depthSprite ) canvas.stage.removeChild(this.#depthSprite);
    this.#depthSprite = undefined;
  }

  _terrainDepthTest() {
    this._endTerrainDepthTest();
    this.#terrainDepthSprite = new PIXI.Sprite(this.terrainDepthTexture);
    canvas.stage.addChild(this.#terrainDepthSprite);
  }

  _endTerrainDepthTest() {
    if ( this.#terrainDepthSprite ) canvas.stage.removeChild(this.#terrainDepthSprite);
    this.#terrainDepthSprite = undefined;
  }

  _wallCoordinateTest(endpoint = "A", coord = "x") {
    this._endWallCoordinateTest();
    this.#wallCoordinateSprite = new PIXI.Sprite(this.wallCoordinateTextures[endpoint][coord]);
    canvas.stage.addChild(this.#wallCoordinateSprite);
  }

  _endWallCoordinateTest() {
    if ( this.#wallCoordinateSprite ) canvas.stage.removeChild(this.#wallCoordinateSprite);
    this.#wallCoordinateSprite = undefined;
  }

  /**
   * Render a test of the shadows to the canvas
   */
  _shadowRenderTest() {
    this._endShadowRenderTest();

    // Constants
    const sceneRect = canvas.dimensions.sceneRect;
    const minElevation = this.minElevation;

    // Construct uniforms used by the shadow shader
    const lightDirection = this.lightPosition.subtract(new Point3d(sceneRect.center.x, sceneRect.center.y, minElevation));
    const shadowRenderUniforms = {
      uLightPosition: Object.values(this.lightPosition),
      uLightDirection: Object.values(lightDirection.normalize()),
      uOrthogonal: true,
      uCanvas: [canvas.dimensions.width, canvas.dimensions.height],
      uProjectionM: SourceDepthShadowMap.toColMajorArray(this.projectionMatrix),
      uViewM: SourceDepthShadowMap.toColMajorArray(this.viewMatrix),
      uMaxDistance: this.lightPosition.dot(new Point3d(sceneRect.right, sceneRect.bottom, minElevation)),
      uLightSize: 100 // TODO: User-defined light property.
    };

    for ( const endpoint of ["A", "B"] ) {
      for ( const coord of ["x", "y", "z"] ) {
        shadowRenderUniforms[`wall${endpoint}${coord}`] = this.wallCoordinateTextures[endpoint][coord];
      }
    }

    // Construct a quad for the scene.
    const geometryShadowRender = new PIXI.Geometry();
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

    // Construct the shader and add it to a mesh.
    const { vertexShader, fragmentShader } = SourceDepthShadowMap.shadowRenderShaderGLSL;
    const shadowRenderShader = PIXI.Shader.from(vertexShader, fragmentShader, shadowRenderUniforms);
    this.#shadowRender = new PIXI.Mesh(geometryShadowRender, shadowRenderShader);

    // Render the mesh to the scene.
    canvas.stage.addChild(this.#shadowRender);
  }

  _endShadowRenderTest() {
    if ( this.#shadowRender ) canvas.stage.removeChild(this.#shadowRender);
    this.#shadowRender = undefined;
  }

  // Test the wall projection calculations.
  _calculateWallCoordinateProjections() {
    const project = pt => {
      const cameraPt = this.viewMatrix.multiplyPoint3d(pt);
      return this.projectionMatrix.multiplyPoint3d(cameraPt);
    };

    Point3d.prototype.toString = function() {
      return `${this.x},${this.y},${this.z}`;
    }

    // Canvas corners
    const { rect, sceneRect } = canvas.dimensions
    const canvasCorners = [
      new Point3d(rect.left, rect.top, 0),
      new Point3d(rect.right, rect.top, 0),
      new Point3d(rect.right, rect.bottom, 0),
      new Point3d(rect.left, rect.bottom, 0)
    ];

    // Scene corners
    const sceneCorners = [
      new Point3d(sceneRect.left, sceneRect.top, 0),
      new Point3d(sceneRect.right, sceneRect.top, 0),
      new Point3d(sceneRect.right, sceneRect.bottom, 0),
      new Point3d(sceneRect.left, sceneRect.bottom, 0)
    ];

    const wallCoords = this.wallGeometry.getBuffer("aVertexPosition").data;
    const wallPts = [];
    for ( let i = 0; i < wallCoords.length; i += 3 ) {
      wallPts.push(new Point3d(wallCoords[i], wallCoords[i + 1], wallCoords[i + 2]));
    }

    console.log("Canvas corners:")
    canvasCorners.forEach(pt => console.log(`\t${pt} => ${project(pt)}`));

    console.log("Scene corners:")
    sceneCorners.forEach(pt => console.log(`\t${pt} => ${project(pt)}`));

    console.log("Wall geometry:")
    wallPts.forEach(pt => console.log(`\t${pt} => ${project(pt)}`));
  }

  static toColMajorArray = toColMajorArray;

  static orthographicMatrix = orthographicMatrix;

  static perspectiveMatrix = perspectiveMatrix;

  static shadowRenderShaderGLSL = shadowRenderShaderGLSL;

  static depthShaderGLSL = depthShaderGLSL;

  static terrainDepthShaderGLSL = terrainDepthShaderGLSL;

  static getWallCoordinatesShaderGLSL = getWallCoordinatesShaderGLSL;
}



/**
 * Base render texture that takes a data resource.
 */

/**
 * Texture that uses a float array.
 * See https://github.com/pixijs/pixijs/blob/67ff50884ba0b8c42a1011598e2319ab3039cd1e/packages/core/src/textures/resources/BufferResource.ts#L17
 * https://github.com/pixijs/pixijs/issues/6436
 * https://www.html5gamedevs.com/topic/44689-how-bind-webgl-texture-current-to-shader-on-piximesh/
 */
// class DistanceTexture extends PIXI.Resource {
//   constructor(width, height) {
//     super(width, height);
//
//
//   }
// }

export class CustomBufferResource extends PIXI.resources.Resource {
  constructor(source, options) {
    const { width, height, internalFormat, format, type } = options || {};

    if (!width || !height || !internalFormat || !format || !type) {
      throw new Error(
        'CustomBufferResource width, height, internalFormat, format, or type invalid'
      );
    }

    super(width, height);

    this.data = source;
    this.internalFormat = internalFormat;
    this.format = format;
    this.type = type;
  }

  upload(renderer, baseTexture, glTexture) {
    const gl = renderer.gl;

    gl.pixelStorei(
      gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
      baseTexture.alphaMode === 1 // PIXI.ALPHA_MODES.UNPACK but `PIXI.ALPHA_MODES` are not exported
    );

    glTexture.width = baseTexture.width;
    glTexture.height = baseTexture.height;

    gl.texImage2D(
      baseTexture.target,
      0,  // level
      gl[this.internalFormat],
      baseTexture.width,
      baseTexture.height,
      0, // border
      gl[this.format],
      gl[this.type],
      this.data
    );

    return true;
  }
}
