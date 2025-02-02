/* globals
canvas,
CONFIG,
PIXI,
Token
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { BVH } from "./BVH.js";
import { tokenIsOnGround, waypointIsOnGround, edgeElevationZ } from "../util.js";
import { ShadowBVHShader } from "./ShadowBVHShader.js";
import { EVUpdatingQuadMesh } from "./EVQuadMesh.js";
import { PixelCache } from "../geometry/PixelCache.js";
import { GlobalLightWebGLShadows, PointVisionWebGLShadows } from "./WebGLShadows.js";
import { DirectionalLightSource } from "../DirectionalLightSource.js";
import { ShadowTextureRenderer, ShadowDirectionalTextureRenderer } from "./ShadowTextureRenderer.js";
import { ShadowVisionMaskShader, ShadowVisionMaskTokenLOSShader } from "./ShadowVisionMaskShader.js";

export class WebGLShadowsBVH {
  /** @type {AbstractEVShader} */
  static shaderClass = ShadowBVHShader;

  /** @type {PIXI.Mesh} */
  static quadMeshClass = EVUpdatingQuadMesh;

  /** @type {ShadowTextureRenderer} */
  static shadowRendererClass = ShadowTextureRenderer;

  /** @type {AbstractEVShader} */
  static shadowMaskClass = ShadowVisionMaskShader;

  /** @type {RenderedPointSource} */
  source;

  /** @type {BVH} */
  bvh;

  /** @type {PIXI.RenderTexture} */
  bvhTexture;

  /** @type {EVUpdatingQuadMesh} */
  shadowMesh;

  /** @type {ShadowTextureRenderer} */
  shadowRenderer;

  /**
   * Retrieve the mask corresponding to this source.
   * Passed to CanvasVisibility to mask vision.
   * @type {EVUpdatingQuadMesh}
   */
  shadowVisionMask;

  constructor(source) {
    this.source = source;
  }

  /**
   * Retrieve the shadow texture corresponding to this source.
   * Used for lighting shaders and vision masking.
   * @type {PIXI.RenderTexture}
   */
  get shadowTexture() { return this.shadowRenderer.renderTexture; }

  /**
   * Create a new shadow handler specific to the source type.
   * @param {RenderedEffectSource} source
   * @returns {WebGLShadows}
   */
  static fromSource(source) {
    const srcs = foundry.canvas.sources;
    let cl;
    if ( source instanceof DirectionalLightSource ) cl = DirectionalLightWebGLShadowsBVH;
    else if ( source instanceof srcs.PointVisionSource ) cl = PointVisionWebGLShadows;
    else if ( source instanceof srcs.GlobalLightSource ) cl = GlobalLightWebGLShadows;
    else if ( source instanceof srcs.PointLightSource ) cl = PointLightWebGLShadowsBVH;
    return new cl(source);
  }

  /**
   * Initialize the shadow properties for this source.
   */
  #initialized = false;

  get initialized() { return this.#initialized; }

  initializeShadows() {
    if ( this.#initialized ) return;
    this._buildBVH();
    this._initializeShadowMesh();
    this._initializeShadowRenderer();
    this._initializeShadowMask();
    this.#initialized = true;
  }

  /**
   * Build the bvh for this source.
   */
  _buildBVH() {
    // Determine which edges need to be placed in the index.
    const edges = this._getEdges();

    const allEdges = CONFIG[MODULE_ID].edgeData;
    const edgeIds = new Set(edges.map(e => e.id));
    const edgeIdx = [];
    const nEdges = allEdges.length;
    for ( let i = 0; i < nEdges; i += 1 ) {
      const edgeDat = allEdges[i];
      if ( edgeIds.has(edgeDat.id) ) edgeIdx.push(i);
    }
    this.bvh = BVH.build(CONFIG[MODULE_ID].edgeData, edgeIdx);
    this.bvh.createTexture();
    this.bvh.createTextureCache();
  }

  /**
   * Build the shadow mesh for this source.
   * Use a quad sized to the source radius.
   * Shadows for all walls drawn into this.
   * Terrain shadows drawn into this.
   */
  _initializeShadowMesh() {
    const shader = this.constructor.shaderClass.create(this.source, this.bvhTexture, CONFIG[MODULE_ID].edgeTexture);
    this.shadowMesh = new this.constructor.quadMeshClass(this.bounds, shader);
  }

  /**
   * Set up the renderer for this source.
   * Render the shadow mesh to a texture.
   * Render to the entire canvas to represent LOS.
   * Render the wall shadows.
   */
  _initializeShadowRenderer() {
    this.shadowRenderer = new this.constructor.shadowRendererClass(this.source, this.shadowMesh);
  }

  /**
   * Initialize the mask used by CanvasVisibility and EVVisionMask.
   * Mask that colors red areas that are lit / are viewable.
   */
  _initializeShadowMask() {
    const shader = this.constructor.shadowMaskClass.create(this.source);
    this.shadowVisionMask = new this.constructor.quadMeshClass(this.bounds, shader);
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
   * Update based on indicated changes to the source.
   * @param {Set<string>} changes         Change keys for the source.
   * @returns {boolean} True if the indicated changes resulted in a change to the shader.
   */
  sourceUpdated(_changes) {
  }

  /**
   * Update shadow data based on the added edge, as necessary.
   * @param {Edge} edge     Edge that was added to the scene.
   */
  edgeAdded(_edge) {}

  /**
   * New method: RenderedEffectSource.prototype.edgeUpdated
   * Update shadow data based on the updated edge, as necessary.
   * @param {Edge} edge     Edge that was updated in the scene.
   */
  edgeUpdated(_edge, _changes) {}

  /**
   * New method: RenderedEffectSource.prototype.edgeRemoved
   * Update shadow data based on the removed edge, as necessary.
   * @param {Edge|string} edgeId     Edge or id of edge that was removed from the scene.
   */
  edgeRemoved(_edgeId) {}

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
    if ( !canvas.edges.size ) return new Set();
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
    // Keep collinear. if ( !side ) return false;

    // Ignore one-directional walls facing away from the origin.
    if ( side === edge.dir ) return false;

    // Ignore non-attenuated threshold walls where the threshold applies.
    if ( !edge.threshold?.attenuation && this.thresholdApplies(edge) ) return false;

    return true;
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
      testPoint = RegionMovementWaypoint3d
        .fromLocationWithElevation(testPoint, canvas.scene[MODULE_ID].elevationAt(testPoint));
    }

    const shadowRenderer = this.shadowRenderer;
    if ( !shadowRenderer ) return this.elevatedPointInShadow(testPoint);

    // If the target is on the terrain (likely), we can use the faster test using pixelCache.
    const onGround = target instanceof Token ? tokenIsOnGround(target) : waypointIsOnGround(testPoint);
    return onGround
      ? this.constructor._shadowPercentageFromCache(shadowRenderer.pixelCache, testPoint.x, testPoint.y)
      : this.elevatedPointInShadow(testPoint);
  }

  /** @type {boolean} */
  #destroyed = false;

  get destroyed() { return this.#destroyed; }

  /**
   * Destroy meshes, geometry, textures.
   */
  destroy() {
    if ( this.#destroyed ) return;
    this.shadowMesh?.destroy();
    this.shadowTerrainMesh?.destroy();
    // Unneeded? this.graphicsFOV.destroy();
    this.shadowRenderer?.destroy();
    this.shadowVisionMask?.destroy();
    this.#destroyed = true;
  }
}

export class PointLightWebGLShadowsBVH extends WebGLShadowsBVH {

   /**
   * Update based on indicated changes to the source.
   * @param {Set<string>} changes         Change keys for the source.
   * @returns {boolean} True if the indicated changes resulted in a change to the shader.
   */
  sourceUpdated(changes) {
    // Update the uniforms b/c they are not necessarily updated in drag operations.
    for ( const layer of Object.values(this.source.layers) ) {
      const shader = layer.shader;
      this._updateCommonUniforms(shader);
    }
    return super.sourceUpdated(changes);
  }

  /**
   * Update uniforms for the source shader.
   * @param {PIXI.Shader} shader
   */
  _updateCommonUniforms(shader) {
    // TODO: Fix and possibly move to the shader class.
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

export class DirectionalLightWebGLShadowsBVH extends WebGLShadowsBVH {}

