/* globals
canvas,
CONFIG,
flattenObject,
getTexture,
LightSource,
PreciseText
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
import { MODULE_ID, FLAGS } from "./const.js";
import { DirectionalLightSource } from "./DirectionalLightSource.js";

// AmbientLight patches, methods, hooks

export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * Hook when the elevation flag is changed in the AmbientLightDocument.
 * Used below to update the underlying source elevation.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateAmbientLightHook(doc, data, _options, _userId) {
  const dimRadiusChangeFlag = "config.dim";
  const brightRadiusChangeflag = "config.bright";

  const flatData = foundry.utils.flattenObject(data);
  const changed = new Set(Object.keys(flatData));
  if ( changed.has(dimRadiusChangeFlag) || changed.has(brightRadiusChangeflag) ) {
    doc.object.renderFlags.set({
      refreshRadius: true
    });
  }
}

// ----- NOTE: Ambient Light Modifications ----- //


/**
 * Hook AmbientLight hover in and hover out
 * Display the elevation angle grid when hovering over a directional light.
 * @param {AmbientLight} light  The light object for which the hover applies.
 * @param {boolean} hover       True if hover started.
 */
function hoverAmbientLightHook(light, hover) {
  if ( !light.lightSource || !light.lightSource.isDirectional ) return;
  if ( hover ) canvas.lighting.addChild(DirectionalLightSource._elevationAngleGrid);
  else canvas.lighting.removeChild(DirectionalLightSource._elevationAngleGrid);
}

PATCHES.BASIC.HOOKS = {
  updateAmbientLight: updateAmbientLightHook,
  hoverAmbientLight: hoverAmbientLightHook
};

// Note: Ambient Light Wraps

/**
 * Wrap AmbientLight.prototype.clone
 * Change the light source if cloning a directional light.
 * Needed to switch out the light source to directional for the clone, when dragging.
 * @returns {PlaceableObject}  A new object with identical data
 */
function clone(wrapped) {
  const clone = wrapped();
  if ( this.lightSource instanceof DirectionalLightSource ) clone.convertToDirectionalLight();
  return clone;
}

/**
 * Wrap AmbientLight.prototype._onUpdate
 * If changing to/from directional source, update the source accordingly.
 */
function _onUpdate(wrap, data, options, userId) {
  const changes = foundry.utils.flattenObject(data);
  const keys = new Set(Object.keys(changes));

  const isDirectionalFlag = `flags.${MODULE_ID}.directionalLight`;
  if ( keys.has(isDirectionalFlag) ) changes[isDirectionalFlag] // eslint-disable-line no-unused-expressions
    ? this.convertToDirectionalLight() : this.convertFromDirectionalLight();

  // TODO: Do renderFlags need to be set here?

  return wrap(data, options, userId);
}

function _draw(wrapped) {
  wrapped();
  if ( this.lightSource && this.lightSource.isDirectional ) this.refreshControl();
}

PATCHES.BASIC.WRAPS = {
  clone,
  _onUpdate,
  _draw
};

// NOTE: Mixed Wraps

/**
 * Mixed wrap AmbientLight#refreshControl
 * If directional light, take control of the icon drawing.
 */
function refreshControl(wrapped) {
  if ( !(this.lightSource && this.lightSource.isDirectional) ) return wrapped();

  // From refreshControl
  const isHidden = this.id && this.document.hidden;
  this.controlIcon.texture = getTexture(this.isVisible
    ? CONFIG.controlIcons.directionalLight : CONFIG.controlIcons.directionalLightOff);
  this.controlIcon.tintColor = isHidden ? 0xFF3300 : 0xFFFFFF;
  this.controlIcon.borderColor = isHidden ? 0xFF3300 : 0xFF5500;

  // Instead of elevation display azimuth and angle.
  const azimuth = Math.normalizeDegrees(Math.toDegrees(this.lightSource.azimuth)).toFixed(1);
  const elevationAngle = Math.normalizeDegrees(Math.toDegrees(this.lightSource.elevationAngle)).toFixed(1);
  const text = `${azimuth}º⥁\n${elevationAngle}º⦞`;
  this.controlIcon.tooltip.text = text;
  this.controlIcon.tooltip.visible = true;

  // From refreshControl
  this.controlIcon.refresh({visible: this.layer.active, borderVisible: this.hover || this.layer.highlightObjects});
  this.controlIcon.draw();
}

PATCHES.BASIC.MIXES = { refreshControl };


// NOTE: Ambient Light Methods

/**
 * New method: AmbientLight.prototype.convertToDirectionalLight
 */
function convertToDirectionalLight() {
  if ( this.lightSource && this.lightSource.isDirectional ) return;

  this.updateSource({ deleted: true });
  this.document.setFlag(MODULE_ID, FLAGS.DIRECTIONAL_LIGHT.ENABLED, true);
  this.lightSource = new DirectionalLightSource({object: this});
  this.updateSource();
}

/**
 * New method: AmbientLight.prototype.convertFromDirectionalLight
 */
function convertFromDirectionalLight() {
  if ( !this.lightSource || !this.lightSource.isDirectional ) return;

  this.updateSource({ deleted: true });
  this.document.setFlag(MODULE_ID, FLAGS.DIRECTIONAL_LIGHT.ENABLED, false);
  this.lightSource = new foundry.canvas.sources.PointLightSource({object: this});
  this.updateSource();
}

PATCHES.BASIC.METHODS = {
  convertToDirectionalLight,
  convertFromDirectionalLight
};
