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
  wallIndicesShaderGLSL } from "./shaders.js";

import {
  perspectiveMatrix,
  orthographicMatrix,
  toColMajorArray,
  perspectiveMatrixFOVY } from "./util.js";

/* Testing

// let walls = canvas.walls.placeables;
// let walls = canvas.walls.controlled;

api = game.modules.get("elevatedvision").api
Draw = CONFIG.GeometryLib.Draw;
Draw.clearDrawings()

SourceDepthShadowMap = api.SourceDepthShadowMap
Point3d = CONFIG.GeometryLib.threeD.Point3d
Matrix = CONFIG.GeometryLib.Matrix

/* Directional Light
lightOrigin = new Point3d(100, 100, 1600);
// lightOrigin = new Point3d(100, canvas.dimensions.height - 100, 1600);

directional = true;
lightRadius = undefined;
lightSize = 1;

Draw.clearDrawings()
Draw.point(lightOrigin, { color: Draw.COLORS.yellow });
Draw.segment({A: lightOrigin, B: canvas.dimensions.sceneRect.center }, { color: Draw.COLORS.yellow })

*/

/* Perspective Light
[l] = canvas.lighting.placeables;
source = l.source;
lightOrigin = new Point3d(source.x, source.y, source.elevationZ);
directional = false;
lightRadius = source.radius;
lightSize = 1;

Draw.clearDrawings()
Draw.point(lightOrigin, { color: Draw.COLORS.yellow });
cir = new PIXI.Circle(lightOrigin.x, lightOrigin.y, lightRadius)
Draw.shape(cir, { color: Draw.COLORS.yellow })

Draw.shape(l.bounds, { color: Draw.COLORS.lightblue})

*/

/*


map = new SourceDepthShadowMap(lightOrigin, { walls, directional, lightRadius, lightSize });
if ( !directional ) Draw.shape(new PIXI.Circle(map.lightPosition.x, map.lightPosition.y, map.lightRadiusAtMinElevation), { color: Draw.COLORS.lightyellow})

map._testBaseDepthTexture()
map._endTestBaseDepthTexture()

map._testDepthTexture();
map._endTestDepthTexture();

map._testWallIndicesTexture()
map._endTestWallIndicesTexture()


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
let { pixels, width, height } = extractPixels(canvas.app.renderer, map.wallCoordinatesData.texture);
s = new Set()
pixels.forEach(px => s.add(px))
s
s.size


xPixels = pixels.filter((px, idx) => idx % 4 === 0)
yPixels = pixels.filter((px, idx) => idx % 4 === 1)
zPixels = pixels.filter((px, idx) => idx % 4 === 2)

zAdjPixels = [...zPixels].map(px => px - 32767)



pixelRange = function(pixels) {
  const out = {
    min: pixels.reduce((acc, curr) => Math.min(curr, acc), Number.POSITIVE_INFINITY),
    max: pixels.reduce((acc, curr) => Math.max(curr, acc), Number.NEGATIVE_INFINITY)
  };

  out.nextMin = pixels.reduce((acc, curr) => curr > out.min ? Math.min(curr, acc) : acc, Number.POSITIVE_INFINITY);
  out.nextMax = pixels.reduce((acc, curr) => curr < out.max ? Math.max(curr, acc) : acc, Number.NEGATIVE_INFINITY);
  return out;
}
pixelRange(pixels)


extractPixels = api.extract.extractPixels
extractPixelsFromFloat = api.extract.extractPixelsFromFloat
let { pixels, width, height } = extractPixelsFromFloat(canvas.app.renderer, map.wallIndicesTexture);
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
    const { pixels, width, height } = extractPixelsFromFloat(canvas.app.renderer,
      map.wallCoordinateTextures[endpoint][coord]);
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

let { pixels, width, height } = extractPixelsFromFloat(canvas.app.renderer, map.wallIndicesTexture);

map = new SourceDepthShadowMap(lightOrigin, { walls });
map._shadowRenderTest();

// view and orthographic matrix for a wall
wall = walls[0]
[wall] = canvas.walls.controlled

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

// Test walls for perspective
WebGLMatrix = api.WebGL.WebGLMatrix

WebGLMatrix.createPerspective(90, 1, 1, 400)


walls = canvas.walls.controlled
lightPosition = map.lightPosition

wallMap = new Map()

projMatrix = map.projectionMatrix

halfFOV = Math.atan(map.lightRadius / map.lightPosition.z)
FOV = Math.toDegrees(halfFOV * 2)


projMatrix = perspectiveMatrixFOVY(FOV, 1, 1, 400)
tmp = WebGLMatrix.createPerspective(FOV, 1, 1, 400)
projMatrix = new Matrix([
  [tmp[0], tmp[1], tmp[2], tmp[3]],
  [tmp[4], tmp[5], tmp[6], tmp[7]],
  [tmp[8], tmp[9], tmp[10], tmp[11]],
  [tmp[12], tmp[13], tmp[14], tmp[15]]
])

pts = map._boundaryPoints();

// Get the min/max for the sceneCameraPoints
cameraPoints = pts.map(pt => map.viewMatrix.multiplyPoint3d(pt));
xMinMax = Math.minMax(...cameraPoints.map(pt => pt.x));
yMinMax = Math.minMax(...cameraPoints.map(pt => pt.y));
zMinMax = Math.minMax(...cameraPoints.map(pt => pt.z));
SourceDepthShadowMap.perspectiveMatrix(
  xMinMax.min, xMinMax.max,
  yMinMax.min, yMinMax.max,
  -zMinMax.max, -zMinMax.min);

projMatrix = perspectiveMatrix3(
  xMinMax.min, xMinMax.max,
  yMinMax.min, yMinMax.max,
  -zMinMax.max, -zMinMax.min)

projMatrix = perspectiveMatrix3Symmetric(
  xMinMax.min, xMinMax.max,
  yMinMax.max, yMinMax.min,
  -zMinMax.max, -zMinMax.min)

for ( const wall of walls ) {
  // const topZ = Math.min(wall.topZ, lightPosition.z - 1);
  const topZ = wall.topZ;

  const bottomZ = Math.max(wall.bottomZ, 0);

  const topA = new Point3d(wall.A.x, wall.A.y, topZ)
  const topB = new Point3d(wall.B.x, wall.B.y, topZ)
  const bottomA = new Point3d(wall.A.x, wall.A.y, bottomZ)
  const bottomB = new Point3d(wall.B.x, wall.B.y, bottomZ)

  const points = [topA, topB, bottomB, bottomA];
  const cameraPoints = [];
  const projPoints = [];
  const perspectivePoints = []

  for ( const v of points ) {
    const vCamera = map.viewMatrix.multiplyPoint3d(v);
    //const vProj =  projMatrix.multiplyPoint3d(vCamera);
    const vProj =  Matrix.fromPoint3d(vCamera).multiply(projMatrix);
    cameraPoints.push(vCamera);
    projPoints.push(vProj);
    perspectivePoints.push(vProj.toPoint3d());
  }

  obj = { points, cameraPoints, projPoints, perspectivePoints}
  wallMap.set(wall, obj);
}

for ( const wallObj of wallMap.values() ) {
  for ( let i = 0; i < 4; i += 1 ) {
    const v = wallObj.points[i];
    const vCamera = wallObj.cameraPoints[i];
    const vProj = wallObj.projPoints[i];

    console.log(`(${v.x},${v.y},${v.z})
      --> (${vCamera.x.toPrecision(3)},${vCamera.y.toPrecision(3)},${vCamera.z.toPrecision(3)})
      --> (${vProj.x.toPrecision(3)},${vProj.y.toPrecision(3)},${vProj.z.toPrecision(3)})`);
  }
}

for ( const wallObj of wallMap.values() ) {
  for ( let i = 0, j = 1; i < 4; i += 1, j += 1 ) {
    j = j % 4;
    Draw.point(wallObj.cameraPoints[i], { color: Draw.COLORS.lightblue});
    Draw.segment({ A: wallObj.cameraPoints[j], B: wallObj.cameraPoints[i] }, { color: Draw.COLORS.blue });
  }
}


wallObj = [...wallMap.values()][0]
for ( const wallObj of wallMap.values() ) {
  for ( let i = 0, j = 1; i < 4; i += 1, j += 1 ) {
    const color = Draw.COLORS.blue;


    j = j % 4;
    const mult = 100;

    // Draw.point(wallObj.projPoints[i].toPoint3d({homogenous: false}).multiplyScalar(mult), { color });

    Draw.point(wallObj.perspectivePoints[i].multiplyScalar(mult), { color });
    Draw.point(wallObj.perspectivePoints[j].multiplyScalar(mult), { color });
    Draw.segment({
      A: wallObj.perspectivePoints[i].multiplyScalar(mult),
      B: wallObj.perspectivePoints[j].multiplyScalar(mult) },
      { color });
  }
}



for ( const wall of walls ) {
  const top = Math.min(wall.topZ, lightPosition.z - 1);

  const topA = new Point3d(wall.A.x, wall.A.y, top)
  const topB = new Point3d(wall.B.x, wall.B.y, top)
  const bottomA = new Point3d(wall.A.x, wall.A.y, wall.bottomZ)
  const bottomB = new Point3d(wall.B.x, wall.B.y, wall.bottomZ)

  cameraPts = []

  for ( const v of [topA, topB, bottomA, bottomB] ) {
    const vCamera = map.viewMatrix.multiplyPoint3d(v);

    Draw.point(vCamera)

    const vProj = map.projectionMatrix.multiplyPoint3d(vCamera);

    console.log(`(${v.x},${v.y},${v.z})
      --> (${vCamera.x.toPrecision(3)},${vCamera.y.toPrecision(3)},${vCamera.z.toPrecision(3)})
      --> (${vProj.x.toPrecision(3)},${vProj.y.toPrecision(3)},${vProj.z.toPrecision(3)})`);
  }
}




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



function sinBlender(x, frequency, amplitude, displacement) {
  const value = Math.sin(x * frequency) * amplitude + displacement;
  return Math.clamped(value, 0, 1);
}

function betaInv(x, alpha, beta) {
  if ( x <= 0 ) return 0;
  const value = 1 / Math.pow(x, alpha - 1) * Math.pow(1 - x, beta - 1);
  return Math.clamped(value, 0, 1);
}

arr = [0, 0.001, 0.01, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.99, 0.999, 1]

arr.map(x => sinBlender(x, 1, 4, 0))
arr.map(x => betaInv(x, .1, 10))


*/

const WALL_COORDINATES_DATA = {
  light: undefined,
  sight: undefined,
  move: undefined,
  sound: undefined
};

const WALL_OFFSET_PIXELS = 2;

// Store wall data of a given type in an array and build a Uint16Array to store coordinate data.
export class WallCoordinatesData {
  /**
   * @typedef {object} WallCoordinatesObject
   * @property {Point3d} A      "A" endpoint for the wall
   * @property {Point3d} B      "B" endpoint for the wall
   * @property {bool} isTerrain Is the wall limited for this type?
   * @property {number} index   Index of the wall, for lookup in the data array
   * @property {Wall} wall      Reference to the wall, mostly for debugging
   */

  /** @type {[WallCoordinatesObject]} */
  #coordinates = [];

  /** @type {boolean} */
  #hasTerrainWalls = false;

  /** @type {Uint16Array} */
  #data;

  /** @type {PIXI.Texture} */
  #texture;

  constructor(type = "light") {
    this.type = type;
    this.buildCoordinates();
  }

  /** @type {Map<string, WallCoordinatesObject>} */
  get coordinates() { return this.#coordinates; }

  /** @type {Uint16Array} */
  get data() { return this.#data || (this.#data = this._wallDataArray()); }

  /** @type {bool} */
  get hasTerrainWalls() { return this.#hasTerrainWalls; }

  /** @type {PIXI.Texture} */
  get texture() { return this.#texture || (this.#texture = this._texture()); }

  /**
   * Add objects to a map representing wall data.
   */
  buildCoordinates() {
    const walls = canvas.walls.placeables.filter(w => w.document[this.type] !== CONST.WALL_SENSE_TYPES.NONE);
    const nWalls = walls.length;
    const wallCoords = this.#coordinates;
    wallCoords.length = 0;
    let hasTerrainWalls = false;
    for ( let i = 0; i < nWalls; i += 1 ) {
      const wall = walls[i];
      const wallObj = this.coordinatesObject(wall);
      wallCoords.push(wallObj);
      hasTerrainWalls ||= wallObj.isTerrain;
    }
    this.#hasTerrainWalls = hasTerrainWalls;
    this.#data = undefined;
  }

  /**
   * Create object to store relevant wall data, along with the index of the object.
   * @param {Wall} wall
   * @returns {WallCoordinatesObject}
   */
  coordinatesObject(wall) {
    const { A, B, topZ, bottomZ } = wall;

    // Slightly extend walls to ensure connected walls do not have gaps in shadows
    const ABDist = PIXI.Point.distanceBetween(A, B)
    const ptA = new PIXI.Point(A.x, A.y);
    const ptB = new PIXI.Point(B.x, B.y);

    const adjA = ptB.towardsPoint(ptA, ABDist + WALL_OFFSET_PIXELS)
    const adjB = ptA.towardsPoint(ptB, ABDist + WALL_OFFSET_PIXELS)
    const top = topZ + WALL_OFFSET_PIXELS;
    const bottom = bottomZ - WALL_OFFSET_PIXELS;

    // Identify walls linked at A and B
    const linked = wall.getLinkedSegments().walls;
    const aKey = wall.vertices.a.key;
    const bKey = wall.vertices.b.key;
    const linkedA = linked.filter(w => w !== wall
      && w.wallKeys.has(aKey)
      && w.document[this.type] !== CONST.WALL_SENSE_TYPES.NONE);
    const linkedB = linked.filter(w => w !== wall
      && w.wallKeys.has(bKey)
      && w.document[this.type] !== CONST.WALL_SENSE_TYPES.NONE);

    const out = {
      A: new Point3d(adjA.x, adjA.y, top),
      B: new Point3d(adjB.x, adjB.y, bottom),
      isTerrain: wall.document[this.type] === CONST.WALL_SENSE_TYPES.LIMITED,
      wall: wall,
      linkedA,
      linkedB
    };

    out.A.roundDecimals();
    out.B.roundDecimals();
    return out;
  }

  /**
   * Data Uint16Array with wall coordinate information. 8 x nWalls.
   * [A.x, A.y, A.z, isTerrain, B.x, B.y, B.z, 0 (not currently used)]
   * Range of coords is [0, 65535]
   * For elevation, set 0 to floor(65535 / 2) = 32767. So elevation range is [-32767, 32768]
   */
  _wallDataArray() {
    const coords = this.coordinates;
    const nWalls = coords.length;
    const coordinateData = new Uint16Array(8 * nWalls);
    for ( let i = 0; i < nWalls; i += 1 ) {
      const row = i * 8;
      const wallObj = coords[i];
      const dat = this._dataForWallObject(wallObj);
      coordinateData.set(dat, row);
    }
    return coordinateData;
  }

  _dataForWallObject(wallObj) {
    // TODO: Consider different representation for elevation
    // Based on the elevation min for the scene?
    // Use grid elevation instead of pixel?
    // Either or both would allow a larger range of elevation values
    const MAX = 65535;
    const MIN = 0;
    const ELEVATION_OFFSET = 32767;
    const minmax = function(x) { return Math.max(Math.min(x, MAX), MIN); };
    const wallCoordinateData = new Uint16Array(8);

    // Extend the wall points slightly to ensure overlap at connections.
    const ABDist = PIXI.Point.distanceBetween(wallObj.A, wallObj.B)
    const A = wallObj.B.to2d().towardsPoint(wallObj.A.to2d(), ABDist + WALL_OFFSET_PIXELS)
    const B = wallObj.A.to2d().towardsPoint(wallObj.B.to2d(), ABDist + WALL_OFFSET_PIXELS)
    const top = wallObj.A.z + WALL_OFFSET_PIXELS;
    const bottom = wallObj.B.z - WALL_OFFSET_PIXELS;

    // Are endpoints linked by another wall of this type?
    // neither: 0
    // A only: 1
    // B only: 2
    // both: 3
    const aLinked = Number(wallObj.linkedA.length > 0);
    const bLinked = Number(wallObj.linkedB.length > 0) * 2;

    wallCoordinateData[0] = minmax(wallObj.A.x);
    wallCoordinateData[1] = minmax(wallObj.A.y);
    wallCoordinateData[2] = minmax(wallObj.A.z + ELEVATION_OFFSET);
    wallCoordinateData[3] = wallObj.isTerrain;
    wallCoordinateData[4] = minmax(wallObj.B.x);
    wallCoordinateData[5] = minmax(wallObj.B.y);
    wallCoordinateData[6] = minmax(wallObj.B.z + ELEVATION_OFFSET);
    wallCoordinateData[7] = aLinked | bLinked;
    return wallCoordinateData;
  }

  _texture() {
    const resource = new CustomBufferResource(this.data, {
      width: 2,
      height: this.coordinates.length,
      internalFormat: "RGBA16UI",
      format: "RGBA_INTEGER",
      type: "UNSIGNED_SHORT"
    });

    const baseDataTexture = new PIXI.BaseTexture(resource, {
      scaleMode: PIXI.SCALE_MODES.NEAREST,
      mipmap: PIXI.MIPMAP_MODES.OFF
    });
    baseDataTexture.alphaMode = PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA;
    const dataTexture = new PIXI.Texture(baseDataTexture);
    return dataTexture;
  }

  removeWall(id) {
    const coordObjs = this.coordinates;
    const wallObj = coordObjs.find(obj => obj.id === id);
    if ( !wallObj ) return;

    // Save the index and then remove from the object array
    const idx = coordObjs.indexOf(wallObj);
    coordObjs.splice(idx, 1);

    // Update terrain wall status, checking all walls only if necessary.
    if ( this.#hasTerrainWalls && wallObj.isTerrain ) {
      this.#hasTerrainWalls = coordObjs.some(obj => obj.isTerrain);
    }

    // Decrease the size of the data array
    if ( !this.#data ) return;
    const newDataArray = new Uint16Array(8 * coordObjs.length);
    newDataArray.set(this.#data.slice(0, idx), 0);
    newDataArray.set(this.#data.slice(idx + 1), idx);
    this.#data = newDataArray;
  }

  addWall(wall) {
    const wallObj = this.wallCoordinatesObject(wall);
    this.coordinates.push(wallObj);
    this.#hasTerrainWalls ||= wallObj.isTerrain;

    // Increase the size of the data array and append the new wall data.
    if ( !this.#data ) return;
    const newDataArray = new Uint16Array(8 * this.coordinates.length);
    newDataArray.set(this.data, 0);
    const dat = this._dataForWallObject(wallObj);
    newDataArray.set(dat, this.data.length);
    this.#data = newDataArray;
  }

  updateWall(wall) {
    const wallObj = this.wallCoordinatesObject(wall);
    const idx = this.coordinates.findIndex(obj => obj.wall === wall);
    if ( !~idx ) return this.addWall(wall);
    this.coordinates[idx] = wallObj;
    this.#hasTerrainWalls ||= wallObj.isTerrain;

    // Replace the entire row in the data array
    if ( !this.#data ) return;
    const dat = this._dataForWallObject(wallObj);
    this.#data.set(dat, idx);
  }
}

export class SourceDepthShadowMap {

  // TODO: Can we make any of these empty objects instead of undefined, and just update the object?
  #viewMatrix;

  #projectionMatrix;

  #lightType;

  #lightPosition;

  #lightSize;

  #lightRadius;

  #wallGeometry;

  // Stage I: Render the depth of walls to a texture
  #baseDepthTexture;

  #baseDepthSprite;

  #depthTexture;

  #depthSprite; // For debugging

  // Stage II: Render wall coordinates of closest wall, accounting for terrain walls, to a texture
  #wallIndicesTexture;

  #wallIndicesSprite;

  #shadowRender; // For debugging

  #hasTerrainWalls = false;

  #wallCoordinatesData;

  /**
   * Construct a new SourceDepthShadowMap instance.
   * @param {Point3d} lightPosition   Position of the light
   * @param {object} [options]
   * @param {Wall[]} [options.walls]
   * @param {PIXI.Geometry} [options.wallGeometry]
   * @param {boolean} [options.directional]
   */
  constructor(lightPosition, { directional = true, lightRadius, lightSize = 1, lightType = "light" }) {
    // TODO: Use LightSource instead or alternatively allow as an option?
    this.#lightPosition = lightPosition;
    this.#lightSize = lightSize;
    this.#lightType = lightType;
    this.#lightRadius = lightRadius;
    this.directional = directional;

    if ( !directional && typeof lightRadius === "undefined" ) {
      console.error("SourceDepthShadowMap requires lightRadius for point source.");
      this.#lightRadius = canvas.dimensions.size;
    }

    this.#wallCoordinatesData = WALL_COORDINATES_DATA[this.#lightType] || new WallCoordinatesData(this.#lightType);

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
  get lightRadius() { return this.#lightRadius; }

  set lightRadius(value) {
    this._resetLight();
    this.#lightRadius = value;
  }

  get lightRadiusAtMinElevation() {
    const radius = this.lightRadius;
    const height = this.lightPosition.z;
    if ( height >= radius ) return 0;

    // Pythagoras
    return Math.sqrt(Math.pow(radius, 2) - Math.pow(height, 2));
  }

  /** @type {PIXI.Texture} */
  get depthTexture() {
    if ( typeof this.#depthTexture === "undefined" ) this._renderDepth();
    return this.#depthTexture;
  }

  /** @type {PIXI.Texture} */
  get wallIndicesTexture() {
    if ( typeof this.#wallIndicesTexture === "undefined" ) this._renderDepth();
    return this.#wallIndicesTexture;
  }

  /** @type {number} */
  get minElevation() {
    const elevationMin = canvas.elevation.elevationMin;
    return (this.lightPosition.z > elevationMin)
      ? elevationMin : this.lightPosition.z - canvas.dimensions.size;
  }

  /** @type {PIXI.Geometry} */
  get wallGeometry() {
    return this.#wallGeometry || (this.#wallGeometry = this._wallGeometry());
  }

  get wallCoordinatesData() { return this.#wallCoordinatesData; }

  // TODO: Reset cached getters

  /**
   * Build the PIXI.Geometry object for these walls and light.
   * Attributes:
   * - aVertexPosition: coordinates for wall endpoint in 3 dimensions. Float32
   * - aTerrain:  1 if terrain wall
   * - aWallIndex: index [0–65337] corresponding to the #data array for this wall
   */
  _wallGeometry() {
    // TODO: Shrink the wall and construct a border around the wall shape to represent the penumbra?
    //       Mark that separately? Could work for everything except terrain walls...

    if ( this.#wallGeometry ) this.#wallGeometry.destroy();
    const coords = this.#wallCoordinatesData.coordinates;
    const nWalls = coords.length;

    // Need to cut off walls at the top/bottom bounds of the scene, otherwise they
    // will be given incorrect depth values b/c there is no floor or ceiling.
    const maxElevation = this.lightPosition.z;
    const minElevation = this.minElevation;

    // Point source lights have bounds
    let lightBounds;
    if ( !this.directional ) {
      const { lightPosition, lightRadius } = this;
      lightBounds = new PIXI.Rectangle(lightPosition.x - lightRadius, lightPosition.y - lightRadius, lightRadius * 2, lightRadius * 2);
    }

    // TODO: Try Uint or other buffers instead of Array.
    const indices = [];
    const aVertexPosition = [];
    const aTerrain = [];
    const aWallIndex = [];
    let wallNumber = 0;
    for ( let i = 0; i < nWalls; i += 1 ) {
      // TODO: Filter walls for ones within radius of the light, as projected onto canvas.
      const wallObj = coords[i];
      const orientWall = foundry.utils.orient2dFast(wallObj.A, wallObj.B, this.lightPosition);
      if ( orientWall.almostEqual(0) ) continue; // Wall is collinear to the light.

      const topZ = Math.min(maxElevation, wallObj.A.z, this.lightPosition.z - 1);
      const bottomZ = Math.max(minElevation, wallObj.B.z);
      if ( topZ <= bottomZ ) continue; // Wall is above or below the viewing box.

      // Point source lights are limited to a max radius; drop walls outside the radius
      if ( !this.directional
        && !lightBounds.lineSegmentIntersects(wallObj.A, wallObj.B, { inside: true })) continue;

      // Indices are:
      // 0 1 2
      // 1 3 2
      // 4 5 6
      // 5 7 6
      const v = wallNumber * 4; // Four vertices per wall
      indices.push(
        v,
        v + 1,
        v + 2,
        v + 1,
        v + 3,
        v + 2
      );

      // Arrange so A --> B --> lightPosition is counterclockwise
      // aBottom -- aTop -- bBottom, aTop -- bTop -- bBottom
      const [A, B] = orientWall > 0 ? [wallObj.A, wallObj.B] : [wallObj.B, wallObj.A];

      // Even vertex (0) is bottom A
      aVertexPosition.push(A.x, A.y, bottomZ);

      // Odd vertex (1) is top A
      aVertexPosition.push(A.x, A.y, topZ);

      // Even vertex (2) is bottom B
      aVertexPosition.push(B.x, B.y, bottomZ);

      // Odd vertex (3) is top B
      aVertexPosition.push(B.x, B.y, topZ);

      // 4 vertices, so repeat labels x4.
      const isTerrain = wallObj.isTerrain;
      aTerrain.push(isTerrain, isTerrain, isTerrain, isTerrain);
      aWallIndex.push(i, i, i, i);

      // Increment to the next wall.
      wallNumber += 1;
    }

    // TODO: set interleave to true?
    const geometry = new PIXI.Geometry();
    geometry.addIndex(indices);
    geometry.addAttribute("aVertexPosition", aVertexPosition, 3, false);
    geometry.addAttribute("aTerrain", aTerrain, 1, false); // PIXI.TYPES.INT or some other?
    geometry.addAttribute("aWallIndex", aWallIndex, 1, false);
    return geometry;
  }

  // TODO: update wall geometry using updateWall and geometry.getBuffer().update()...

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
    // TODO: Clean up boundaryPoints as only really used for orthogonal.
    const pts = this._boundaryPoints();

    // Determine the near and far planes from the camera, based on scene objects
    const near = this.lightPosition.z - pts[0].z;
    const far = this.lightPosition.z - pts[4].z;
    const FOV = this._perspectiveFOV();
    const aspect = 1; // Always 1 b/c lights are spherical.
    return perspectiveMatrixFOVY(FOV, aspect, near, far);
  }

  /**
   * For the projection matrix, determine the field-of-view for the light.
   * Assume we want the light to project onto a square the size of the light radius * 2.
   * TODO: Technically, the sphere will intersect the plane at less than that distance.
   *       Could shrink the texture size and FOV accordingly.
   * @returns {number} field-of-view, in radians
   */
  _perspectiveFOV() {
    // Using radius to estimate a maximum FOV.
    const halfFOV = Math.atan(this.lightRadius / this.lightPosition.z);
    return Math.toDegrees(halfFOV * 2);
  }

  /**
   * Get the points representing the edge of the boundary volume for the depth render.
   * Orthographic: based on scene
   * Perspective: based on light-radius cylinder
   * @returns {Point3d[]}
   */
  _boundaryPoints() {
    const { lightPosition, lightRadius } = this;

    const coordinates = this.wallGeometry.getBuffer("aVertexPosition").data;
    const zCoords = coordinates.filter((e, i) => (i + 1) % 3 === 0);
    const maxElevation = Math.min(Math.max(...zCoords), this.lightPosition.z - 1); // Don't care about what is above the light
    const minElevation = this.minElevation;

    let { top, bottom, left, right } = canvas.dimensions.sceneRect;
    if ( !this.directional ) {
      top = lightPosition.y - lightRadius;
      bottom = lightPosition.y + lightRadius;
      right = lightPosition.x - lightRadius;
      left = lightPosition.x + lightRadius;
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

  _constructTerrainDepthMesh(depthMap) {
    depthMap ??= this.depthTexture;
    const { x, y, z } = this.lightPosition;
    const uniforms = {
      uLightPosition: [x, y, z],
      uProjectionM: SourceDepthShadowMap.toColMajorArray(this.projectionMatrix),
      uViewM: SourceDepthShadowMap.toColMajorArray(this.viewMatrix),
      depthMap
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

  /**
   * Render the depth of each wall in the scene.
   * Phase 1: save z values to a RED float texture.
   * @returns {PIXI.Texture}
   */
  _renderDepth() {
    /* Checking gl parameters
    gl = canvas.app.renderer;
    gl.getParameter(gl.DEPTH_TEST)
    gl.getParameter(gl.DEPTH_WRITEMASK)
    */

    // TODO: When no terrain walls present, swap the depth mesh for one that renders the wall indices directly.
    //       Allows skipping of the second terrain wall render.

    performance.mark("render_wall_depth");

    const MAX_WIDTH = 4096;
    const MAX_HEIGHT = 4096;
    const { sceneWidth, sceneHeight } = canvas.dimensions;

    const width = Math.min(MAX_WIDTH, this.directional ? sceneWidth : this.lightRadius * 2);
    const height = Math.min(MAX_HEIGHT, this.directional ? sceneHeight : this.lightRadius * 2);

    // Construct a depth texture that can be used for multiple renders.
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

    // Phase I: Depth test all the walls in the scene.
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

    // Phase II: Re-run depth test to remove frontmost terrain walls (peel 1 depth layer)
    // Must use a distinct RenderTexture b/c we use depthRenderTexture as a uniform to the mesh.
    performance.mark("render_terrain_wall_depth");
    const terrainDepthMesh = this._constructTerrainDepthMesh();

    // TODO: Can we render to an integer texture? Maybe uint16?
    const terrainRenderTexture = PIXI.RenderTexture.create({
      width,
      height,
      format: PIXI.FORMATS.RED,
      type: PIXI.TYPES.FLOAT, // Rendering to a float texture is only supported if EXT_color_buffer_float is present (renderer.context.extensions.colorBufferFloat)
      scaleMode: PIXI.SCALE_MODES.NEAREST // LINEAR is only supported if OES_texture_float_linear is present (renderer.context.extensions.floatTextureLinear)
    });
    terrainRenderTexture.framebuffer.addDepthTexture(this.baseDepthTexture);
    terrainRenderTexture.framebuffer.enableDepth();

    // Set default color to -1 so this render can record wall ids from 0 onward.
    terrainRenderTexture.baseTexture.clearColor = [-1, -1, -1, -1];

    canvas.app.renderer.render(terrainDepthMesh, { renderTexture: terrainRenderTexture });
    this.#wallIndicesTexture = terrainRenderTexture;

    performance.mark("finish_render_depth");
    performance.measure("Wall-Depth", "render_wall_depth", "render_terrain_wall_depth");
    performance.measure("Terrain-Depth", "render_terrain_wall_depth", "finish_render_depth");
  }

  /**
   * Render a sprite to the screen to test the various render textures.
   */

  _testBaseDepthTexture() {
    if ( !this.baseDepthTexture ) this._renderDepth();
    this._endTestBaseDepthTexture();
    this.#baseDepthTexture = new PIXI.Texture(this.baseDepthTexture);
    this.#baseDepthSprite = new PIXI.Sprite(this.#baseDepthTexture);
    canvas.stage.addChild(this.#baseDepthSprite);
  }

  _endTestBaseDepthTexture() {
    if ( this.#baseDepthSprite ) canvas.stage.removeChild(this.#baseDepthSprite);
    if ( this.#baseDepthTexture ) this.#baseDepthTexture.destroy(false);
  }

  _testDepthTexture() {
    this._endTestDepthTexture();
    this.#depthSprite = new PIXI.Sprite(this.depthTexture);
    canvas.stage.addChild(this.#depthSprite);
  }

  _endTestDepthTexture() {
    if ( this.#depthSprite ) canvas.stage.removeChild(this.#depthSprite);
    this.#depthSprite = undefined;
  }

  _testWallIndicesTexture() {
    this._endTestWallIndicesTexture();
    this.#wallIndicesSprite = new PIXI.Sprite(this.wallIndicesTexture);
    canvas.stage.addChild(this.#wallIndicesSprite);
  }

  _endTestWallIndicesTexture() {
    if ( this.#wallIndicesSprite ) canvas.stage.removeChild(this.#wallIndicesSprite);
    this.#wallIndicesSprite = undefined;
  }

  /**
   * Render a test of the shadows to the canvas
   */
  _shadowRenderTest() {
    this._endShadowRenderTest();

    performance.mark("start_shadow_render");

    // Constants

    const minElevation = this.minElevation;

    // Construct uniforms used by the shadow shader
    const { left, right, top, bottom, center } = canvas.dimensions.sceneRect;
    const lightDirection = this.lightPosition.subtract(new Point3d(center.x, center.y, minElevation));
    const shadowRenderUniforms = {
      uWallIndices: this.wallIndicesTexture,
      uWallCoordinates: this.wallCoordinatesData.texture,
      uLightPosition: Object.values(this.lightPosition),
      uLightDirection: Object.values(lightDirection.normalize()),
      uLightRadius: this.directional ? -1 : this.lightRadius,
      uOrthogonal: this.directional,
      uCanvas: [canvas.dimensions.width, canvas.dimensions.height],
      uProjectionM: SourceDepthShadowMap.toColMajorArray(this.projectionMatrix),
      uViewM: SourceDepthShadowMap.toColMajorArray(this.viewMatrix),
      uMaxDistance: this.lightPosition.dot(new Point3d(right, bottom, minElevation)),
      uLightSize: 100 // TODO: User-defined light property.
    };

    // Construct a quad for the scene.
    const geometryShadowRender = new PIXI.Geometry();
    if ( this.directional ) {
      // Cover the entire scene
      geometryShadowRender.addAttribute("aVertexPosition", [
        left, top, minElevation,      // TL
        right, top, minElevation,   // TR
        right, bottom, minElevation, // BR
        left, bottom, minElevation  // BL
      ], 3);
    } else {
      // Cover the light radius
      const { lightRadius, lightPosition } = this;
      geometryShadowRender.addAttribute("aVertexPosition", [
        lightPosition.x - lightRadius, lightPosition.y - lightRadius, minElevation, // TL
        lightPosition.x + lightRadius, lightPosition.y - lightRadius, minElevation, // TR
        lightPosition.x + lightRadius, lightPosition.y + lightRadius, minElevation, // BR
        lightPosition.x - lightRadius, lightPosition.y + lightRadius, minElevation  // BL
      ], 3);
    }

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

    performance.mark("end_shadow_render");
    performance.measure("Shdow-Render", "start_shadow_render", "end_shadow_render");
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
    };

    // Canvas corners
    const { rect, sceneRect } = canvas.dimensions;
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

    console.log("Canvas corners:");
    canvasCorners.forEach(pt => console.log(`\t${pt} => ${project(pt)}`));

    console.log("Scene corners:");
    sceneCorners.forEach(pt => console.log(`\t${pt} => ${project(pt)}`));

    console.log("Wall geometry:");
    wallPts.forEach(pt => console.log(`\t${pt} => ${project(pt)}`));
  }

  static toColMajorArray = toColMajorArray;

  static orthographicMatrix = orthographicMatrix;

  static perspectiveMatrix = perspectiveMatrix;

  static shadowRenderShaderGLSL = shadowRenderShaderGLSL;

  static depthShaderGLSL = depthShaderGLSL;

  static terrainDepthShaderGLSL = terrainDepthShaderGLSL;

  static wallIndicesShaderGLSL = wallIndicesShaderGLSL;
}

/**
 * Texture that uses a float array.
 * See https://github.com/pixijs/pixijs/blob/67ff50884ba0b8c42a1011598e2319ab3039cd1e/packages/core/src/textures/resources/BufferResource.ts#L17
 * https://github.com/pixijs/pixijs/issues/6436
 * https://www.html5gamedevs.com/topic/44689-how-bind-webgl-texture-current-to-shader-on-piximesh/
 */
export class CustomBufferResource extends PIXI.resources.Resource {
  constructor(source, options) {
    const { width, height, internalFormat, format, type } = options || {};

    if (!width || !height || !internalFormat || !format || !type) {
      throw new Error(
        "CustomBufferResource width, height, internalFormat, format, or type invalid."
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
      0,  // Level
      gl[this.internalFormat],
      baseTexture.width,
      baseTexture.height,
      0, // Border
      gl[this.format],
      gl[this.type],
      this.data
    );

    return true;
  }
}
