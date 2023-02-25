/* globals
canvas,
libWrapper
*/
"use strict";

import { MODULE_ID } from "../const.js";
import { log } from "../util.js";

/**
 * Patch Tile.prototype._createTextureData
 * See
 * https://github.com/foundryvtt/foundryvtt/issues/8827
 * https://github.com/foundryvtt/foundryvtt/issues/8831
 */
function _createTextureDataTile() {
  const aw = Math.abs(this.document.width);
  const ah = Math.abs(this.document.height);

  // If no tile texture is present or if non overhead tile.
  if ( !this.texture || this.document.overhead === false ) {
    return this._textureData = {minX: 0, minY: 0, maxX: aw, maxY: ah};
  }

  // If texture date exists for this texture, we return it
  this._textureData = canvas.tiles.textureDataMap.get(this.document.texture.src);
  if ( this._textureData ) return this._textureData;
  else this._textureData = {
    pixels: undefined,
    minX: undefined,
    maxX: undefined,
    minY: undefined,
    maxY: undefined
  };
  // Else, we are preparing the texture data creation
  const map = this._textureData;

  // Create a temporary Sprite using the Tile texture
  const sprite = new PIXI.Sprite(this.texture);
  sprite.width = map.aw = this.texture.baseTexture.realWidth / 4;
  sprite.height = map.ah = this.texture.baseTexture.realHeight / 4;
  sprite.anchor.set(0.5, 0.5);
  sprite.position.set(map.aw / 2, map.ah / 2);

  // Create or update the alphaMap render texture
  const tex = PIXI.RenderTexture.create({width: map.aw, height: map.ah});

  // Render the sprite to the texture and extract its pixels
  // Destroy sprite and texture when they are no longer needed
  canvas.app.renderer.render(sprite, tex);
  sprite.destroy(false);
  const pixels = map.pixels = canvas.app.renderer.extract.pixels(tex);
  tex.destroy(true);

  // Map the alpha pixels
  const w = Math.roundFast(map.aw);
  const ln = pixels.length;
  const alphaPixels = new Uint8Array(ln / 4);
  for ( let i = 0; i < ln; i += 4 ) {
    const n = i / 4;
    const a = alphaPixels[n] = pixels[i + 3];
    if ( a > 0 ) {
      const x = n % w;
      const y = Math.floor(n / w);
      if ( (map.minX === undefined) || (x < map.minX) ) map.minX = x;
      else if ( (map.maxX === undefined) || (x + 1 > map.maxX) ) map.maxX = x + 1;
      if ( (map.minY === undefined) || (y < map.minY) ) map.minY = y;
      else if ( (map.maxY === undefined) || (y + 1 > map.maxY) ) map.maxY = y + 1;
    }
  }
  map.pixels = alphaPixels;

  // Saving the texture data
  canvas.tiles.textureDataMap.set(this.document.texture.src, map);
  return this._textureData;
}



export function patchTile() {
  log("Patching Tile.prototype._createTextureData");
  libWrapper.register(MODULE_ID, "Tile.prototype._createTextureData", _createTextureDataTile, libWrapper.OVERRIDE, {perf_mode: libWrapper.PERF_FAST});
}
