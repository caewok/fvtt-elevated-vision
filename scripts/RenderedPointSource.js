/* globals
canvas,
CONFIG,
PIXI,
Token

*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "./const.js";
import { Draw } from "./geometry/Draw.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { Plane } from "./geometry/3d/Plane.js";

import { ShadowWallShader, ShadowMesh } from "./glsl/ShadowWallShader.js";
import { ShadowTerrainShader } from "./glsl/ShadowTerrainShader.js";
import { PointSourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";
import { ShadowTextureRenderer } from "./glsl/ShadowTextureRenderer.js";
import { ShadowVisionMaskShader } from "./glsl/ShadowVisionMaskShader.js";
import { EVQuadMesh } from "./glsl/EVQuadMesh.js";

// Methods related to RenderedPointSource

/* Foundry RenderedPointSource workflow

_configure
--> #initializeMeshes
--> If #initializeMeshes returns true or shader key changes, --> #initializeShaders

#initializeShaders
--> #createShader
--> #updateUniforms
--> Hooks.call(initialize[LightSource]Shader)

#initializeMeshes
--> #updateGeometry
--> if no prior #geometry set, #createMeshes

#updateGeometry
--> Passes this.shape to the PolygonMesher
  -- x, y, radius
--> Triangulate the PolygonMesher output to set geometry.

*/

/* New Methods
_initializeEVShadows
- Just calls the below initialize methods

_initializeEVShadowGeometry
- Wall geometry for the source.

_initializeEVShadowMesh
- Shadows for walls coded to handle terrain walls.

_initializeEVTerrainShadowMesh
- Shadow terrain when source is below.
- Also shadow based on limited angle

_initializeEVShadowRenderer
- Render the wall shadows

_initializeEVShadowMask
- Color red the lit (unshadowed) areas for the source

_updateEVShadowData(changes)
- Update the shadow mesh, geometry, render, given changes.

pointInShadow(point)
- Return percentage shadow for the point

targetInShadow(target, testPoint)
- Return percentage shadow for given target and a point on or near the target.
- Relies on pixelMesh
*/

/* New Getters
EVVisionMask
- Retrieve the mask corresponding to this source. Passed to CanvasVisibility to mask vision.
- Distinct version for

EVShadowTexture
- Retrieve the shadow texture corresponding to this source. Used for lighting shaders and vision masking

*/

/* Wrapped Methods
_configure
- Update shadow data

destroy
- Remove shadow data

_createPolygon
- Create shadow polygons

*/

export const PATCHES = {};
PATCHES.POLYGONS = {};
PATCHES.VISIBILITY = {};
PATCHES.WEBGL = {};


// ----- NOTE: Polygon Shadows ----- //
// NOTE: Polygon Wraps
function EVVisionMaskPolygon() {
  const g = new PIXI.Graphics();
  const draw = new Draw(g);

  const ev = this[MODULE_ID];
  if ( !ev || !ev.polygonShadows?.combined?.length ) {
    draw.shape(this.shape, { fill: 0xFF0000 });
    return g;
  }

  for ( const poly of ev.polygonShadows.combined ) {
    if ( poly.isHole ) {
      g.beginHole();
      g.drawShape(poly, { fill: 0xFF0000 });
      g.endHole();
    } else this.drawShape(poly, { fill: 0xFF0000 });
  }
  return g;
}

PATCHES.POLYGONS.METHODS = { EVVisionMask: EVVisionMaskPolygon };

// NOTE: Polygon Methods

function _createPolygon(wrapped) {
  const sweep = wrapped();
  // TODO: this.polygonShadows(sweep);
  return sweep;
}

PATCHES.POLYGONS.WRAPS = { _createPolygon };

// ----- NOTE: WebGL Shadows ----- //


// NOTE: WebGL Wraps

/**
 * Wrap RenderedPointSource.prototype._configure
 * Update shadow data when relevant changes are indicated.
 * @param {object} changes    Object of updates to point source data.
 *   Note: will only contain source.data properties.
 */
function _configure(wrapped, changes) {
  wrapped(changes);

  // At this point, ev property should exist on source b/c of initialize shaders hook.
  const ev = this[MODULE_ID];
  if ( !ev ) return;
  this._updateEVShadowData(changes);
}

/**
 * Wrap RenderedPointSource.prototype.destroy
 * Destroy shadow meshes, geometry, textures.
 */
function destroy(wrapped) {
  const ev = this[MODULE_ID];
  if ( !ev ) return wrapped();

  const assets = [
    "shadowMesh",
    "shadowRenderer",
    "shadowVisionMask",
    "wallGeometry"
  ];

  for ( const asset of assets ) {
    if ( !ev[asset] ) continue;
    ev[asset].destroy();
    ev[asset] = undefined;
  }

  return wrapped;
}

PATCHES.WEBGL.WRAPS = {
  _configure,
  destroy
};

// NOTE: WebGL Methods

/**
 * New method: RenderedPointSource.prototype._initializeEVShadows
 * Build all the shadow properties: mesh, geometry, renderer.
 */
function _initializeEVShadows() {
  if ( !this[MODULE_ID] ) this[MODULE_ID] = {};

  // Build the geometry, shadow texture, and vision mask.
  this._initializeEVShadowGeometry();
  this._initializeEVShadowMesh();
  this._initializeEVTerrainShadowMesh();
  this._initializeEVShadowRenderer();
  this._initializeEVShadowMask();

  // Set uniforms used by the lighting shader.
  const ev = this[MODULE_ID];
  Object.values(this.layers).forEach(layer => {
    const u = layer.shader.uniforms;
    u.uEVShadows = true;
    u.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
  });
}

/**
 * New method: RenderedPointSource.prototype._initializeEVShadowGeometry
 * Build the wall geometry for this source shadows.
 */
function _initializeEVShadowGeometry() {
  const ev = this[MODULE_ID];

  if ( ev.wallGeometry ) console.log("Wall geometry already defined.");
  ev.wallGeometry = new PointSourceShadowWallGeometry(this);
}

/**
 * New method: RenderedPointSource.prototype._initializeEVShadowMesh
 * Mesh that describes shadows for the given geometry and source origin.
 */
function _initializeEVShadowMesh() {
  const ev = this[MODULE_ID];
  if ( ev.shadowMesh ) console.log("shadowMesh already defined.");

  const shader = ShadowWallShader.create(this);
  ev.shadowMesh = new ShadowMesh(ev.wallGeometry, shader);
}

/**
 * New method: RenderedPointSource.prototype._initializeEVTerrainShadowMesh
 * Build terrain shadow + limited angle
 * Uses a quad sized to the source.
 */
function _initializeEVTerrainShadowMesh() {
  const ev = this[MODULE_ID];
  const shader = ShadowTerrainShader.create(this);
  ev.terrainShadowMesh = new EVQuadMesh(this.bounds, shader);
}

/**
 * Render texture to store the shadow mesh for use by other shaders.
 * New method: RenderedPointSource.prototype._initializeEVShadowRenderer
 * Render the shadow mesh to a texture.
 */
function _initializeEVShadowRenderer() {
  const ev = this[MODULE_ID];
  if ( ev.shadowRenderer ) return;

  // Render texture to store the shadow mesh for use by other shaders.
  ev.shadowRenderer = new ShadowTextureRenderer(this, ev.shadowMesh, ev.terrainShadowMesh);
}

/**
 * New method: RenderedPointSource.prototype._initializeEVShadowMask
 * Initialize the mask used by CanvasVisibility and EVVisionMask.
 */
function _initializeEVShadowMask() {
  const ev = this[MODULE_ID];
  if ( ev.shadowVisionMask ) return;

  // Mask that colors red areas that are lit / are viewable.
  const shader = ShadowVisionMaskShader.create(this);
  ev.shadowVisionMask = new EVQuadMesh(this.bounds, shader);
}

/**
 * New method: RenderedPointSource.prototype._updateEVShadowData
 * @param {object} changes    Object of change data corresponding to source.data properties.
 */
function _updateEVShadowData(changes, changeObj = {}) {
  const ev = this[MODULE_ID];
  if ( !ev || !ev.wallGeometry) return;

  changeObj.changedPosition = Object.hasOwn(changes, "x") || Object.hasOwn(changes, "y");
  changeObj.changedRadius = Object.hasOwn(changes, "radius");
  changeObj.changedElevation = Object.hasOwn(changes, "elevation");
  changeObj.changedRotation = Object.hasOwn(changes, "rotation");
  changeObj.changedEmissionAngle = Object.hasOwn(changes, "angle");

  if ( !Object.values(changeObj).some(x => x) ) return;
  // Shadow renderer must be updated after updates to
  // wallGeometry, shadowMesh, terrainShadowMesh.

  let shadowsChanged = false;

  // Shadow geometry and mesh
  if ( changeObj.changedPosition ) shadowsChanged = ev.wallGeometry.updateSourcePosition();
  if ( ev.shadowMesh.shader.sourceUpdated(this, changeObj) ) shadowsChanged ||= true;

  // Terrain shadow geometry and mesh
  if ( changeObj.changedPosition || changeObj.changedRadius ) ev.terrainShadowMesh.updateGeometry(this.bounds);
  if ( ev.terrainShadowMesh.shader.sourceUpdated(this, changeObj) ) shadowsChanged ||= true;

  // Renderer and mask
  if ( shadowsChanged ) ev.shadowRenderer.updatedSource(changeObj); // TODO: Do we need a separate check for changedRadius here?
  ev.shadowVisionMask.shader.updatedSource(this, changeObj);
}

/**
 * New method: RenderedPointSource.prototype.pointInShadow
 * Detect whether a point is in partial or full shadow based on testing wall collisions.
 * @param {Point3d|object} {x, y, z}    Object with x, y, and z properties. Z optional.
 * @returns {number} Approximate shadow value between 0 (no shadow) and 1 (full shadow).
 */
function pointInShadow({x, y, z} = {}) {
  /* Testing
  Point3d = CONFIG.GeometryLib.threeD.Point3d
  Plane = CONFIG.GeometryLib.threeD.Plane
  Draw = CONFIG.GeometryLib.Draw
  let [l] = canvas.lighting.placeables
  source = l.source
  x = _token.center.x
  y = _token.center.y
  z = _token.elevationZ

  // Or
  pt = Point3d.fromToken(_token).bottom
  let { x, y, z } = pt
  */

  z ??= canvas.elevation.elevationAt({x, y});
  const testPt = new Point3d(x, y, z);
  const origin = Point3d.fromPointSource(this);
  const midCollision = this.hasWallCollision(origin, testPt);
  const lightSize = this.data.lightSize;

  /* Draw.point(origin, { color: Draw.COLORS.yellow }) */

  if ( !lightSize ) return Number(midCollision);

  // Test the top/bottom/left/right points of the light for penumbra shadow.
  let dir = new Point3d(0, 0, lightSize);
  const topCollision = this.hasWallCollision(origin.add(dir), testPt);
  const bottomCollision = this.hasWallCollision(origin.subtract(dir), testPt);

  // Get the orthogonal direction to the origin --> testPt line at the light elevation.
  dir = testPt.subtract(origin);
  const orthoDir = (new Point3d(-dir.y, dir.x, 0)).normalize();
  dir = orthoDir.multiplyScalar(lightSize);
  const side0Collision = this.hasWallCollision(origin.add(dir), testPt);
  const side1Collision = this.hasWallCollision(origin.subtract(dir), testPt);

  // Shadows: side0/mid/side1 = 100%; side0/mid = 50%; mid/side1 = 50%; any one = 25%
  const sideSum = side0Collision + side1Collision + midCollision;
  let sideShadowPercentage;
  switch ( sideSum ) {
    case 0: sideShadowPercentage = 0; break;
    case 1: sideShadowPercentage = 0.25; break;
    case 2: sideShadowPercentage = 0.50; break;
    case 3: sideShadowPercentage = 1; break;
  }

  const heightSum = topCollision + bottomCollision + midCollision;
  let heightShadowPercentage;
  switch ( heightSum ) {
    case 0: heightShadowPercentage = 0; break;
    case 1: heightShadowPercentage = 0.25; break;
    case 2: heightShadowPercentage = 0.50; break;
    case 3: heightShadowPercentage = 1; break;
  }

  return heightShadowPercentage * sideShadowPercentage;
}

/**
 * New method: RenderedSource.prototype.targetInShadow
 * Detect whether a point is in partial or full shadow based on checking the shadow texture.
 * Currently works only for canvas elevation, accounting for terrain.
 * Returns the exact percentage or undefined if the shadow render texture is not present.
 */
function targetInShadow(target, testPoint) {
  /* Testing
  api = game.modules.get("elevatedvision").api
  PixelCache = api.PixelCache
  ShadowTextureRenderer = api.ShadowTextureRenderer
  Draw = CONFIG.GeometryLib.Draw
  Point3d = CONFIG.GeometryLib.threeD.Point3d

  let [l] = canvas.lighting.placeables
  source = l.source
  texture = source.elevatedvision.shadowRenderer.renderTexture

  shadowRenderer = source.elevatedvision.shadowRenderer;
  shadowCache = shadowRenderer.pixelCache;
  let { x, y } = shadowRenderer.meshPosition;


  redCache = PixelCache.fromTexture(texture, { channel: 0, x: -x, y: -y })
  greenCache = PixelCache.fromTexture(texture, { channel: 1, x: -x, y: -y })
  blueCache = PixelCache.fromTexture(texture, { channel: 2, x: -x, y: -y })

  pt = Point3d.fromToken(_token).bottom
  Draw.point(pt)

  r = redCache.pixelAtCanvas(pt.x, pt.y)
  g = greenCache.pixelAtCanvas(pt.x, pt.y)
  b = blueCache.pixelAtCanvas(pt.x, pt.y)
  ShadowTextureRenderer.shadowPixelCacheCombineFn(r, g, b)

  shadowCache.pixelAtCanvas(pt.x, pt.y)

  ln = redCache.pixels.length;
  for ( let i = 0; i < ln; i += 1000 ) {
    const r = redCache.pixels[i];
    const pt = redCache._canvasAtIndex(i);
    if ( r ) Draw.point(pt, { radius: 1, color: Draw.COLORS.red, alpha: r /255 })
  }

  // Benchmark
  function noCache(source, pt) {
    source.elevatedvision.shadowRenderer.clearPixelCache()
    return source.terrainPointInShadow(pt.x, pt.y);
  }

  function cache(source, pt) {
    return source.terrainPointInShadow(pt.x, pt.y);
  }

  function collision(source, pt) {
    return source.pointInShadow(pt)
  }


  await foundry.utils.benchmark(noCache, 10, source, pt)
  await foundry.utils.benchmark(cache, 1000, source, pt)
  await foundry.utils.benchmark(collision, 1000, source, pt)

  // single cache
  source.elevatedvision.shadowRenderer.clearPixelCache()
  await foundry.utils.benchmark(cache, 1000, source, pt)
  */

  testPoint ??= target;
  const shadowRenderer = this[MODULE_ID]?.shadowRenderer;
  if ( !shadowRenderer ) return this.pointInShadow(testPoint);

  // If the target is on the terrain (likely), we can use the faster test using pixelCache.
  const calc = target instanceof Token
    ? new canvas.elevation.TokenElevationCalculator(target)
    : new canvas.elevation.CoordinateElevationCalculator(testPoint);

  return calc.isOnTerrain()
    ? shadowPercentageFromCache(shadowRenderer.pixelCache, testPoint.x, testPoint.y)
    : this.pointInShadow(testPoint);
}

/**
 * New method: RenderedPointSource.prototype.wallAdded
 * Update shadow data based on the added wall, as necessary.
 * @param {Wall} wall     Wall that was added to the scene.
 */
function wallAdded(wall) { handleWallChange(this, wall, "addWall"); }

/**
 * New method: RenderedPointSource.prototype.wallUpdated
 * Update shadow data based on the updated wall, as necessary.
 * @param {Wall} wall     Wall that was updated in the scene.
 */
function wallUpdated(wall, changes) {
  handleWallChange(this, wall, "updateWall", { changes });
}

/**
 * New method: RenderedPointSource.prototype.wallRemoved
 * Update shadow data based on the removed wall, as necessary.
 * @param {Wall} wallId     Wall id that was removed from the scene.
 */
function wallRemoved(wallId) { handleWallChange(this, wallId, "removeWall"); }

function hasWallCollision(origin, testPt) {
  const type = this.constructor.sourceType;

  // For Wall Height, set origin.b and origin.t to trick it into giving us the walls.
  origin.b = Number.POSITIVE_INFINITY;
  origin.t = Number.NEGATIVE_INFINITY;
  const wallCollisions = CONFIG.Canvas.polygonBackends[type].testCollision(origin, testPt, {type, mode: "all", source: this});
  if ( !wallCollisions.length ) return false;

  const dir = testPt.subtract(origin);
  return wallCollisions.some(c => {
    const w = c.edges.values().next().value.wall;
    if ( !isFinite(w.topE) && !isFinite(w.bottomE) ) return true;

    const wallPts = Point3d.fromWall(w);
    const v0 = wallPts.A.top;
    const v1 = wallPts.A.bottom;
    const v2 = wallPts.B.bottom;
    const v3 = wallPts.B.top;
    return Plane.rayIntersectionQuad3dLD(origin, dir, v0, v1, v2, v3); // Null or t value
  });
}


PATCHES.WEBGL.METHODS = {
  _initializeEVShadows,
  _initializeEVShadowGeometry,
  _initializeEVShadowMesh,
  _initializeEVTerrainShadowMesh,
  _initializeEVShadowRenderer,
  _initializeEVShadowMask,
  _updateEVShadowData,

  wallAdded,
  wallUpdated,
  wallRemoved
};

PATCHES.VISIBILITY.METHODS = {
  hasWallCollision,
  pointInShadow,
  targetInShadow
};

// NOTE: WebGL Getters

/**
 * New getter: RenderedPointSource.prototype.EVShadowTexture
 */
function EVShadowTexture() {
  const ev = this[MODULE_ID];
  if ( !ev || !ev.shadowRenderer ) this._initializeEVShadows();
  return ev.shadowRenderer.renderTexture;
}

/**
 * New getter: RenderedPointSource.prototype.EVVisionMask
 */
function EVVisionMask() {
  const ev = this[MODULE_ID];
  if ( !ev || !ev.shadowVisionMask ) this._initializeEVShadows();
  return ev.shadowVisionMask;
}

/**
 * New getter: RenderedPointSource.prototype.bounds
 */
export function bounds() {
  const r = this.radius ?? this.data.externalRadius;
  if ( !r ) return this.object?.bounds ?? new PIXI.Rectangle(this.x - 1, this.y - 1, 2, 2);

  const { x, y } = this;
  const d = r * 2;
  return new PIXI.Rectangle(x - r, y - r, d, d);
}

PATCHES.WEBGL.GETTERS = {
  EVShadowTexture,
  EVVisionMask,
  bounds
};

// NOTE: WebGL Hooks

/**
 * Store a shadow texture for a given (rendered) source.
 * 1. Store wall geometry.
 * 2. Store a mesh with encoded shadow data.
 * 3. Render the shadow data to a texture.
 * @param {RenderedPointSource} source
 */
function initializeSourceShadersHook(source) {
  source._initializeEVShadows();
}

PATCHES.WEBGL.HOOKS = {
  initializeLightSourceShaders: initializeSourceShadersHook,
  initializeVisionSourceShaders: initializeSourceShadersHook,
  initializeDirectionalLightSourceShaders: initializeSourceShadersHook
};

// ----- Note: Helper functions -----
const PIXEL_INV = 1 / 255;

function shadowPercentageFromCache(pixelCache, x, y) {
  const lightAmount = pixelCache.pixelAtCanvas(x, y);
  return 1 - (lightAmount * PIXEL_INV);
}

/**
 * Utility function to handle variety of wall changes to a source.
 * @param {RenderedPointSource} source
 * @param {Wall} wall
 * @param {string} updateFn   Name of the update method for the wall geometry.
 * @param {object} opts       Options passed to updateFn
 */
function handleWallChange(source, wall, updateFn, opts = {}) {
  const ev = source[MODULE_ID];
  if ( !ev ) return;

  // At this point, the wall caused a change to the geometry. Update accordingly.
  if ( ev.wallGeometry?.[updateFn](wall, opts) ) ev.shadowRenderer.update();

  // For vision sources, update the LOS geometry.
  if ( ev.wallGeometryUnbounded?.[updateFn](wall, opts) ) ev.shadowVisionLOSRenderer.update();
}


