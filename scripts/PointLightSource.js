/* globals
canvas,
GlobalLightSource
PIXI,
BaseLightSource
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, FLAGS } from "./const.js";
import { Settings } from "./settings.js";
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

  // Update the uniforms b/c they are not necessarily updated in drag operations.
  for ( const layer of Object.values(this.layers) ) {
    const shader = layer.shader;
    this._updateCommonUniforms(shader);
  }

  // Instead of super._updateEVShadowData()
  foundry.canvas.sources.RenderedEffectSource.prototype._updateEVShadowData.call(this, changes, changeObj);
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
    ?? Settings.get(Settings.KEYS.LIGHTING.LIGHT_SIZE)
    ?? 0;
}

/**
 * Wrap method: LightSource.prototype._getPolygonConfiguration.
 * Force an unblocked circle to be used for the sweep.
 * See issue #77.
 */
function _getPolygonConfiguration(wrapped) {
  const config = wrapped();
  if ( Settings.get(Settings.KEYS.LIGHTS_FULL_PENUMBRA) ) config.type = "universal";
  return config;
}

/**
 * Wrap method: LightSource.prototype.updateCommonUniforms
 */
function _updateCommonUniforms(wrapped, shader) {
  const u = shader.uniforms;
  if ( this instanceof foundry.canvas.sources.GlobalLightSource ) {
    u.uEVShadows = false;
    u.uEVDirectional = false;
    return wrapped(shader);
  }

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
  _getPolygonConfiguration,
  _updateCommonUniforms
};
