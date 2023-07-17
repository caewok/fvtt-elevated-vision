/* globals
canvas,
CONFIG,
flattenObject,
Hooks,
LimitedAnglePolygon,
PIXI,
RenderedPointSource,
Token
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, FLAGS } from "./const.js";
import { Draw } from "./geometry/Draw.js";
import { Plane } from "./geometry/3d/Plane.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { SETTINGS, getSetting } from "./settings.js";

import { ShadowWallPointSourceMesh, ShadowWallSizedPointSourceMesh } from "./glsl/ShadowWallShader.js";
import { ShadowTextureRenderer, ShadowVisionLOSTextureRenderer } from "./glsl/ShadowTextureRenderer.js";
import { PointSourceShadowWallGeometry, SourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";
import { ShadowVisionMaskShader, ShadowVisionMaskTokenLOSShader } from "./glsl/ShadowVisionMaskShader.js";
import { EVQuadMesh } from "./glsl/EVQuadMesh.js";

/* Shadow texture workflow

LightSource
1. wallGeometry (PointSourceShadowWallGeometry extends PIXI.Geometry)
   Walls within radius of the light source.
2. shadowMesh (ShadowWallPointSourceMesh extends PIXI.Mesh)
   - shader: ShadowWallShader based on source position
   - geometry: wallGeometry (1)
3. shadowRenderer (ShadowTextureRenderer)
   - mesh: shadowMesh (2)
   Renders the shadowMesh to a texture. Updates the render texture using:
     - updateSourceRadius
     - update
   --> shadowRenderer.renderTexture output
4. shadowVisionMask (PIXI.Mesh)
   - shader: ShadowVisionMaskShader.
     Draws only lighted areas in red, discards shadow areas.
     Uses shadowRenderer.renderTexture (3) as uniform
   - geometry: source.layers.background.mesh.geometry
     Could probably use QuadMesh with light bounds instead but might need the circle radius.

VisionSource FOV
1–5: Same as LightSource. Used for the FOV, which has a radius.

VisionSource LOS
1–3: Same as LightSource.
     Geometry not limited by radius.

3.1 shadowVisionLOSRenderer (ShadowVisionLOSTextureRenderer extends ShadowTextureRenderer)
    Same as shadowRenderer for LightSource.
    Render the shadowMesh to a texture.


3.2: losGeometry (PIXI.Geometry)
   Triangulation of the vision.los (unconstrained) polygon.
   Update using vision.updateLOSGeometry()

4: shadowVisionLOSMask
   - shader: ShadowVisionMaskTokenLOSShader
     Draws only lighted areas in red, discards shadow areas.
     Uses shadowVisionLOSRenderer.renderTexture (3.1) as uniform

*/

// NOTE: Wraps for RenderedPointSource methods.

export function _configureRenderedPointSource(wrapped, changes) {
  wrapped(changes);

  // At this point, ev property should exist on source b/c of initialize shaders hook.
  const ev = this[MODULE_ID];
  if ( !ev ) return;

  this._updateEVShadowData(changes);
}

export function destroyRenderedPointSource(wrapped) {
  const ev = this[MODULE_ID];
  if ( !ev ) return wrapped();

  const assets = [
    // RenderedSource
    "shadowMesh",
    "shadowRenderer",
    "shadowVisionMask",
    "wallGeometry",

    // VisionSource
    "shadowVisionLOSMask",
    "shadowVisionLOSRenderer"
  ];

  for ( const asset of assets ) {
    if ( !ev[asset] ) continue;
    ev[asset].destroy();
    ev[asset] = undefined;
  }

  return wrapped();
}

// NOTE: Hooks used for updating source shadow geometry, mesh, texture

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

/* RenderedSource
// Methods
- _initializeEVShadowGeometry
- _initializeEVShadowTexture
- _initializeEVShadowMask
- _updateEVShadowData

// Getters
- EVVisionMask

// elevatedvision properties
- wallGeometry
- shadowMesh
- shadowRenderer
- shadowVisionMask
*/

/* VisionSource
// Methods
- _initializeEVShadowGeometry (override) (use unbounded geometry)
- _initializeEVShadowTexture (mixed)
- _initializeEVShadowMask (mixed)
- _updateEVShadowData (mixed)

// Getters
- EVVisionLOSMask
- EVVisionMask (override)

// elevatedvision properties
- shadowVisionLOSRenderer
- shadowVisionLOSMask

*/

/* GlobalLightSource
// Methods
- _initializeEVShadowGeometry (override)
- _initializeEVShadowTexture (override)
- _initializeEVShadowMask (override)
- _updateEVShadowData (override)

// Getters
- EVVisionMask (override)

*/


// NOTE: RenderedSource shadow methods and getters

/**
 * New method: RenderedPointSource.prototype._initializeEVShadows
 */
export function _initializeEVShadowsRenderedPointSource() {
  if ( !this[MODULE_ID] ) this[MODULE_ID] = {};

  // Build the geometry, shadow texture, and vision mask.
  this._initializeEVShadowGeometry();
  this._initializeEVShadowMesh();
  this._initializeEVShadowRenderer();
  this._initializeEVShadowMask();

  // TODO: Does this need to be reset every time?
  const ev = this[MODULE_ID];
  this.layers.illumination.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
  this.layers.coloration.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
  this.layers.background.shader.uniforms.uEVShadowSampler = ev.shadowRenderer.renderTexture.baseTexture;
}

/**
 * New method: RenderedPointSource.prototype._initializeEVShadowGeometry
 */
export function _initializeEVShadowGeometryRenderedPointSource() {
  const ev = this[MODULE_ID];
  ev.wallGeometry ??= new PointSourceShadowWallGeometry(this);
}

/**
 *  Mesh that describes shadows for the given geometry and source origin.
 * New method: RenderedPointSource.prototype._initializeEVShadowMesh
 */
export function _initializeEVShadowMeshRenderedPointSource() {
  const ev = this[MODULE_ID];
  ev.shadowMesh ??= new ShadowWallPointSourceMesh(this, ev.wallGeometry);
}

/**
 * New method: RenderedPointSource.prototype._initializeShadowRenderer
 */
export function _initializeEVShadowRendererRenderedPointSource() {
  const ev = this[MODULE_ID];
  if ( ev.shadowRenderer ) return;

  // Force a uniform update, to avoid ghosting of placeables in the light radius.
  // TODO: Find the underlying issue and fix this!
  // Must be a new uniform variable (one that is not already in uniforms)
  this.layers.background.shader.uniforms.uEVtmpfix = 0;
  this.layers.coloration.shader.uniforms.uEVtmpfix = 0;
  this.layers.illumination.shader.uniforms.uEVtmpfix = 0;

  // Render texture to store the shadow mesh for use by other shaders.
  ev.shadowRenderer = new ShadowTextureRenderer(this, ev.shadowMesh);
  ev.shadowRenderer.renderShadowMeshToTexture(); // TODO: Is this necessary here?
}

/**
 * New method: RenderedPointSource.prototype._initializeEVShadowMask
 */
export function _initializeEVShadowMaskRenderedPointSource() {
  const ev = this[MODULE_ID];
  if ( ev.shadowVisionMask ) return;

  // Mask that colors red areas that are lit / are viewable.
  const shader = ShadowVisionMaskShader.create(this, ev.shadowRenderer.renderTexture);
  ev.shadowVisionMask = new EVQuadMesh(this.bounds, shader);
}

/**
 * New getter: RenderedPointSource.prototype.EVVisionMask
 */
export function EVVisionMaskRenderedPointSource() {
  if ( !this[MODULE_ID]?.shadowVisionMask ) {
    console.error("elevatedvision|EVVisionMaskRenderedPointSource|No shadowVisionMask.");
  }

  return this[MODULE_ID].shadowVisionMask;
}

/**
 * New method: RenderedPointSource.prototype._updateEVShadowData
 */
export function _updateEVShadowDataRenderedPointSource(changes) {
  const ev = this[MODULE_ID];
  if ( !ev || !ev.wallGeometry) return;

  const changedPosition = Object.hasOwn(changes, "x") || Object.hasOwn(changes, "y");
  const changedRadius = Object.hasOwn(changes, "radius");
  const changedElevation = Object.hasOwn(changes, "elevation");

  if ( !(changedPosition || changedRadius || changedElevation) ) return;

  ev.wallGeometry.refreshWalls();
  ev.shadowMesh.updateLightPosition();

  if ( changedRadius ) {
    ev.shadowRenderer.updateSourceRadius();

    // VisionSource does not have shadowVisionMask
    ev.shadowVisionMask?.shader.updateSourceRadius(this);
  }

  if ( changedPosition ) {
    ev.shadowRenderer.update();

    // VisionSource does not have shadowVisionMask
    ev.shadowVisionMask?.updateGeometry(this.bounds);
    ev.shadowVisionMask?.shader.updateSourcePosition(this);

  } else if ( changedRadius ) {
    // VisionSource does not have shadowVisionMask
    ev.shadowVisionMask?.updateGeometry(this.bounds);

  } else if ( changedElevation ) {
    ev.shadowRenderer.update();
  }
}


/**
 * New method: RenderedPointSource.prototype.pointInShadow
 * Detect whether a point is in partial or full shadow based on testing wall collisions.
 * @param {Point3d|object} {x, y, z}    Object with x, y, and z properties. Z optional.
 * @returns {number} Approximate shadow value between 0 (no shadow) and 1 (full shadow).
 */
export function pointInShadowRenderedPointSource({x, y, z} = {}) {
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

export function hasWallCollisionRenderedPointSource(origin, testPt) {
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

/**
 * New method: RenderedSource.prototype.terrainPointInShadow
 * Detect whether a point is in partial or full shadow based on checking the shadow texture.
 * Currently works only for canvas elevation, accounting for terrain.
 * Returns the exact percentage or undefined if the shadow render texture is not present.
 */
export function targetInShadowRenderedSource(target, testPoint) {
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

const PIXEL_INV = 1 / 255;
function shadowPercentageFromCache(pixelCache, x, y) {
  const lightAmount = pixelCache.pixelAtCanvas(x, y);
  return 1 - (lightAmount * PIXEL_INV);
}

// NOTE: LightSource shadow methods and getters
// Use the advanced penumbra shader

// Patches for AmbientLight
export const BRIGHTNESS_LEVEL = {
  NONE: 0,
  DIM: 1,
  BRIGHT: 2
};

/**
 * New method: LightSource.prototype._initializeEVShadowMesh
 * Use the penumbra shader
 */
export function _initializeEVShadowMeshLightSource() {
  const ev = this[MODULE_ID];
  ev.shadowMesh ??= new ShadowWallSizedPointSourceMesh(this, ev.wallGeometry);
}

/**
 * New method: LightSource.prototype._updateEVShadowData
 */
export function _updateEVShadowDataLightSource(changes) {
  // Instead of super._updateEVShadowData()
  RenderedPointSource.prototype._updateEVShadowData.call(this, changes);

  const ev = this[MODULE_ID];
  const changedLightSize = Object.hasOwn(changes, "lightSize");
  if ( changedLightSize ) {
    ev.shadowMesh.updateLightSize();
    ev.shadowRenderer.update();
  }
}

/**
 * Wrap method: LightSource.prototype._initialize
 * Add lightSize to source data
 */
export function _initializeLightSource(wrapped, data) {
  wrapped(data);
  if ( !this.object ) return;
  this.data.lightSize = this.object.document.getFlag(MODULE_ID, FLAGS.LIGHT_SIZE)
    ?? getSetting(SETTINGS.LIGHTING.LIGHT_SIZE)
    ?? 0;
}

/**
 * Wrap method: LightSource.prototype._createPolygon()
 */
export function _createPolygonLightSource(wrapped) {
  this.originalShape = wrapped();

  if ( getSetting(SETTINGS.LIGHTS_FULL_PENUMBRA) ) {
    // Instead of the actual polygon, pass an unblocked circle as the shape.
    // TODO: Can we just pass a rectangle and shadow portions of the light outside the radius?
    const cir = new PIXI.Circle(this.x, this.y, this.radius);
    return cir.toPolygon();
  }

  return this.originalShape;
}


// NOTE: VisionSource shadow methods and getters

/**
 * New method: VisionSource.prototype._initializeEVShadowGeometry
 * Use SourceShadowWallGeometry, which does not restrict based on source bounds.
 */
export function _initializeEVShadowGeometryVisionSource() {
  const ev = this[MODULE_ID];
  ev.wallGeometry ??= new SourceShadowWallGeometry(this);
}

/**
 * New method: VisionSource.prototype._initializeEVShadowRenderer
 * Render to the entire canvas to represent LOS.
 */
export function _initializeEVShadowRendererVisionSource() {
  const ev = this[MODULE_ID];
  if ( ev.shadowRenderer ) return;

  // Force a uniform update, to avoid ghosting of placeables in the light radius.
  // TODO: Find the underlying issue and fix this!
  // Must be a new uniform variable (one that is not already in uniforms)
  this.layers.background.shader.uniforms.uEVtmpfix = 0;
  this.layers.coloration.shader.uniforms.uEVtmpfix = 0;
  this.layers.illumination.shader.uniforms.uEVtmpfix = 0;

  // Render LOS to a texture for use by other shaders.
  ev.shadowRenderer = new ShadowVisionLOSTextureRenderer(this, ev.shadowMesh);
  ev.shadowRenderer.renderShadowMeshToTexture(); // TODO: Is this necessary here?
}

/**
 * New method: VisionSource.prototype._initializeEVShadowMask
 * Mask of entire canvas (LOS)
 */
export function _initializeEVShadowMaskVisionSource() {
  const ev = this[MODULE_ID];
  if ( ev.shadowVisionLOSMask ) return;

  // Build the mask for the LOS based on the canvas dimensions rectangle.
  // Mask that colors red areas that are lit / are viewable.
  const shader = ShadowVisionMaskTokenLOSShader.create(ev.shadowRenderer.renderTexture);
  ev.shadowVisionLOSMask = new EVQuadMesh(canvas.dimensions.rect, shader);
}

/**
 * New getter: VisionSource.prototype.EVVisionLOSMask
 * Line of sight for this vision source
 */
export function EVVisionLOSMaskVisionSource() {
  if ( !this[MODULE_ID]?.shadowVisionLOSMask ) {
    console.error("elevatedvision|EVVisionLOSMaskVisionSource|No shadowVisionLOSMask.");
  }

  // This seems to cause problems; do this in FOV instead.
  //   if ( this.object.hasLimitedSourceAngle ) {
  //     // Add a mask for the limited angle polygon.
  //     const { angle, rotation, externalRadius } = this.data;
  //     const radius = canvas.dimensions.maxR;
  //     const ltdPoly = new LimitedAnglePolygon(this, { radius, angle, rotation, externalRadius });
  //     return addShapeToShadowMask(ltdPoly, this[MODULE_ID].shadowVisionLOSMask);
  //   }

  return this[MODULE_ID].shadowVisionLOSMask;
}

/**
 * New getter: VisionSource.prototype.EVVisionMask
 * Field-of-view (FOV) for this vision source.
 */
export function EVVisionMaskVisionSource() {
  if ( !this[MODULE_ID]?.shadowVisionLOSMask ) {
    console.error("elevatedvision|EVVisionMaskVisionSource|No shadowVisionLOSMask.");
  }

  if ( this.object.hasLimitedSourceAngle ) {
    // Add a mask for the limited angle polygon.
    const { radius, angle, rotation, externalRadius } = this.data;
    const ltdPoly = new LimitedAnglePolygon(this, { radius, angle, rotation, externalRadius });
    return addShapeToShadowMask(ltdPoly, this[MODULE_ID].shadowVisionLOSMask);
  }

  // Mask the radius circle for this vision source.
  // Do not add as mask to container; can simply add to container as a child
  // b/c the entire container is treated as a mask by the vision system.
  const r = this.radius || this.data.externalRadius;
  const cir = new PIXI.Circle(this.x, this.y, r);
  return addShapeToShadowMask(cir, this[MODULE_ID].shadowVisionLOSMask);
}

/**
 * Build a new container with two children: the shadowMask and the shape, as a graphic.
 * @param {PIXI.Circle|PIXI.Rectangle|PIXI.Polygon} shape
 * @param {PIXI.Mesh} shadowMask
 * @returns {PIXI.Container}
 */
function addShapeToShadowMask(shape, shadowMask) {
  const c = new PIXI.Container();
  c.addChild(shadowMask);

  // Draw the shape and add to the container
  // Set width = 0 to avoid drawing a border line. The border line will use antialiasing
  // and that causes a border to appear outside the shape.
  const g = new PIXI.Graphics();
  const draw = new Draw(g);
  draw.shape(shape, { width: 0, fill: 0xFF0000 });
  c.addChild(g);
  return c;
}

/**
 * New method: VisionSource.prototype.targetInShadow
 * Do not use the shadow texture cache b/c it takes too long to construct and vision moves a lot.
 */
export function targetInShadowVisionSource(target, testPoint) {
  testPoint ??= target;
  return this.pointInShadow(testPoint);
}

// NOTE: GlobalLightSource shadow methods and getters
/**
 * Return early for initialization and update methods b/c not calculating shadows.
 * New methods:
 * - GlobalLightSource.prototype._initializeEVShadows
 * - GlobalLightSource.prototype._initializeEVShadowGeometry
 * - GlobalLightSource.prototype._initializeEVShadowTexture
 * - GlobalLightSource.prototype._initializeEVShadowMask
 * - GlobalLightSource.prototype._updateEVShadowData
 */
export function _initializeEVShadowGeometryGlobalLightSource() { return undefined; }
export function _initializeEVShadowMeshGlobalLightSource() { return undefined; }
export function _initializeEVShadowRendererGlobalLightSource() { return undefined; }
export function _initializeEVShadowMaskGlobalLightSource() { return undefined; }
export function _updateEVShadowDataGlobalLightSource(_opts) { return undefined; }
export function _initializeEVShadowsGlobalLightSource() { return undefined; }

/**
 * New getter: GlobalLightSource.prototype.EVVisionMask
 */
export function EVVisionMaskGlobalLightSource() {
  // TODO: This could be cached somewhere, b/c this.shape does not change unless canvas changes.
  const g = new PIXI.Graphics();
  const draw = new Draw(g);
  draw.shape(this.shape, { fill: 0xFF0000 });
  return g;
}

// NOTE: Wall handling for RenderedPointSource

/**
 * New method: RenderedPointSource.prototype.wallAdded
 * Update shadow data based on the added wall, as necessary.
 * @param {Wall} wall     Wall that was added to the scene.
 */
export function wallAddedRenderedPointSource(wall) { handleWallChange(this, wall, "addWall"); }

/**
 * New method: RenderedPointSource.prototype.wallUpdated
 * Update shadow data based on the updated wall, as necessary.
 * @param {Wall} wall     Wall that was updated in the scene.
 */
export function wallUpdatedRenderedPointSource(wall, changes) {
  handleWallChange(this, wall, "updateWall", { changes });
}

/**
 * New method: RenderedPointSource.prototype.wallRemoved
 * Update shadow data based on the removed wall, as necessary.
 * @param {Wall} wallId     Wall id that was removed from the scene.
 */
export function wallRemovedRenderedPointSource(wallId) { handleWallChange(this, wallId, "removeWall"); }


/**
 * New getter: RenderedPointSource.prototype.bounds
 */
export function boundsRenderedPointSource() {
  const r = this.radius ?? this.data.externalRadius;
  if ( !r ) return this.object?.bounds ?? new PIXI.Rectangle(this.x - 1, this.y - 1, 2, 2);

  const { x, y } = this;
  const d = r * 2;
  return new PIXI.Rectangle(x - r, y - r, d, d);
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


// NOTE: Wall Document Hooks

/**
 * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
 * Substitute the Document name in the hook event to target a specific type, for example "createToken".
 * This hook fires for all connected clients after the creation has been processed.
 *
 * @event createDocument
 * @category Document
 * @param {Document} document                       The new Document instance which has been created
 * @param {DocumentModificationContext} options     Additional options which modified the creation request
 * @param {string} userId                           The ID of the User who triggered the creation workflow
 */
function createWallHook(wallD, _options, _userId) {
  const sources = [
    ...canvas.effects.lightSources,
    ...canvas.tokens.placeables.map(t => t.vision)
  ];

  for ( const src of sources ) src.wallAdded(wallD.object);
}

/**
 * A hook event that fires for every Document type after conclusion of an update workflow.
 * Substitute the Document name in the hook event to target a specific Document type, for example "updateActor".
 * This hook fires for all connected clients after the update has been processed.
 *
 * @event updateDocument
 * @category Document
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateWallHook(wallD, data, _options, _userId) {
  const changes = new Set(Object.keys(flattenObject(data)));
  // TODO: Will eventually need to monitor changes for sounds and sight, possibly move.
  // TODO: Need to deal with threshold as well
  if ( !(SourceShadowWallGeometry.CHANGE_FLAGS.some(f => changes.has(f))) ) return;

  const sources = [
    ...canvas.effects.lightSources,
    ...canvas.tokens.placeables.map(t => t.vision)
  ];

  for ( const src of sources ) src.wallUpdated(wallD.object, changes);
}

/**
 * A hook event that fires for every Document type after conclusion of an deletion workflow.
 * Substitute the Document name in the hook event to target a specific Document type, for example "deleteActor".
 * This hook fires for all connected clients after the deletion has been processed.
 *
 * @event deleteDocument
 * @category Document
 * @param {Document} document                       The existing Document which was deleted
 * @param {DocumentModificationContext} options     Additional options which modified the deletion request
 * @param {string} userId                           The ID of the User who triggered the deletion workflow
 */
function deleteWallHook(wallD, _options, _userId) {
  const sources = [
    ...canvas.effects.lightSources,
    ...canvas.tokens.placeables.map(t => t.vision)
  ];

  for ( const src of sources ) src.wallRemoved(wallD.id);
}

/**
 * Hook ambient light refresh to address the refreshElevation renderFlag.
 * Update the source elevation.
 * See AmbientLight.prototype._applyRenderFlags.
 * @param {PlaceableObject} object    The object instance being refreshed
 * @param {RenderFlags} flags
 */
function refreshAmbientLightHook(light, flags) {
  if ( flags.refreshElevation ) {
    light.source?._updateEVShadowData({ elevation: light.elevationZ });
    canvas.perception.update({refreshLighting: true, refreshVision: true});
  }
}

// Hooks.on("drawAmbientLight", drawAmbientLightHook);

Hooks.on("createWall", createWallHook);
Hooks.on("updateWall", updateWallHook);
Hooks.on("deleteWall", deleteWallHook);

Hooks.on("initializeLightSourceShaders", initializeSourceShadersHook);
Hooks.on("initializeVisionSourceShaders", initializeSourceShadersHook);
Hooks.on("initializeDirectionalLightSourceShaders", initializeSourceShadersHook);

Hooks.on("refreshAmbientLight", refreshAmbientLightHook);
