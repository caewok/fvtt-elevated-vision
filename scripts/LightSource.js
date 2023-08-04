/* globals
PIXI,
RenderedPointSource
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, FLAGS } from "./const.js";
import { SETTINGS, getSetting } from "./settings.js";
import { SizedPointSourceShadowWallShader, ShadowMesh } from "./glsl/ShadowWallShader.js";

// Methods related to LightSource

export const PATCHES = {};
PATCHES.WEBGL = {};

/**
 * New method: LightSource.prototype._initializeEVShadowMesh
 * Use the penumbra shader
 */
function _initializeEVShadowMesh() {
  const ev = this[MODULE_ID];
  if ( ev.shadowMesh ) return;
  const shader = SizedPointSourceShadowWallShader.create(this);
  ev.shadowMesh = new ShadowMesh(ev.wallGeometry, shader);
}

/**
 * New method: LightSource.prototype._updateEVShadowData
 */
function _updateEVShadowData(changes, changeObj = {}) {
  // Sized point source shader must track light size.
  changeObj.changedLightSize = Object.hasOwn(changes, "lightSize");

  // Instead of super._updateEVShadowData()
  RenderedPointSource.prototype._updateEVShadowData.call(this, changes, changeObj);
}

PATCHES.WEBGL.METHODS = {
  _initializeEVShadowMesh,
  _updateEVShadowData
};

/**
 * Wrap method: LightSource.prototype._initialize
 * Add lightSize to source data
 */
function _initialize(wrapped, data) {
  wrapped(data);
  if ( !this.object ) return;
  this.data.lightSize = this.object.document.getFlag(MODULE_ID, FLAGS.LIGHT_SIZE)
    ?? getSetting(SETTINGS.LIGHTING.LIGHT_SIZE)
    ?? 0;
}

/**
 * Wrap method: LightSource.prototype._createPolygon()
 */
function _createPolygon(wrapped) {
  this.originalShape = wrapped();

  if ( getSetting(SETTINGS.LIGHTS_FULL_PENUMBRA) ) {
    // Instead of the actual polygon, pass an unblocked circle as the shape.
    // TODO: Can we just pass a rectangle and shadow portions of the light outside the radius?
    const cir = new PIXI.Circle(this.x, this.y, this.radius);
    return cir.toPolygon();
  }

  return this.originalShape;
}

/**
 * Wrap method: LightSource.prototype.updateCommonUniforms
 */
function _updateCommonUniforms(wrapped, shader) {
  const u = shader.uniforms;
  u.uEVCanvasDimensions = [canvas.dimensions.width, canvas.dimensions.height];
  u.uEVSourceOrigin = [this.x, this.y];
  u.uEVSourceRadius = this.radius;
  u.uEVShadowSampler = this.EVShadowTexture.baseTexture;
  u.uEVShadows = true;
  u.uEVDirectional = false;

  wrapped(shader);
}

PATCHES.WEBGL.WRAPS = {
  _initialize,
  _createPolygon,
  _updateCommonUniforms
};
