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
function _initializeEVShadowMask() {
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
function EVVisionLOSMask() {
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
  _initializeEVShadowMask,
  targetInShadow
};

/**
 * New getter: VisionSource.prototype.EVVisionMask
 * Field-of-view (FOV) for this vision source.
 */
function EVVisionMask() {
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

PATCHES.WEBGL.GETTERS = {
  EVVisionLOSMask,
  EVVisionMask
};

// ----- Note: Helper functions -----
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

