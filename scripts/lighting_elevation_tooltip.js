/* globals
canvas,
CONFIG,
getTexture,
PreciseText
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DirectionalLightSource } from "./directional_lights.js";

// Draw elevation for lights similar to that of tokens.

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

export function _drawAmbientLight(wrapped) {
  wrapped();
  this.tooltip ||= this.addChild(this._drawTooltip());
  if ( this.source.isDirectional ) this.refreshControl();
}

export function refreshControlAmbientLight(wrapped) {
  wrapped();
  if ( this.source.isDirectional ) {
    this.controlIcon.texture = getTexture(this.isVisible ?  CONFIG.controlIcons.directionalLight : CONFIG.controlIcons.directionalLightOff);
    this.controlIcon.draw();
  }
}

export function _drawTooltipAmbientLight() {
  let text = this._getTooltipText();
  const style = this.constructor._getTextStyle();
  const tip = new PreciseText(text, style);
  tip.anchor.set(0.5, 1);

  // From #drawControlIcon
  const size = Math.max(Math.round((canvas.dimensions.size * 0.5) / 20) * 20, 40);
  tip.position.set(0, -size / 2);
  return tip;
}


export function _getTooltipTextAmbientLight() {
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

/**
 * New method: AmbientLight._getTextStyle
 * Get the text style that should be used for this Light's tooltip.
 * See Token.prototype._getTextStyle.
 * @returns {string}
 */
export function _getTextStyleAmbientLight() {
  const style = CONFIG.canvasTextStyle.clone();
  style.fontSize = 24;
  if (canvas.dimensions.size >= 200) style.fontSize = 28;
  else if (canvas.dimensions.size < 50) style.fontSize = 20;

  // From #drawControlIcon
  const size = Math.max(Math.round((canvas.dimensions.size * 0.5) / 20) * 20, 40);
  style.wordWrapWidth = size * 2.5;
  return style;
}
