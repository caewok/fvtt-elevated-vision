/* globals
AmbientLight,
canvas,
duplicate,
game,
LightSource,
PIXI
PlaceablesLayer
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { SourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";
import { ShadowWallPointSourceMesh } from "./glsl/ShadowWallShader.js";
import { ShadowVisionLOSTextureRenderer } from "./glsl/ShadowTextureRenderer.js";
import { ShadowVisionMaskTokenLOSShader } from "./glsl/ShadowVisionMaskShader.js";
import { EVQuadMesh } from "./glsl/EVQuadMesh.js";


// Directional Light
// Assumed to be infinitely far, like a sun, and so causes directional shadows only.
// Similar to GlobalLightSource in that it overrides the polygon shape.
export class DirectionalLightSource extends LightSource {

  /** @override */
  _createPolygon() {
    return canvas.dimensions.rect.toPolygon();
  }

  /** @override */
  _initialize(data) {
    super._initialize(data);
    // Force attenuation to 0
    this.data.attenuation = 0;

    // Inflate radius to avoid seeing the edges of the GlobalLight in huge maps without padding
    // TODO: replace with better handling of rectangular shapes and custom shader
    this.data.radius = canvas.dimensions.maxR;

    this.data.azimuth = this.data.azimuth ?? 0;
    this.data.elevationAngle = this.data.elevationAngle ?? 45;
  }

  /**
   * The direction from which the light is coming.
   * Follows Foundry convention that 0 is east, 90º is south.
   * (Normally, azimuth is 0º when sun is to the north.)
   * @type {number} Between 0º and 360º
   */
  get azimuth() { return this.data.azimuth; }

  /**
   * Elevation angle from the horizon.
   * 0º is at the horizon, 90º is directly overhead.
   * @type {number} Between 0º and 90º
   */
  get elevationAngle() { return this.data.elevationAngle; }

  /**
   * Calculate azimuth and elevation based on position of the light.
   * elevationAngle decreases proportionally based on distance from the center.
   * Uses the smallest of canvas width or height to determine the full radius.
   * Azimuth set based on angle measured from canvas center.
   * @param {PIXI.Point} position
   * @returns { azimuth: {number}, elevationAngle: {number} }
   */
  static directionalParametersFromPosition(position) {
    position = PIXI.Point.fromObject(position);

    // Calculate azimuth based on the angle of the ray from center --> position.
    const rect = canvas.dimensions.rect;
    const center = rect.center;
    const delta = position.subtract(center);
    const angle = Math.atan2(delta.y, delta.x);
    const azimuth = Math.normalizeDegrees(Math.toDegrees(angle));

    // Calculate elevation angle based on distance from center.
    // 90º when at the center.
    const maxDist = Math.min(rect.width, rect.height);
    const proportion = 1 - (PIXI.Point.distanceBetween(position, center) / maxDist);
    const elevationAngle = mix(0, 45, proportion);

    return { azimuth, elevationAngle };
  }

  /**
   * Construct a new directional source using light source data.
   * @param {LightSource}
   * @returns {DirectionalLightSource}
   */
  static fromLightSource(ls) {
    const ds = new this({ object: ls.object });
    const sourceData = duplicate(ls.data);
    ds.initialize(sourceData);

    return ds;
  }

  /**
   * Construct a new light source using this directional source data
   * @returns {LightSource}
   */
  toLightSource() {
    const ls = new LightSource({ object: this.object });
    const sourceData = duplicate(this.data);
    ls.initialize(sourceData);
    return ls;
  }

  // NOTE: EV Shadows

  /**
   * Use SourceShadowWallGeometry, which does not restrict based on source bounds.
   */
  _initializeEVShadowGeometry() {
    const ev = this[MODULE_ID];
    ev.wallGeometry ??= new SourceShadowWallGeometry(this);
  }

  /**
   * Renderer covers the entire canvas.
   */
  _initializeEVShadowTexture() {
    const ev = this[MODULE_ID];
    if ( ev.shadowRenderer ) return;

    // Mesh that describes shadows for the given geometry and source origin.
    ev.shadowMesh = new ShadowWallPointSourceMesh(this, ev.wallGeometry);

    // Force a uniform update, to avoid ghosting of placeables in the light radius.
    // TODO: Find the underlying issue and fix this!
    // Must be a new uniform variable (one that is not already in uniforms)
    this.layers.background.shader.uniforms.uEVtmpfix = 0;
    this.layers.coloration.shader.uniforms.uEVtmpfix = 0;
    this.layers.illumination.shader.uniforms.uEVtmpfix = 0;

    // Render texture to store the shadow mesh for use by other shaders.
    ev.shadowRenderer = new ShadowVisionLOSTextureRenderer(this, ev.shadowMesh);
    ev.shadowRenderer.renderShadowMeshToTexture(); // TODO: Is this necessary here?
  }

  /**
   * Mask the entire canvas.
   */
  _initializeEVShadowMask() {
    const ev = this[MODULE_ID];
    if ( ev.shadowVisionMask ) return;

    // Build the mask based on the canvas dimensions rectangle.
    // Mask that colors red areas that are lit / are viewable.
    const shader = ShadowVisionMaskTokenLOSShader.create(ev.shadowRenderer.renderTexture);
    ev.shadowVisionMask = new EVQuadMesh(canvas.dimensions.rect, shader);
  }
}


export class DirectionalLight extends AmbientLight {
  constructor(document) {
    super(document);

    /**
     * A reference to the PointSource object which defines this light source area of effect
     * @type {DirectionalLightSource}
     */
    this.source = new DirectionalLightSource({object: this});
  }

  /** @inheritdoc */
  get bounds() { return canvas.dimensions.rect; }

  /**
   * The maximum radius in pixels of the light field.
   * @type {number}
   */
  get radius() { return canvas.dimensions.maxR; }
}


/**
 * New method: LightingLayer.prototype._onClickLeft
 * Handle click left; add directional light when enabled.
 */
export async function _onClickLeftLightingLayer(event) {
  const activeTool = game.activeTool;
  if ( activeTool === "directional-light" ) {
    const interaction = event.interactionData;
    const cls = getDocumentClass("AmbientLight");
    const doc = new cls(interaction.origin, {parent: canvas.scene});
    const preview = new DirectionalLight(doc);
    return await cls.create(preview.document.toObject(false), { parent: canvas.scene });
  }
  return PlaceablesLayer.prototype._onClickLeft.call(this, event);
}

/**
 * Mixed wrap LightingLayer.prototype._onDragLeftStart
 * If the Directional Light is enabled, ignore drag left.
 * @override
 */
export async function _onDragLeftStartLightingLayer(wrapped, event) {
  const activeTool = game.activeTool;
  if ( activeTool !== "directional-light" ) return wrapped(event);
  return PlaceablesLayer.prototype._onDragLeftStart.call(this, event);
}

/**
 * Mixed wrap LightingLayer.prototype._onDragLeftMove
 * If the Directional Light is enabled, ignore drag left.
 * @override
 */
export async function _onDragLeftMoveLightingLayer(wrapped, event) {
  const activeTool = game.activeTool;
  if ( activeTool !== "directional-light" ) return wrapped(event);
  return PlaceablesLayer.prototype._onDragLeftMove.call(this, event);
}

/**
 * Mixed wrap LightingLayer.prototype._onDragLeftCancel
 * If the Directional Light is enabled, ignore drag left.
 * @override
 */
export async function _onDragLeftCancelLightingLayer(wrapped, event) {
  const activeTool = game.activeTool;
  if ( activeTool !== "directional-light" ) return wrapped(event);
  return PlaceablesLayer.prototype._onDragLeftCancel.call(this, event);
}


/**
 * Linear interpolation of x and y numeric values based on "a" weight. Comparable to GLSL mix function.
 * @param {number} x    Start of range
 * @param {number} y    End of range
 * @param {number} a    Percentage between 0 and 1
 * @returns {number}
 */
function mix(x, y, a) {
  return (x * (1 - a)) + (y * a);
}


function replaceAmbientLightSourceWithDirectional(light) {
  light.updateSource({ deleted: true });
  light.source = new DirectionalLightSource({object: light});
  light.updateSource();


  light.updateSource({ deleted: true });
  light.source = new LightSource({object: light});
  light.updateSource();


  const ds = DirectionalLightSource.fromLightSource(light.source);
  light.updateSource({ deleted: true });
  light.source = ds;
  light.updateSource();
}

/* Testing
MODULE_ID = "elevatedvision"
Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get("elevatedvision").api
PointSourceShadowWallGeometry = api.PointSourceShadowWallGeometry
defineFunction = api.defineFunction;
AbstractEVShader = api.AbstractEVShader
ShadowWallShader = api.ShadowWallShader
ShadowWallPointSourceMesh = api.ShadowWallPointSourceMesh
TestGeometryShader = api.TestGeometryShader
ShadowTextureRenderer = api.ShadowTextureRenderer
DirectionalLightSource = api.DirectionalLightSource

let [light] = canvas.lighting.placeables
*/
