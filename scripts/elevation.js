/* globals
MovementSource,
VisionSource,
LightSource,
SoundSource,
Wall,
Token,
GlobalLightSource,
CONFIG

*/
"use strict";

import { MODULES_ACTIVE } from "./const.js";

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
  if ( !Object.hasOwn(Token.prototype, "topE") ) {
    Object.defineProperty(Token.prototype, "topE", {
      get: tokenTopElevation
    });
  }

  if ( !Object.hasOwn(Token.prototype, "bottomE") ) {
    Object.defineProperty(Token.prototype, "bottomE", {
      get: tokenBottomElevation
    });
  }

  if ( !Object.hasOwn(Token.prototype, "topZ") ) {
    Object.defineProperty(Token.prototype, "topZ", {
      get: zTop
    });
  }

  if ( !Object.hasOwn(Token.prototype, "bottomZ") ) {
    Object.defineProperty(Token.prototype, "bottomZ", {
      get: zBottom
    });
  }

  // ----- WALLS ----- //
  if ( !Object.hasOwn(Wall.prototype, "topE") ) {
    Object.defineProperty(Wall.prototype, "topE", {
      get: wallTopElevation
    });
  }

  if ( !Object.hasOwn(Wall.prototype, "bottomE") ) {
    Object.defineProperty(Wall.prototype, "bottomE", {
      get: wallBottomElevation
    });
  }

  if ( !Object.hasOwn(Wall.prototype, "topZ") ) {
    Object.defineProperty(Wall.prototype, "topZ", {
      get: zTop
    });
  }

  if ( !Object.hasOwn(Wall.prototype, "bottomZ") ) {
    Object.defineProperty(Wall.prototype, "bottomZ", {
      get: zBottom
    });
  }

  // ----- MovementSource ----- //
  if ( !Object.hasOwn(MovementSource.prototype, "elevationE") ) {
    Object.defineProperty(MovementSource.prototype, "elevationE", {
      get: movementSourceElevation
    });
  }

  if ( !Object.hasOwn(MovementSource.prototype, "elevationZ") ) {
    Object.defineProperty(MovementSource.prototype, "elevationZ", {
      get: zElevation
    });
  }

  // ----- VisionSource ----- //
  if ( !Object.hasOwn(VisionSource.prototype, "elevationE") ) {
    Object.defineProperty(VisionSource.prototype, "elevationE", {
      get: visionSourceElevation
    });
  }

  if ( !Object.hasOwn(VisionSource.prototype, "elevationZ") ) {
    Object.defineProperty(VisionSource.prototype, "elevationZ", {
      get: zElevation
    });
  }

  // ----- LightSource ----- //
  if ( !Object.hasOwn(LightSource.prototype, "elevationE") ) {
    Object.defineProperty(LightSource.prototype, "elevationE", {
      get: lightSourceElevation
    });
  }

  if ( !Object.hasOwn(LightSource.prototype, "elevationZ") ) {
    Object.defineProperty(LightSource.prototype, "elevationZ", {
      get: zElevation
    });
  }

  // ----- SoundSource ----- //
  if ( !Object.hasOwn(SoundSource.prototype, "elevationE") ) {
    Object.defineProperty(SoundSource.prototype, "elevationE", {
      get: soundSourceElevation
    });
  }

  if ( !Object.hasOwn(SoundSource.prototype, "elevationZ") ) {
    Object.defineProperty(SoundSource.prototype, "elevationZ", {
      get: zElevation
    });
  }

  // ----- Tile ---- //
  if ( !Object.hasOwn(Tile.prototype, "elevationE") ) {
    Object.defineProperty(SoundSource.prototype, "elevationE", {
      get: soundSourceElevation
    });
  }

  if ( !Object.hasOwn(Tile.prototype, "elevationZ") ) {
    Object.defineProperty(SoundSource.prototype, "elevationZ", {
      get: zElevation
    });
  }
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
 * @returns {number} In grid units.
 * If Wall Height is active, use the losHeight. Otherwise, use bottomE.
 */
function tokenTopElevation() {
  if ( MODULES_ACTIVE.WALL_HEIGHT ) return this.losHeight ?? this.bottomE;
  return this.bottomE;
}

/**
 * Bottom elevation of a wall
 * @returns {number} Grid units
 *   If Wall Height is inactive, returns negative infinity.
 */
function wallBottomElevation() {
  const e = MODULES_ACTIVE.WALL_HEIGHT ? this.document.flags?.["wall-height"]?.bottom : undefined;
  return e ?? Number.NEGATIVE_INFINITY;
}

/**
 * Top elevation of a wall
 * @returns {number} Grid units
 * If Wall Height is inactive, returns positive infinity.
 */
function wallTopElevation() {
  const e = MODULES_ACTIVE.WALL_HEIGHT ? this.document.flags?.["wall-height"]?.top : undefined;
  return e ?? Number.POSITIVE_INFINITY;
}

/**
 * Elevation of a MovementSource.
 * Equal to the Token elevation
 * @returns {number} Grid units
 */
function movementSourceElevation() {
  return this.object.bottomE;
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
  return tile.document.flags?.elevatedvision?.elevation
      ?? tile.document.flags?.levels?.rangeBottom ?? Number.POSITIVE_INFINITY;
}
