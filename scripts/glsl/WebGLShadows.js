/* globals
canvas,
CONFIG,
CONST,
foundry,
game,
PIXI,
Token,
Wall
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { tokenIsOnGround, waypointIsOnGround } from "../util.js";
import { Draw } from "../geometry/Draw.js";
import { ShadowWallShader, SizedPointSourceShadowWallShader, DirectionalShadowWallShader, ShadowMesh } from "./ShadowWallShader.js";
import { ShadowTerrainShader } from "./ShadowTerrainShader.js";
import { EVUpdatingQuadMesh, EVQuadMesh } from "./EVQuadMesh.js";
import { ShadowTextureRenderer, ShadowVisionLOSTextureRenderer, ShadowDirectionalTextureRenderer } from "./ShadowTextureRenderer.js";
import { ShadowVisionMaskShader, ShadowVisionMaskTokenLOSShader } from "./ShadowVisionMaskShader.js";
import { DirectionalLightSource } from "../DirectionalLightSource.js";
import { DirectionalSourceShadowWallGeometry, PointSourceShadowWallGeometry, SourceShadowWallGeometry } from "./SourceShadowWallGeometry.js";

const PIXEL_INV = 1 / 255;

/**
 * Class to handle managing webGL shadows.
 * Expected to be set at source.elevatedvision
 * The base class is set up for GlobalLightSource.
 */
export class WebGLShadows {

  static maskColor = 0xFF0000;

  /** @type {RenderedPointSource} */
  source;

  /** @type {SourceShadowWallGeometry} */
  wallGeometry;

  /** @type {} */
  // graphicsFOV;

  /** @type {ShadowTextureRenderer} */
  shadowRenderer;

  /** @type {ShadowMesh} */
  shadowMesh;

  /** @type {EVUpdatingQuadMesh} */
  shadowTerrainMesh;

  /**
   * Retrieve the mask corresponding to this source.
   * Passed to CanvasVisibility to mask vision.
   * @type {EVUpdatingQuadMesh}
   */
  shadowVisionMask;

  /**
   * @param {RenderedPointSource} source    Source of light or vision
   */
  constructor(source) {
    this.source = source;
  }

  /**
   * Retrieve the shadow texture corresponding to this source.
   * Used for lighting shaders and vision masking.
   * @type {PIXI.RenderTexture}
   */
  get shadowTexture() { return this.shadowRenderer.renderTexture; }

  /** @type {ShadowWallShader} */
  get wallShader() { return this.shadowMesh.shader; }

  /** @type {ShadowTerrainShader} */
  get terrainShader() { return this.shadowTerrainMesh.shader; }

  /** @type {ShadowVisionMaskShader} */
  get visionShader() { return this.shadowVisionMask.shader; }

  /**
   * Create a new shadow handler specific to the source type.
   * @param {RenderedEffectSource} source
   * @returns {WebGLShadows}
   */
  static fromSource(source) {
    const srcs = foundry.canvas.sources;
    let cl;
    if ( source instanceof DirectionalLightSource ) cl = DirectionalLightWebGLShadows;
    else if ( source instanceof srcs.PointVisionSource ) cl = PointVisionWebGLShadows;
    else if ( source instanceof srcs.GlobalLightSource ) cl = GlobalLightWebGLShadows;
    else if ( source instanceof srcs.PointLightSource ) cl = PointLightWebGLShadows;
    return new cl(source);
  }

  /** @type {PIXI.Rectangle} */
  get bounds() {
    const src = this.source;
    const r = src.radius ?? src.data.externalRadius;
    const { x, y } = src;
    if ( !r ) return src.object?.bounds ?? new PIXI.Rectangle(x - 1, y - 1, 2, 2);
    const d = r * 2;
    return new PIXI.Rectangle(x - r, y - r, d, d);
  }

  /**
   * Initialize the shadow properties for this source.
   */
  #initialized = false;

  get initialized() { return this.#initialized; }

  initializeShadows() {
    if ( this.#initialized ) return;
    this._initializeShadowGeometry();
    this._initializeShadowMesh();
    this._initializeTerrainShadowMesh();
    this._initializeShadowRenderer();
    this._initializeShadowMask();
    this.#initialized = true;
  }

  /**
   * Build the shadow geometry (edge/wall geometry) for this source.
   */
  _initializeShadowGeometry() { this.wallGeometry = new PointSourceShadowWallGeometry(this.source); }

  /**
   * Build the shadow mesh for this source.
   * Build terrain shadow + limited angle
   * Uses a quad sized to the canvas.
   * Shadows for walls coded to handle terrain walls.
   */
  _initializeShadowMesh() {
    const shader = ShadowWallShader.create(this.source);
    this.shadowMesh = new ShadowMesh(this.wallGeometry, shader);
  }

  /**
   * Shadow terrain when source is below.
   * Build terrain shadow + limited angle
   * Uses a quad sized to the source.
   */
  _initializeTerrainShadowMesh() {
    const shader = ShadowTerrainShader.create(this.source);
    this.shadowTerrainMesh = new EVUpdatingQuadMesh(this.bounds, shader);
  }

  /**
   * Set up the renderer for this source.
   * Render the shadow mesh to a texture.
   * Render to the entire canvas to represent LOS.
   * Render the wall shadows.
   */
  _initializeShadowRenderer() {
    this.shadowRenderer = new ShadowTextureRenderer(this.source, this.shadowMesh, this.shadowTerrainMesh);
  }

  /**
   * Initialize the mask used by CanvasVisibility and EVVisionMask.
   * Mask that colors red areas that are lit / are viewable.
   */
  _initializeShadowMask() {
    const shader = ShadowVisionMaskShader.create(this.source);
    this.shadowVisionMask = new EVUpdatingQuadMesh(this.bounds, shader);
  }

  /**
   * Update the shadow mesh, geometry, render, given changes.
   * @param {object} changes      Object of change data corresponding to source.data properties.
   * @param {object} [changeObj]  Keys for changed items to override the changes object
   */
  _updateShadowData(changes, changeObj = {}) {
    changeObj.changedPosition ??= Object.hasOwn(changes, "x") || Object.hasOwn(changes, "y");
    changeObj.changedRadius ??= Object.hasOwn(changes, "radius");
    changeObj.changedElevation ??= Object.hasOwn(changes, "elevation");
    changeObj.changedRotation ??= Object.hasOwn(changes, "rotation");
    changeObj.changedEmissionAngle ??= Object.hasOwn(changes, "angle");

    if ( !Object.values(changeObj).some(x => x) ) return;
    // Shadow renderer must be updated after updates to
    // wallGeometry, shadowMesh, terrainShadowMesh.

    let shadowsChanged = false;

    // Shadow geometry and mesh
    if ( changeObj.changedPosition ) shadowsChanged = this.wallGeometry.updateSourcePosition();
    if ( this.wallShader.sourceUpdated(this.source, changeObj) ) shadowsChanged ||= true;

    // Terrain shadow geometry and mesh
    if ( changeObj.changedPosition || changeObj.changedRadius ) this.shadowTerrainMesh.updateGeometry(this.bounds);
    if ( this.terrainShader.sourceUpdated(this.source, changeObj) ) shadowsChanged ||= true;

    // Renderer and mask
    if ( shadowsChanged ) this.shadowRenderer.updatedSource(changeObj); // TODO: Do we need a separate check for changedRadius here?
    if ( changeObj.changedPosition || changeObj.changedRadius ) this.shadowVisionMask.updateGeometry(this.bounds);
    this.visionShader.updatedSource(this.source, changeObj);
  }

  /**
   * Update all the meshes, shaders, geometries.
   */
  updateAll() {
    const changeObj = {
      changedPosition: true,
      changedRadius: true,
      changedElevation: true,
      changedRotation: true,
      changedEmissionAngle: true
    };
    return this._updateShadowData(undefined, changeObj);
  }

  /**
   * Update shadow data based on the added edge, as necessary.
   * @param {Edge} edge     Edge that was added to the scene.
   */
  edgeAdded(edge) { this._handleEdgeChange(this, edge, "addEdge"); }

  /**
   * New method: RenderedEffectSource.prototype.edgeUpdated
   * Update shadow data based on the updated edge, as necessary.
   * @param {Edge} edge     Edge that was updated in the scene.
   */
  edgeUpdated(edge, changes) { this._handleEdgeChange(this, edge, "updateEdge", { changes }); }

  /**
   * New method: RenderedEffectSource.prototype.edgeRemoved
   * Update shadow data based on the removed edge, as necessary.
   * @param {Edge} edgeId     Edge id that was removed from the scene.
   */
  edgeRemoved(edgeId) { this._handleEdgeChange(this, edgeId, "removeEdge"); }

  /**
   * Detect whether a point is in partial or full shadow based on testing wall collisions.
   * @param {RegionMovementWaypoint3d} elevatedPoint
   * @returns {number} Approximate shadow value between 0 (no shadow) and 1 (full shadow).
   */
  elevatedPointInShadow(elevatedPoint) {
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

    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const src = this.source;
    const origin = Point3d.fromPointSource(this.source);
    const midCollision = this.hasEdgeCollision(origin, elevatedPoint);
    const lightSize = src.data.lightSize;

    /* Draw.point(origin, { color: Draw.COLORS.yellow }) */

    if ( !lightSize ) return Number(midCollision);

    // Test the top/bottom/left/right points of the light for penumbra shadow.
    let dir = new Point3d(0, 0, lightSize);
    const topCollision = this.hasEdgeCollision(origin.add(dir), elevatedPoint);
    const bottomCollision = this.hasEdgeCollision(origin.subtract(dir), elevatedPoint);

    // Get the orthogonal direction to the origin --> elevatedPoint line at the light elevation.
    dir = elevatedPoint.subtract(origin);
    const orthoDir = (new Point3d(-dir.y, dir.x, 0)).normalize();
    dir = orthoDir.multiplyScalar(lightSize);
    const side0Collision = this.hasEdgeCollision(origin.add(dir), elevatedPoint);
    const side1Collision = this.hasEdgeCollision(origin.subtract(dir), elevatedPoint);

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
   * Return percentage shadow for given target and a point on or near the target.
   * Relies on pixelMesh.
   * Detect whether a point is in partial or full shadow based on checking the shadow texture.
   * Currently works only for canvas elevation, accounting for terrain.
   * Returns the exact percentage or undefined if the shadow render texture is not present.
   * @param {Token} target
   * @param {RegionWaypoint3d} testPoint
   * @returns {number} Between 0 and 1.
   */
  targetInShadow(target, testPoint) {
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
      return source.elevatedPointInShadow(pt)
    }


    await foundry.utils.benchmark(noCache, 10, source, pt)
    await foundry.utils.benchmark(cache, 1000, source, pt)
    await foundry.utils.benchmark(collision, 1000, source, pt)

    // single cache
    source.elevatedvision.shadowRenderer.clearPixelCache()
    await foundry.utils.benchmark(cache, 1000, source, pt)
    */

    const RegionMovementWaypoint3d = CONFIG.GeometryLib.threeD.RegionMovementWaypoint3d;
    testPoint ??= target instanceof Token
      ? RegionMovementWaypoint3d.fromLocationWithElevation(target.center, target.elevationE)
      : target;
    if ( !Object.hasOwn(testPoint, "z") ) {
      testPoint = RegionMovementWaypoint3d.fromLocationWithElevation(testPoint, canvas.scene[MODULE_ID].elevationAt(testPoint));
    }

    const shadowRenderer = this.shadowRenderer;
    if ( !shadowRenderer ) return this.elevatedPointInShadow(testPoint);

    // If the target is on the terrain (likely), we can use the faster test using pixelCache.
    const onGround = target instanceof Token ? tokenIsOnGround(target) : waypointIsOnGround(testPoint);
    return onGround
      ? this.#shadowPercentageFromCache(shadowRenderer.pixelCache, testPoint.x, testPoint.y)
      : this.elevatedPointInShadow(testPoint);
  }

  static #shadowPercentageFromCache(pixelCache, x, y) {
    const lightAmount = pixelCache.pixelAtCanvas(x, y);
    return 1 - (lightAmount * PIXEL_INV);
  }

  /**
   * Utility function to handle variety of edge changes to a source.
   * @param {RenderedEffectSource} source
   * @param {Edge} edge
   * @param {string} updateFn   Name of the update method for the wall geometry.
   * @param {object} opts       Options passed to updateFn
   */
  _handleEdgeChange(source, edge, updateFn, opts = {}) {
    // At this point, the wall caused a change to the geometry. Update accordingly.
    if ( this.wallGeometry[updateFn](edge, opts) ) this.shadowRenderer.update();
  }

  /**
   * For threshold edges, determine if threshold applies.
   * @param {Edge} edge
   * @returns {boolean} True if the threshold applies.
   */
  thresholdApplies(edge) {
    const src = this.source;
    return edge.applyThreshold(src.constructor.sourceType, src, src.data.externalRadius);
  }

  /**
   * Find the set of of walls that could potentially interact with this source.
   * Does not consider 3d collisions, just whether the wall potentially blocks.
   * @param {PIXI.Rectangle} bounds
   * @returns {Set<Wall>}
   */
  _getEdges(bounds) {
    const src = this.source;
    const origin = PIXI.Point.fromObject(src);
    bounds ??= this.bounds;
    const collisionTest = o => this._testEdgeInclusion(o.t, origin);
    return canvas.edges.quadtree.getObjects(bounds, { collisionTest });
  }

  /**
   * Comparable to PointSourcePolygon.prototype._testWallInclusion
   * Test for whether a given wall interacts with this source.
   * Used to filter walls in the quadtree in _getWalls
   * @param {Edge} edge
   * @param {PIXI.Point} origin
   * @returns {boolean}
   */
  _testEdgeInclusion(edge, origin) {
    const src = this.source;

    // Ignore walls that are non-blocking for this type.
    const type = src.constructor.sourceType;
    if ( !edge[type] || edge.isOpen ) return false;

    // TODO: Handle elevation for ramps where walls are not equal
    const { topZ, bottomZ } = edgeElevationZ(edge);

    // If edge is entirely above the light, do not keep.
    const elevationZ = src.elevationZ;
    if ( bottomZ > elevationZ ) return false;

    // If wall is entirely below the canvas and source is above, do not keep.
    const minCanvasE = canvas.scene[MODULE_ID]?.minElevation ?? canvas.scene.getFlag(MODULE_ID, "elevationmin") ?? 0;
    if ( topZ <= minCanvasE && elevationZ > minCanvasE ) return false;

    // Ignore collinear walls
    const side = edge.orientPoint(origin);
 //   if ( !side ) return false;

    // Ignore one-directional walls facing away from the origin.
    if ( side === edge.dir ) return false;

    // Ignore non-attenuated threshold walls where the threshold applies.
    if ( !edge.threshold?.attenuation && this.thresholdApplies(edge) ) return false;

    return true;
  }


  /**
   * Destroy meshes, geometry, textures.
   */
  #destroyed = false;

  get destroyed() { return this.#destroyed; }

  destroy() {
    if ( this.#destroyed ) return;
    this.wallGeometry.destroy();
    this.shadowMesh.destroy();
    this.shadowTerrainMesh.destroy();
    // this.graphicsFOV.destroy();
    this.shadowRenderer.destroy();
    this.shadowVisionMask.destroy();
  }

  /**
   * Test if this source has an edge collision between this source origin and test point.
   * Does not consider whether the test point is within radius of the source origin.
   * @param {PIXI.Point} testPt           Point to test against source origin
   * @returns {boolean}
   */
  hasEdgeCollision(origin, testPt) {
    const { Plane, Point3d, RegionMovementWaypoint3d } = CONFIG.GeometryLib.threeD;
    origin = Point3d.fromObject(origin);
    testPt = Point3d.fromObject(testPt);

    // Get walls within the bounding box that frames origin --> testPt.
    const xMinMax = Math.minMax(origin.x, testPt.x);
    const yMinMax = Math.minMax(origin.y, testPt.y);
    const lineBounds = new PIXI.Rectangle(
      xMinMax.min,
      yMinMax.min,
      xMinMax.max - xMinMax.min,
      yMinMax.max - yMinMax.min);
    const edges = this._getEdges(lineBounds);
    if ( !edges.size ) return false;

    // Test the intersection of the ray with each wall.
    const MAX_ELEV = 1e06;
    const MIN_ELEV = -MAX_ELEV;
    const dir = testPt.subtract(origin);
    return edges.some(edge => {
      // Check if the test point falls within an attenuation area.
      const edgeElevs = edge.elevationLibGeometry;
      const v0 = RegionMovementWaypoint3d.fromLocationWithElevation(edge.a, edgeElevs.a.top ?? MAX_ELEV);
      const v1 = RegionMovementWaypoint3d.fromLocationWithElevation(edge.a, edgeElevs.a.bottom ?? MIN_ELEV);
      const v2 = RegionMovementWaypoint3d.fromLocationWithElevation(edge.b, edgeElevs.b.top ?? MAX_ELEV);
      const v3 = RegionMovementWaypoint3d.fromLocationWithElevation(edge.b, edgeElevs.b.bottom ?? MIN_ELEV);
      const t = Plane.rayIntersectionPolygon3d(origin, dir, [v0, v1, v2, v3]); // Null or t value
      if (!t || t < 0 || t > 1 ) return false;
      return true;
    });
  }

}

export class GlobalLightWebGLShadows extends WebGLShadows {

  constructor(source) {
    super(source);
    this.#initializeVisionMask();
  }

  initializeShadows() { } // Nothing to initialize for the global.

  /**
   * Define the canvas rectangle as a graphics object.
   */
  #initializeVisionMask() {
    this.shadowVisionMask = new PIXI.Graphics();
    const draw = new Draw(this.shadowVisionMask);
    draw.shape(this.source.shape, { fill: this.source.constructor.maskColor });
  }

  destroy() {
    this.shadowVisionMask.destroy();
    // Rest never created so no need to destroy.
  }

  /**
   * Update uniforms for the source shader.
   * @param {PIXI.Shader} shader
   */
  _updateCommonUniforms(shader) {
    const u = shader.uniforms;
    u.uEVShadows = false;
    u.uEVDirectional = false;
  }

  /**
   * Utility function to handle variety of edge changes to a source.
   * For global light source, ignore.
   * @param {RenderedEffectSource} source
   * @param {Edge} edge
   * @param {string} updateFn   Name of the update method for the wall geometry.
   * @param {object} opts       Options passed to updateFn
   */
  _handleEdgeChange(_source, _edge, _updateFn, _opts = {}) {}
}


export class PointVisionWebGLShadows extends WebGLShadows {

  /** @type {PIXI.Rectangle} */
  get bounds() { return canvas.dimensions.rect; }

  /** @type {PIXI.Graphics} */
  shadowFOVMask = new PIXI.Graphics();

  /**
   * Update the graphics used for the field of view.
   */
  updateFOV() {
    const data = this.source.data;
    const draw = new Draw(this.shadowFOVMask);
    draw.clearDrawings();

    // Mask the radius circle for this vision source.
    const fill = this.constructor.maskColor;
    const width = 0;
    const radius = data.radius || data.externalRadius;
    const circle = new PIXI.Circle(data.x, data.y, radius);
    draw.shape(circle, { width, fill });
  }

  /**
   * Build the shadow geometry (edge/wall geometry) for this source.
   */
  _initializeShadowGeometry() { this.wallGeometry = new SourceShadowWallGeometry(this.source); }

  /**
   * Shadow terrain when source is below.
   * Build terrain shadow + limited angle
   * Uses a quad sized to the source.
   */
  _initializeTerrainShadowMesh() {
    const shader = ShadowTerrainShader.create(this.source);
    this.shadowTerrainMesh = new EVQuadMesh(canvas.dimensions.rect, shader);
  }

  /**
   * Set up the renderer for this source.
   * Render the shadow mesh to a texture.
   * Render to the entire canvas to represent LOS.
   * Render the wall shadows.
   */
  _initializeShadowRenderer() {
    this.shadowRenderer = new ShadowVisionLOSTextureRenderer(this.source, this.shadowMesh, this.shadowTerrainMesh);
  }

  /**
   * Initialize the mask used by CanvasVisibility and EVVisionMask.
   * Mask that colors red areas that are lit / are viewable.
   */
  _initializeShadowMask() {
    const shader = ShadowVisionMaskTokenLOSShader.create(this.source);
    this.shadowVisionMask = new EVQuadMesh(canvas.dimensions.rect, shader);
  }

  /**
   * New method: VisionSource.prototype.targetInShadow
   * Do not use the shadow texture cache b/c it takes too long to construct and vision moves a lot.
   * @param {Token} target
   * @param {RegionMovementWaypoint3d} testPoint
   */
  targetInShadow(target, testPoint) {
    const RegionMovementWaypoint3d = CONFIG.GeometryLib.threeD.RegionMovementWaypoint3d;
    testPoint ??= target instanceof Token
      ? RegionMovementWaypoint3d.fromLocationWithElevation(target.center, target.elevationE)
      : target;
    if ( !Object.hasOwn(testPoint, "z") ) {
      testPoint = RegionMovementWaypoint3d.fromLocationWithElevation(testPoint, canvas.scene[MODULE_ID].elevationAt(testPoint));
    }
    return this.elevatedPointInShadow(testPoint);
  }

  /**
   * Utility function to handle variety of edge changes to a source.
   * @param {RenderedEffectSource} source
   * @param {Edge} edge
   * @param {string} updateFn   Name of the update method for the wall geometry.
   * @param {object} opts       Options passed to updateFn
   */
  _handleEdgeChange(source, edge, updateFn, opts = {}) {
    super._handleEdgeChange(source, edge, updateFn, opts);

    // For vision sources, update the LOS geometry.
    if ( this.wallGeometryUnbounded?.[updateFn](edge, opts) ) this.shadowVisionLOSRenderer.update();
  }

  /**
   * For vision, include all edges in the scene bounds, because
   * unseen edges can block vision from light sources beyond this source range.
   * @param {PIXI.Rectangle} bounds
   * @returns {Set<Wall>}
   */
  _getEdges(bounds) {
    const edges = super._getEdges(bounds);

    // Issue #81: Perceptive compatibility.
    const IgnoreWall = game.modules.get("perceptive")?.api?.IgnoreWall;
    const token = this.object;
    if ( IgnoreWall && token ) return edges.filter(e => e.source !== Wall
      || !IgnoreWall(e.source.document, token.document));
    return edges;
  }

}

export class PointLightWebGLShadows extends WebGLShadows {

  /**
   * Initialize the mask used by CanvasVisibility and EVVisionMask.
   * Mask that colors red areas that are lit / are viewable.
   * For point lights, use the penumbra shader
   */

  _initializeShadowMesh() {
    const shader = SizedPointSourceShadowWallShader.create(this.source);
    this.shadowMesh = new ShadowMesh(this.wallGeometry, shader);
  }

  /**
   * Update the shadow mesh, geometry, render, given changes.
   * @param {object} changes      Object of change data corresponding to source.data properties.
   * @param {object} [changeObj]  Keys for changed items to override the changes object
   */
  _updateShadowData(changes, changeObj = {}) {
    // Sized point source shader must track light size.
    changeObj.changedLightSize ??= Object.hasOwn(changes, "lightSize");

    // Update the uniforms b/c they are not necessarily updated in drag operations.
    for ( const layer of Object.values(this.source.layers) ) {
      const shader = layer.shader;
      this._updateCommonUniforms(shader);
    }
    super._updateShadowData(changes, changeObj);
  }

  /**
   * Update uniforms for the source shader.
   * @param {PIXI.Shader} shader
   */
  _updateCommonUniforms(shader) {
    const u = shader.uniforms;
    const src = this.source;
    u.uEVCanvasDimensions = [canvas.dimensions.width, canvas.dimensions.height];
    u.uEVSourceOrigin = [src.x, src.y];
    u.uEVSourceRadius = src.radius;
    u.uEVShadowSampler = this.shadowTexture.baseTexture;
    u.uEVShadows = true;
    u.uEVDirectional = false;
  }


}

export class DirectionalLightWebGLShadows extends PointLightWebGLShadows {
  /**
   * Build the shadow geometry (edge/wall geometry) for this source.
   */
  _initializeShadowGeometry() { this.wallGeometry = new DirectionalSourceShadowWallGeometry(this.source); }

  /**
   * Build the shadow mesh for this source.
   * Build terrain shadow + limited angle
   * Uses a quad sized to the canvas.
   * Shadows for walls coded to handle terrain walls.
   */
  _initializeShadowMesh() {
    const shader = DirectionalShadowWallShader.create(this.source);
    this.shadowMesh = new ShadowMesh(this.wallGeometry, shader);
  }

  /**
   * Set up the renderer for this source.
   * Render the shadow mesh to a texture.
   * Render to the entire canvas to represent LOS.
   * Render the wall shadows.
   */
  _initializeShadowRenderer() {
    this.shadowRenderer = new ShadowDirectionalTextureRenderer(this.source, this.shadowMesh, this.shadowTerrainMesh);
  }

  /**
   * Initialize the mask used by CanvasVisibility and EVVisionMask.
   * Mask that colors red areas that are lit / are viewable.
   */
  _initializeShadowMask() {
    const shader = ShadowVisionMaskTokenLOSShader.create(this.source);
    this.shadowVisionMask = new EVQuadMesh(canvas.dimensions.rect, shader);
  }

  /**
   * Update the shadow mesh, geometry, render, given changes.
   * @param {object} changes      Object of change data corresponding to source.data properties.
   * @param {object} [changeObj]  Keys for changed items to override the changes object
   */
  _updateShadowData(changes, changeObj = {}) {
    if ( Object.hasOwn(changes, "x") || Object.hasOwn(changes, "y") ) {
      changeObj.changedAzimuth ??= true;
      changeObj.changedElevationAngle ??= true;
    }
    changeObj.changedSolarAngle ??= Object.hasOwn(changes, "solarAngle");
    super._updateShadowData(changes, changeObj);
  }

  /**
   * Update uniforms for the source shader.
   * @param {PIXI.Shader} shader
   */
  _updateCommonUniforms(shader) {
    super._updateCommonUniforms(shader);
    shader.uniforms.uEVDirectional = true;
  }

  /**
   * Destroy meshes, geometry, textures.
   */
  _destroy() {
    // Prevent the grid from getting stuck "on".
    canvas.lighting.removeChild(DirectionalLightSource._elevationAngleGrid);
    super._destroy();
  }

  /**
   * Detect whether a point is in partial or full shadow based on testing wall collisions.
   * @param {RegionMovementWaypoint3d} elevatedPoint
   * @returns {number} Approximate shadow value between 0 (no shadow) and 1 (full shadow).
   */
  elevatedPointInShadow(elevatedPoint) {
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


    // Project a point out beyond the canvas to stand in for the light position.
    const { azimuth, elevationAngle, solarAngle } = this;
    const midCollision = this.hasEdgeCollision(elevatedPoint, azimuth, elevationAngle);

    /* Draw.point(origin, { color: Draw.COLORS.yellow }) */
    if ( !solarAngle ) return Number(midCollision);

    // Test the top/bottom/left/right points of the light for penumbra shadow.
    const topCollision = this.hasEdgeCollision(elevatedPoint, azimuth, elevationAngle + solarAngle);
    const bottomCollision = this.hasEdgeCollision(elevatedPoint, elevatedPoint, azimuth, elevationAngle - solarAngle);
    const side0Collision = this.hasEdgeCollision(elevatedPoint, elevatedPoint, azimuth + solarAngle, elevationAngle);
    const side1Collision = this.hasEdgeCollision(elevatedPoint, elevatedPoint, azimuth - solarAngle, elevationAngle);

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
   * Comparable to PointSourcePolygon.prototype._testWallInclusion
   * Test for whether a given wall interacts with this source.
   * Used to filter walls in the quadtree in _getWalls
   * @param {Edge} edge
   * @param {number} azimuth
   * @param {number} elevationAngle
   * @returns {boolean}
   */
  _testEdgeInclusion(edge, azimuth, elevationAngle) {
    // Ignore reverse proximity walls (b/c this is a near-infinite light source)
    const src = this.source;
    const type = src.constructor.sourceType;
    if ( edge[type] === CONST.WALL_SENSE_TYPES.DISTANCE ) return false;

    // Ignore walls that are non-blocking for this type.
    if ( !edge[type] || edge.isOpen ) return false;

    // Ignore collinear walls
    // Create a fake source origin point to test orientation\
    azimuth ??= src.azimuth;
    elevationAngle ??= src.elevationAngle;
    const dir = DirectionalLightSource.lightDirection(azimuth, elevationAngle);
    const origin = PIXI.Point.fromObject(edge.b).add(dir.multiplyScalar(canvas.dimensions.maxR));
    const side = edge.orientPoint(origin);
    if ( !side ) return false;

    // Ignore one-directional walls facing away from the origin.
    if ( side === edge.dir ) return false;

    // If wall is entirely below the canvas, do not keep.
    const minCanvasE = canvas.scene[MODULE_ID]?.minElevation ?? canvas.scene.getFlag(MODULE_ID, "elevationmin") ?? 0;
    if ( edge.topZ <= minCanvasE ) return false;

    return true;
  }

  _getWalls(bounds, azimuth, elevationAngle) {
    bounds ??= this.bounds;
    const collisionTest = o => this._testEdgeInclusion(o.t, azimuth, elevationAngle);
    return canvas.walls.quadtree.getObjects(bounds, { collisionTest });
  }

  /**
   * Use a fake origin to test for collision.
   * Allow azimuth and elevationAngle to be adjusted.
   */
  hasEdgeCollision(testPt, azimuth, elevationAngle) {
    azimuth ??= this.azimuth;
    elevationAngle ??= this.elevationAngle;
    const dir = DirectionalLightSource.lightDirection(azimuth, elevationAngle);
    const origin = testPt.add(dir.multiplyScalar(canvas.dimensions.maxR));

    const xMinMax = Math.minMax(origin.x, testPt.x);
    const yMinMax = Math.minMax(origin.y, testPt.y);
    const lineBounds = new PIXI.Rectangle(
      xMinMax.min,
      yMinMax.min,
      xMinMax.max - xMinMax.min,
      yMinMax.max - yMinMax.min);
    const edges = this._getEdges(lineBounds, azimuth, elevationAngle);
    if ( !edges.size ) return false;

    // Test the intersection of the ray with each wall.
    const { Point3d, Plane } = CONFIG.GeometryLib.threeD;
    const rayDir = testPt.subtract(origin);
    return edges.some(edge => {
      const { topZ, bottomZ } = edgeElevationZ(edge);
      if ( !isFinite(topZ) && !isFinite(bottomZ) ) return true;

      // Build a vertical quad to represent the wall and intersect the ray against it.
      const v0 = new Point3d(edge.a.x, edge.a.y, topZ);
      const v1 = new Point3d(edge.a.x, edge.a.y, bottomZ);
      const v2 = new Point3d(edge.b.x, edge.b.y, bottomZ);
      const v3 = new Point3d(edge.b.x, edge.by.y, topZ);
      return Plane.rayIntersectionQuad3dLD(origin, rayDir, v0, v1, v2, v3); // Null or t value
    });
  }

/**
   * Detect whether a point is in partial or full shadow based on testing wall collisions.
   * @param {RegionMovementWaypoint3d} elevatedPoint
   * @returns {number} Approximate shadow value between 0 (no shadow) and 1 (full shadow).
   */
  elevatedPointInShadow(elevatedPoint) {
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


    const src = this.source;

    // Project a point out beyond the canvas to stand in for the light position.
    const { azimuth, elevationAngle, solarAngle } = src;
    const midCollision = this.hasEdgeCollision(elevatedPoint, azimuth, elevationAngle);

    /* Draw.point(origin, { color: Draw.COLORS.yellow }) */
    if ( !solarAngle ) return Number(midCollision);

    // Test the top/bottom/left/right points of the light for penumbra shadow.
    const topCollision = this.hasEdgeCollision(elevatedPoint, azimuth, elevationAngle + solarAngle);
    const bottomCollision = this.hasEdgeCollision(elevatedPoint, elevatedPoint, azimuth, elevationAngle - solarAngle);
    const side0Collision = this.hasEdgeCollision(elevatedPoint, elevatedPoint, azimuth + solarAngle, elevationAngle);
    const side1Collision = this.hasEdgeCollision(elevatedPoint, elevatedPoint, azimuth - solarAngle, elevationAngle);

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
   * Find the set of of walls that could potentially interact with this source.
   * Does not consider 3d collisions, just whether the wall potentially blocks.
   * @param {PIXI.Rectangle} bounds
   * @returns {Set<Wall>}
   */
  _getEdges(bounds, azimuth, elevationAngle) {
    bounds ??= this.bounds;
    const collisionTest = o => this._testEdgeInclusion(o.t, azimuth, elevationAngle);
    return canvas.walls.quadtree.getObjects(bounds, { collisionTest });
  }
}

  /**
 * Return the top and bottom elevation for an edge.
 * @param {Edge} edge
 * @returns {object}
 *   - @prop {number} topE      Elevation in grid units
 *   - @prop {number} bottomE   Elevation in grid units
 */
export function edgeElevationE(edge) {
  // TODO: Handle elevation for ramps where walls are not equal
  const { a, b } = edge.elevationLibGeometry;
  const topE = Math.max(
    a.top ?? Number.POSITIVE_INFINITY,
    b.top ?? Number.POSITIVE_INFINITY);
  const bottomE = Math.min(
    a.bottom ?? Number.NEGATIVE_INFINITY,
    b.bottom ?? Number.NEGATIVE_INFINITY);
  return { topE, bottomE };
}

/**
 * Return the top and bottom elevation for an edge.
 * @param {Edge} edge
 * @returns {object}
 *   - @prop {number} topZ      Elevation in base units
 *   - @prop {number} bottomZ   Elevation in base units
 */
export function edgeElevationZ(edge) {
  const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
  const { topE, bottomE } = edgeElevationE(edge);
  return { topZ: gridUnitsToPixels(topE), bottomZ: gridUnitsToPixels(bottomE) };
}
