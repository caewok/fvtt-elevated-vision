/* globals
PIXI,
RenderedPointSource
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, FLAGS } from "./const.js";
import { SETTINGS, getSetting } from "./settings.js";
import { ShadowWallSizedPointSourceMesh } from "./glsl/ShadowWallShader.js";
import { pointCircleCoordNorm } from "./util.js";

// Methods related to LightSource

export const PATCHES = {};
PATCHES.WEBGL = {};

/**
 * New method: LightSource.prototype._initializeEVShadows
 * Add uniforms for limited angle
 */
function _initializeEVShadows() {
  // Instead of super._initializeEVShadows()
  RenderedPointSource.prototype._initializeEVShadows.call(this);

  // Set uniforms used by the lighting shader for limited angle lighting
  const rot = this.data.rotation || 360;
  const emissionAngle = this.data.angle || 360;
  const rotRad = Math.normalizeRadians(Math.toRadians(rot + 90));
  const halfAngle = Math.toRadians(emissionAngle * 0.5);
  const rMin = PIXI.Point.fromAngle(PIXI.Point.fromObject(this), rotRad - halfAngle, 100.0);
  const rMax = PIXI.Point.fromAngle(PIXI.Point.fromObject(this), rotRad + halfAngle, 100.0);
  const rMinUV = pointCircleCoordNorm(rMin, this, this.radius);
  const rMaxUV = pointCircleCoordNorm(rMax, this, this.radius);
  const rMinMax = [rMinUV.x, rMinUV.y, rMaxUV.x, rMaxUV.y];
  Object.values(this.layers).forEach(layer => {
    const u = layer.shader.uniforms;
    u.uEVrMinMax = rMinMax;
    u.uEVEmissionAngle = emissionAngle;
  });
}

/**
 * New method: LightSource.prototype._initializeEVShadowMesh
 * Use the penumbra shader
 */
function _initializeEVShadowMesh() {
  const ev = this[MODULE_ID];
  ev.shadowMesh ??= new ShadowWallSizedPointSourceMesh(this, ev.wallGeometry);
}

/**
 * New method: LightSource.prototype._updateEVShadowData
 */
function _updateEVShadowData(changes) {
  // Instead of super._updateEVShadowData()
  RenderedPointSource.prototype._updateEVShadowData.call(this, changes);

  const ev = this[MODULE_ID];
  const changedLightSize = Object.hasOwn(changes, "lightSize");
  if ( changedLightSize ) {
    ev.shadowMesh.updateLightSize();
    ev.shadowRenderer.update();
  }
}

PATCHES.WEBGL.METHODS = {
  _initializeEVShadows,
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

PATCHES.WEBGL.WRAPS = {
  _initialize,
  _createPolygon
};
