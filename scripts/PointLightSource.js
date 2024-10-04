/* globals

*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, FLAGS } from "./const.js";
import { Settings } from "./settings.js";

// Methods related to LightSource

export const PATCHES = {};
PATCHES.WEBGL = {};


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
  this[MODULE_ID]._updateCommonUniforms(shader);
  wrapped(shader);
}

PATCHES.WEBGL.WRAPS = {
  _initialize,
  _getPolygonConfiguration,
  _updateCommonUniforms
};
