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

const PATCHES = {};
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
  const elevChangeFlag = `flags.${MODULE_ID}.${FLAGS.ELEVATION}`;
  const dimRadiusChangeFlag = "config.dim";
  const brightRadiusChangeflag = "config.bright";

  const flatData = flattenObject(data);
  const changed = new Set(Object.keys(flatData));
  if ( changed.has(elevChangeFlag) ) {
    doc.object.renderFlags.set({
      refreshElevation: true
    });
  }

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
  if ( !light.source.isDirectional ) return;
  if ( hover ) canvas.lighting.addChild(DirectionalLightSource._elevationAngleGrid);
  else canvas.lighting.removeChild(DirectionalLightSource._elevationAngleGrid);
}

/**
 * Hook ambient light refresh to address the refreshElevation renderFlag.
 * Update the source elevation.
 * See AmbientLight.prototype._applyRenderFlags.
 * @param {PlaceableObject} object    The object instance being refreshed
 * @param {RenderFlags} flags
 */
export function refreshAmbientLightHook(light, flags) {
  if ( flags.refreshElevation ) {
    // See Token.prototype.#refreshElevation
    canvas.primary.sortDirty = true;

    // Elevation tooltip text
    const tt = light._getTooltipText();
    if ( tt !== light.tooltip.text ) light.tooltip.text = tt;
  }
}


PATCHES.BASIC.HOOKS = {
  updateAmbientLight: updateAmbientLightHook,
  hoverAmbientLight: hoverAmbientLightHook,
  refreshAmbientLight: refreshAmbientLightHook
};

// NOTE: Ambient Light Methods

/**
 * New method: AmbientLight.prototype.convertToDirectionalLight
 */
function convertToDirectionalLight() {
  if ( this.source.isDirectional ) return;

  this.updateSource({ deleted: true });
  this.document.setFlag(MODULE_ID, FLAGS.DIRECTIONAL_LIGHT.ENABLED, true);
  this.source = new DirectionalLightSource({object: this});
  this.updateSource();
}

/**
 * New method: AmbientLight.prototype.convertFromDirectionalLight
 */
function convertFromDirectionalLight() {
  if ( !this.source.isDirectional ) return;

  this.updateSource({ deleted: true });
  this.document.setFlag(MODULE_ID, FLAGS.DIRECTIONAL_LIGHT.ENABLED, false);
  this.source = new LightSource({object: this});
  this.updateSource();
}

PATCHES.BASIC.METHODS = {
  convertToDirectionalLight,
  convertFromDirectionalLight
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
  if ( this.source instanceof DirectionalLightSource ) clone.convertToDirectionalLight();
  return clone;
}

/**
 * Wrap AmbientLight.prototype._onUpdate
 * If changing to/from directional source, update the source accordingly.
 */
function _onUpdate(wrap, data, options, userId) {
  const changes = flattenObject(data);
  const keys = new Set(Object.keys(changes));

  const isDirectionalFlag = `flags.${MODULE_ID}.directionalLight`;
  if ( keys.has(isDirectionalFlag) ) changes[isDirectionalFlag] // eslint-disable-line no-unused-expressions
    ? this.convertToDirectionalLight() : this.convertFromDirectionalLight();

  // TODO: Do renderFlags need to be set here?

  return wrap(data, options, userId);
}

function _draw(wrapped) {
  wrapped();
  this.tooltip ||= this.addChild(this._drawTooltip());
  if ( this.source.isDirectional ) this.refreshControl();
}

function refreshControl(wrapped) {
  wrapped();
  if ( this.source.isDirectional ) {
    this.controlIcon.texture = getTexture(this.isVisible
      ? CONFIG.controlIcons.directionalLight : CONFIG.controlIcons.directionalLightOff);
    this.controlIcon.draw();
  }
}

PATCHES.BASIC.WRAPS = {
  clone,
  _onUpdate,
  _draw,
  refreshControl
};

/**
 * New method: AmbientLight.prototype._drawTooltip
 */
function _drawTooltip() {
  let text = this._getTooltipText();
  const style = this.constructor._getTextStyle();
  const tip = new PreciseText(text, style);
  tip.anchor.set(0.5, 1);

  // From #drawControlIcon
  const size = Math.max(Math.round((canvas.dimensions.size * 0.5) / 20) * 20, 40);
  tip.position.set(0, -size / 2);
  return tip;
}

/**
 * New method: AmbientLight.prototype._getTooltipText
 */
function _getTooltipText() {
  if ( this.source.isDirectional ) {
    const azimuth = Math.normalizeDegrees(Math.toDegrees(this.source.azimuth)).toFixed(1);
    const elevationAngle = Math.normalizeDegrees(Math.toDegrees(this.source.elevationAngle)).toFixed(1);
    const text = `${azimuth}º⥁\n${elevationAngle}º⦞`;
    return text;
  }

  const el = this.elevationE;
  if ( !Number.isFinite(el) || el === 0 ) return "";
  let units = canvas.scene.grid.units;
  return el > 0 ? `+${el} ${units}` : `${el} ${units}`;
}

PATCHES.BASIC.METHODS = {
  _drawTooltip,
  _getTooltipText
};

/**
 * New method: AmbientLight._getTextStyle
 * Get the text style that should be used for this Light's tooltip.
 * See Token.prototype._getTextStyle.
 * @returns {string}
 */
function _getTextStyle() {
  const style = CONFIG.canvasTextStyle.clone();
  style.fontSize = 24;
  if (canvas.dimensions.size >= 200) style.fontSize = 28;
  else if (canvas.dimensions.size < 50) style.fontSize = 20;

  // From #drawControlIcon
  const size = Math.max(Math.round((canvas.dimensions.size * 0.5) / 20) * 20, 40);
  style.wordWrapWidth = size * 2.5;
  return style;
}

PATCHES.BASIC.STATIC_METHODS = {
  _getTextStyle
};
