/* globals
MovementSource,
VisionSource,
LightSource,
SoundSource,
Wall,
Token,
GlobalLightSource,
Tile,
CONFIG
*/
"use strict";

import { MODULES_ACTIVE, MODULE_ID } from "./const.js";

/* Elevation properties for Placeable Objects
Generally:
- elevation and elevationZ properties
- topE/bottomE and topZ/bottomZ for walls, tokens

1. Walls.
- topE/bottomE and topZ/bottomZ: When Wall Height is active, non-infinite are possible.
Use Wall Height flag

2. Tokens.
- topE/bottomE. topE === bottomE unless Wall Height is active.
- bottomE === elevation

3. Lights and Sounds
- elevationE and elevationZ
- If the light is attached to a token, use token topZ, which would be losHeight
- Add elevation property to the config
- Don't patch the PlaceableObject elevation getter at the moment, as it might screw up
the display of the light object on the canvas. Eventually may want to patch this so
lights can display with varying canvas elevation.
*/

export function registerElevationAdditions() {
  // ----- TOKENS ----- //

  // topE and topZ vary depending on whether token is prone
  Object.defineProperty(Token.prototype, "topE", {
    get: tokenTopElevation,
    configurable: true
  });

  // Synonym for token.elevation
  Object.defineProperty(Token.prototype, "bottomE", {
    get: tokenBottomElevation,
    configurable: true
  });


  Object.defineProperty(Token.prototype, "topZ", {
    get: zTop,
    configurable: true
  });


  Object.defineProperty(Token.prototype, "bottomZ", {
    get: zBottom,
    configurable: true
  });

  // Token height is physical characteristic of token; does not vary.
  // Auto-calculated or set by user
  Object.defineProperty(Token.prototype, "heightE", {
    get: tokenHeight,
    configurable: true
  });

  Object.defineProperty(Token.prototype, "heightZ", {
    get: zHeight,
    configurable: true
  });


  // Also need to convert a center point back to the top left point of a token.
  // Used for automatic elevation determination.
  Object.defineProperty(Token.prototype, "getTopLeft", {
    value: function(x, y) {
      return {
        x: x - (this.w * 0.5),
        y: y - (this.h * 0.5)
      };
    },
    writable: true,
    configurable: true
  });


  // ----- WALLS ----- //
  Object.defineProperty(Wall.prototype, "topE", {
    get: wallTopElevation,
    configurable: true
  });


  Object.defineProperty(Wall.prototype, "bottomE", {
    get: wallBottomElevation,
    configurable: true
  });


  Object.defineProperty(Wall.prototype, "topZ", {
    get: zTop,
    configurable: true
  });


  Object.defineProperty(Wall.prototype, "bottomZ", {
    get: zBottom,
    configurable: true
  });

  // ----- MovementSource ----- //
  Object.defineProperty(MovementSource.prototype, "elevationE", {
    get: movementSourceElevation,
    configurable: true
  });


  Object.defineProperty(MovementSource.prototype, "elevationZ", {
    get: zElevation,
    configurable: true
  });

  // ----- VisionSource ----- //
  Object.defineProperty(VisionSource.prototype, "elevationE", {
    get: visionSourceElevation,
    configurable: true
  });


  Object.defineProperty(VisionSource.prototype, "elevationZ", {
    get: zElevation,
    configurable: true
  });

  // ----- LightSource ----- //
  Object.defineProperty(LightSource.prototype, "elevationE", {
    get: lightSourceElevation
  });


  Object.defineProperty(LightSource.prototype, "elevationZ", {
    get: zElevation,
    configurable: true
  });

  // ----- SoundSource ----- //
  Object.defineProperty(SoundSource.prototype, "elevationE", {
    get: soundSourceElevation,
    configurable: true
  });


  Object.defineProperty(SoundSource.prototype, "elevationZ", {
    get: zElevation,
    configurable: true
  });

  // ----- Tile ---- //
  Object.defineProperty(Tile.prototype, "elevationE", {
    get: tileElevation,
    configurable: true
  });


  Object.defineProperty(Tile.prototype, "elevationZ", {
    get: zElevation,
    configurable: true
  });
}

/**
 * Helper to convert to Z value for a top elevation.
 */
function zTop() {
  return CONFIG.GeometryLib.utils.gridUnitsToPixels(this.topE);
}

/**
 * Helper to convert to Z value for a bottom elevation.
 */
function zBottom() {
  return CONFIG.GeometryLib.utils.gridUnitsToPixels(this.bottomE);
}

/**
 * Helper to convert to Z value for height.
 */
function zHeight() {
  return CONFIG.GeometryLib.utils.gridUnitsToPixels(this.heightE);
}

/**
 * Helper to convert to Z value for an elevationE.
 */
function zElevation() {
  return CONFIG.GeometryLib.utils.gridUnitsToPixels(this.elevationE);
}

/**
 * Bottom elevation of a token. Equivalent to token.document.elevation.
 * @returns {number} Grid units.
 */
function tokenBottomElevation() {
  return this.document.elevation ?? 0;
}

/**
 * Top elevation of a token.
 * If prone, divide by half.
 * @returns {number} In grid units.
 */
function tokenTopElevation() {
  const proneStatusId = CONFIG[MODULE_ID].proneStatus
  const isProne = (proneStatusId && this.actor)
    ? this.actor.effects.some(e => e.getFlag("core", "statusId") === proneStatusId) : false;

  const height = this.heightE;
  return this.bottomE; + (isProne ? (height * 0.5) : height);
}

/**
 * Height of a token.
 * If not defined by user or set to 0, auto-calculated using token width and height.
 * See https://github.com/theripper93/wall-height/blob/a3243706f899eacb339f2426d791f0f432b13b9f/scripts/utils.js#L3
 * @returns {number} In grid units.
 */
function tokenHeight() {
  const { flags, width, height, texture } = this.document;
  return flags?.elevatedvision?.height || autoTokenHeight(this);
}

export function autoTokenHeight(token) {
  const { width, height, texture } = token.document;
  return canvas.scene.dimensions.distance
    * Math.max(width, height)
    * ((Math.abs(texture.scaleX) + Math.abs(texture.scaleY)) / 2);
}

/**
 * Bottom elevation of a wall
 * @returns {number} Grid units
 *   If Wall Height is inactive, returns negative infinity.
 */
function wallBottomElevation() {
  return this.document.flags?.elevatedvision?.elevation?.bottom ?? Number.NEGATIVE_INFINITY;
}

/**
 * Top elevation of a wall
 * @returns {number} Grid units
 * If Wall Height is inactive, returns positive infinity.
 */
function wallTopElevation() {
  return this.document.flags?.elevatedvision?.elevation?.top ?? Number.POSITIVE_INFINITY;
}

/**
 * Elevation of a MovementSource.
 * Equal to the Token elevation
 * @returns {number} Grid units
 */
function movementSourceElevation() {
  return this.object.elevation;
}

/**
 * Elevation of a VisionSource.
 * Equal to the token losHeight, if available.
 * @returns {number} Grid units
 */
function visionSourceElevation() {
  return this.object.topE;
}

/**
 * Elevation of the light source.
 * If attached to a token, use the token losHeight.
 * @returns {number}  Grid Units
 *   Default: Positive infinity. When infinite, treat like default Foundry light.
 */
function lightSourceElevation() {
  if ( this instanceof GlobalLightSource ) return Number.POSITIVE_INFINITY;
  if ( this.object instanceof Token ) return this.object.topE;
  return this.object.document.flags?.elevatedvision?.elevation ?? Number.POSITIVE_INFINITY;
}

/**
 * Elevation of the sound source.
 * If attached to a token, use the token losHeight.
 * @returns {number}  Grid Units
 *   Default: Positive infinity. When infinite, treat like default Foundry light.
 */
function soundSourceElevation() {
  if ( this.object instanceof Token ) return this.object.topE;
  return this.object.document.flags?.elevatedvision?.elevation ?? Number.POSITIVE_INFINITY;
}

/**
 * Elevation of the sound source.
 * If attached to a token, use the token losHeight.
 * @returns {number}  Grid Units
 *   Default: Positive infinity. When infinite, treat like default Foundry light.
 */
function tileElevation() {
  return this.document.flags?.elevatedvision?.elevation
      ?? this.document.flags?.levels?.rangeBottom ?? Number.POSITIVE_INFINITY;
}
