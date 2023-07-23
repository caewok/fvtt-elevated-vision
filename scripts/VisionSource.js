/* globals
canvas,
LimitedAnglePolygon,
PIXI

*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "./const.js";
import { Draw } from "./geometry/Draw.js";
import { ShadowVisionLOSTextureRenderer } from "./glsl/ShadowTextureRenderer.js";
import { ShadowVisionMaskTokenLOSShader } from "./glsl/ShadowVisionMaskShader.js";
import { SourceShadowWallGeometry } from "./glsl/SourceShadowWallGeometry.js";
import { EVQuadMesh } from "./glsl/EVQuadMesh.js";


// Methods related to VisionSource

export const PATCHES = {};
PATCHES.WEBGL = {};
PATCHES.VISIBILITY = {};

// ----- NOTE: Methods -----

/**
 * New method: VisionSource.prototype._initializeEVShadowGeometry
 * Use SourceShadowWallGeometry, which does not restrict based on source bounds.
 */
function _initializeEVShadowGeometry() {
  const ev = this[MODULE_ID];
  ev.wallGeometry ??= new SourceShadowWallGeometry(this);
}

/**
 * New method: VisionSource.prototype._initializeEVShadowRenderer
 * Render to the entire canvas to represent LOS.
 */
function _initializeEVShadowRenderer() {
  const ev = this[MODULE_ID];
  if ( ev.shadowRenderer ) return;

  // Force a uniform update, to avoid ghosting of placeables in the light radius.
  // TODO: Find the underlying issue and fix this!
  // Must be a new uniform variable (one that is not already in uniforms)
//   this.layers.background.shader.uniforms.uEVtmpfix = 0;
//   this.layers.coloration.shader.uniforms.uEVtmpfix = 0;
//   this.layers.illumination.shader.uniforms.uEVtmpfix = 0;

  // Render LOS to a texture for use by other shaders.
  ev.shadowRenderer = new ShadowVisionLOSTextureRenderer(this, ev.shadowMesh);
  ev.shadowRenderer.renderShadowMeshToTexture(); // TODO: Is this necessary here?
}

/**
 * New method: VisionSource.prototype._initializeEVShadowMask
 * Mask of entire canvas (LOS)
 */
function _initializeEVShadowMask() {
  const ev = this[MODULE_ID];
  if ( ev.shadowVisionLOSMask ) return;

  // Build the mask for the LOS based on the canvas dimensions rectangle.
  // Mask that colors red areas that are lit / are viewable.
  const shader = ShadowVisionMaskTokenLOSShader.create(this);
  ev.shadowVisionLOSMask = new EVQuadMesh(canvas.dimensions.rect, shader);
}

/**
 * New getter: VisionSource.prototype.EVVisionLOSMask
 * Line of sight for this vision source
 */
function EVVisionLOSMask() {
  const ev = this[MODULE_ID];

  if ( !ev?.shadowVisionLOSMask ) {
    console.error("elevatedvision|EVVisionLOSMaskVisionSource|No shadowVisionLOSMask.");
  }

  if ( this.object.hasLimitedSourceAngle ) {
    const c = new PIXI.Container();
    c.addChild(ev.graphicsLOS);
    c.addChild(ev.shadowVisionLOSMask);
    return c;
  }

  return ev.shadowVisionLOSMask;
}

/**
 * New method: VisionSource.prototype.targetInShadow
 * Do not use the shadow texture cache b/c it takes too long to construct and vision moves a lot.
 */
function targetInShadow(target, testPoint) {
  testPoint ??= target;
  return this.pointInShadow(testPoint);
}

PATCHES.WEBGL.METHODS = {
  _initializeEVShadowGeometry,
  _initializeEVShadowRenderer,
  _initializeEVShadowMask
};

PATCHES.VISIBILITY.METHODS = {
  targetInShadow
}

// ----- NOTE: Getters -----

/**
 * New getter: VisionSource.prototype.EVVisionMask
 * Field-of-view (FOV) for this vision source.
 */
function EVVisionMask() {
  const ev = this[MODULE_ID];

  if ( !ev?.graphicsFOV ) {
    console.error("elevatedvision|EVVisionMaskVisionSource|No graphicsFOV.");
  }

  return ev.graphicsFOV;
}

PATCHES.WEBGL.GETTERS = {
  EVVisionLOSMask,
  EVVisionMask
};

// ----- NOTE: Wraps -----

/**
 * Wrap VisionSource.prototype._createRestrictedPolygon
 * Create/update the graphics used for the FOV.
 */
function _createRestrictedPolygon(wrapped) {
  const ev = this[MODULE_ID] ??= {};
  ev.graphicsFOV ??= new PIXI.Graphics;
  const draw = new Draw(ev.graphicsFOV);
  draw.clearDrawings();

  // Mask the radius circle for this vision source.
  const fill = 0xFF0000;
  const width = 0;
  const origin = {x: this.data.x, y: this.data.y};
  const radius = this.data.radius || this.data.externalRadius;
  const circle = new PIXI.Circle(origin.x, origin.y, radius);
  draw.shape(circle, { width, fill });

  // Mask the limited angle vision for this vision source.
  if ( this.object.hasLimitedSourceAngle ) {
    ev.graphicsLOS ??= new PIXI.Graphics;
    const draw = new Draw(ev.graphicsLOS);
    draw.clearDrawings();
    const { radius, angle, rotation, externalRadius } = this.data;
    const ltdPoly = new LimitedAnglePolygon(this, { radius, angle, rotation, externalRadius });
    draw.shape(ltdPoly, { width, fill });
  }

  return wrapped();
}

PATCHES.WEBGL.WRAPS = {
  _createRestrictedPolygon
}
