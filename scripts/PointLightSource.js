/* globals
LimitedAnglePolygon,
PIXI
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
  const cfg = wrapped();
  if ( Settings.get(Settings.KEYS.LIGHTS_FULL_PENUMBRA) ) cfg.type = "universal";

  // When the point source width is larger than 0 and there is an angle,
  // add a boundary shape that allows for a flat space at the origin.
  // So a trapezoid narrowly focused at the end.
  if ( cfg.angle === 0 || cfg.angle === 360 || cfg.angle === 180 || this.isDirectional ) return cfg;

  const lightSize = this.object.document.getFlag(MODULE_ID, FLAGS.LIGHT_SIZE);
  if ( !lightSize ) return cfg;

  // Instead of a limited angle, use a trapezoid shape.
  const la = new LimitedAnglePolygon(this.data, { angle: cfg.angle, rotation: cfg.rotation, radius: cfg.radius });

  const rotRad = Math.toRadians(cfg.rotation);
  const a = PIXI.Point.fromAngle(this.data, rotRad, lightSize);
  const b = PIXI.Point.fromAngle(this.data, rotRad, -lightSize);
  const c = a.fromAngle(la.aMin, cfg.radius);
  const d = b.fromAngle(la.aMax, cfg.radius);

  // Construct polygon points for the primary angle
  // Extend out the limited angle polygon to reach the radius at c and d.
  const extRadius = PIXI.Point.distanceBetween(this.data, c);
  const { x, y } = la.origin;
  const primaryAngle = la.aMax - la.aMin;
  const nPrimary = Math.ceil((primaryAngle * la.density) / (2 * Math.PI));
  const dPrimary = primaryAngle / nPrimary;
  const points = [];
  const o = PIXI.Point.fromObject(la.origin);
  for ( let i = 0; i <= nPrimary; i++ ) {
    const pad = o.fromAngle(la.aMin + (i * dPrimary), extRadius, PIXI.Point._tmp);
    points.push(pad.x, pad.y);
  }

  const trapezoid = new PIXI.Polygon(a.x, a.y, c.x, c.y, ...points, d.x, d.y, b.x, b.y);
  cfg.angle = 360;
  cfg.radius = extRadius;
  cfg.boundaryShapes ??= [];
  cfg.boundaryShapes.push(trapezoid);
  return cfg;
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
