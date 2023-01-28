/* globals
PIXI,
canvas,

*/
"use strict";

import { extractPixels, unpremultiplyPixels } from "./perfect-vision/extract-pixels.js";
import { Draw } from "./geometry/Draw.js";

/**
 * A "matrix" constructed as an array used to store integer pixel values between 0 and 255.
 * Values are stored from bottom-left, moving right, then up. (same as extractPixels)
 */
export class PixelValueMatrix extends PIXI.Rectangle {
  /** @type {Uint8ClampedArray} */
  values = new Uint8ClampedArray(0);

  /** @type {numeric} */
  resolution = 1;

  constructor(x, y, width, height) {
    super(x, y, width, height);
    this.values = new Uint8ClampedArray(width * height);
  }

  /**
   * Make a copy of this shape
   * @returns {PixelValueShape}
   */
  clone() {
    const clone = new this.constructor(this.x, this.y, this.width, this.height);
    clone.values.set(this.values, 0);
    return clone;
  }

  /** @type {numeric} */
  get length() { return this.values.length; }

  /**
   * Calculate area, including only pixels above a specified threshold
   * @param {number} threshold    Pixel must be above percentage threshold to count.
   *   Default value of 0.75 matches `Tile.prototype.containsPixel`.
   * @returns {number}
   */
  areaAboveThreshold(threshold = 0.75) {
    threshold = threshold * 255;
    return this.values.reduce((acc, curr) => acc + (curr > threshold));
  }

  /**
   * Value at a specific x, y position.
   * @param {number} x    Local x coordinate
   * @param {number} y    Local y coordinate
   * @returns {number}
   */
  _valueAtLocal({x, y}) { return this.values[this._indexAtLocal({x, y})]; }

  /**
   * Value at a specific x, y position.
   * @param {number} x    Canvas x coordinate
   * @param {number} y    Canvas y coordinate
   * @returns {number}
   */
  valueAtCanvas({x, y}) { return this.values[this.indexAtCanvas({x, y})]; }

  /**
   * Average value based on a cross shape
   * @param {number} x    Local x coordinate
   * @param {number} y    Local y cooordinate
   * @returns {number}
   */
  _aliasedValueAtLocal({x, y}) {
    const minX = Math.max(x - 1, 0);
    const maxX = Math.min(x + 1, this.width);
    const minY = Math.max(y - 1, 0);
    const maxY = Math.min(y + 1, this.height);

    // Example: x: 1.6, y: 1.4
    // .4, .6 top left
    // .6 top
    // .6, .4 top right
    // .4 * .6 = .24 area

    /*
y:
49   101  103   104
50   101  103   103
51   100  100   101

x:   149  150   151
    */

    // Use toPrecision to avoid near decimals, like .599999999.
    const xRem = Number((x - Math.floor(x)).toPrecision(5));
    const xRemInv = 1 - xRem;
    const yRem = Number((y - Math.floor(y)).toPrecision(5));
    const yRemInv = 1 - yRem;

    // Top, left, bottom, right, topleft, bottomleft, topright, bottomright, center

    const xRemArr = [xRemInv, 1, xRem];
    const yRemArr = [yRemInv, 1, yRem];
    const xCoordsArr = [minX, x, maxX];
    const yCoordsArr = [minY, y, maxY];
    let sum = 0;
    const totalArea = 4;
    // Debugging:
    // let coords = [];
    // let areas = [];
    // let values = [];
    for ( let i = 0; i < 3; i += 1 ) {
      const xRem = xRemArr[i];
      const xCoord = xCoordsArr[i];

      for ( let j = 0; j < 3; j += 1 ) {
        const yRem = yRemArr[j];
        const yCoord = yCoordsArr[j];
        const area = xRem * yRem;
        const value = this._valueAtLocal({x: xCoord, y: yCoord});
        sum += (area * value);
        // Debugging:
        // totalArea += area;
        // coords.push({x: xCoord, y: yCoord});
        // areas.push(area);
        // values.push(value);
      }
    }

    return sum / totalArea;
  }

  /**
   * Average value based on a cross shape
   * @param {number} x    Canvas x coordinate
   * @param {number} y    Canvas y cooordinate
   * @returns {number}
   */
  aliasedValueAtCanvas({x, y}) {
    const local = this.fromCanvasCoordinates({x, y});
    return this._aliasedValueAtLocal(local);
  }

  /**
   * Index for specific coordinates.
   * Opposite of coordinatesAt.
   * @param {number} x    Local x coordinate
   * @param {number} y    Local y coordinate
   * @returns {number}
   */
  _indexAtLocal({x, y}) {
    x = Math.roundFast(x);
    y = Math.roundFast(y);
    return (y * this.width) + x;
  }

  /**
   * Index for specific canvas coordinates.
   * @param {number} x    Canvas x coordinate
   * @param {number} y    Canvas y coordinate
   * @returns {number}
   */
  indexAtCanvas({x, y}) {
    const local = this.fromCanvasCoordinates({x, y});
    return this._indexAtLocal(local);
  }

  /**
   * Coordinates of a specific index.
   * Opposite of indexAt.
   * @param {number} i
   * @returns {PIXI.Point} Local coordinates
   */
  _localCoordinatesAt(i) {
    const width = this.width;
    const col = i % width;
    const row = Math.floor(i / width);
    return new PIXI.Point(col, row);
  }

  /**
   * Coordinates of a specific index.
   * Opposite of indexAt.
   * @param {number} i
   * @returns {PIXI.Point} Canvas coordinates
   */
  canvasCoordinatesAt(i) {
    const local = this._localCoordinatesAt(i);
    return this.toCanvasCoordinates(local);
  }

  /**
   * Transform canvas coordinates to local pixel coordinates.
   * @param {number} x    X canvas coordinate
   * @param {number} y    Y canvas coordinate
   * @returns {PIXI.Point}
   */
  fromCanvasCoordinates({x, y}) {
    const pt = new PIXI.Point(x, y);
    pt.translate(-this.x, -this.y, pt);
    return pt;
  }

  /**
   * Transform pixel coordinates to canvas coordinates.
   * @param {number} x    X coordinate
   * @param {number} y    Y coordinate
   * @returns {PIXI.Point}
   */
  toCanvasCoordinates({x, y}) {
    const pt = new PIXI.Point(x, y);
    pt.translate(this.x, this.y, pt);
    return pt;
  }

  /**
   * Extract values for a given rectangle.
   * @param {PIXI.Rectangle} frame
   * @param {object} [options]
   * @param {boolean} [options.shrink]  Shrink the matrix to the border of the polygon shape?
   *   If shrink is true, the result will be a PixelShapeMatrix with holes set outside the border.
   * @returns {PixelValueMatrix|PixelShapeMatrix} New matrix
   */
  intersectRectangle(frame, { shrink = false } = {}) {
    if ( !shrink ) {
      const mat = PixelValueShape.fromPixelValueMatrix(this);
      return mat.intersectRectangle(frame, { shrink });
    }

    // Construct a copy of this matrix, only for the portions within the rectangle.
    const { top, bottom, left, right, width, height } = frame;
    const mat = new this.constructor(left, top, width, height);
    const ln = this.length;
    for ( let i = 0, j = 0; i < ln; i += 1 ) {
      const { x, y } = this.canvasCoordinatesAt(i);
      if ( x < left || x > right ) continue;
      if ( y < top || y > bottom ) continue;
      mat.values[j] = this.values[i];
      j += 1;
    }
    return mat;
  }

  /**
   * Extract values for a given polygon shape.
   * This matrix must be converted to one with holes in order to accommodate.
   * @param {PIXI.Polygon} poly
   * @param {object} [options]
   * @param {boolean} [options.shrink]  Shrink the matrix to the border of the polygon shape?
   * @returns {PixelValueShape} New shape.
   */
  intersectPolygon(poly, { shrink = true } = {}) {
    const mat = PixelValueShape.fromPixelValueMatrix(this);
    return mat.intersectPolygon(poly, { shrink });
  }

  /**
   * Extract values from a given shape.
   * @param {PIXI.Rectangle|PIXI.Polygon}
   * @param {object} [options]
   * @param {boolean} [options.shrink]  Shrink the matrix to the border of the shape.
   * @returns {PixelValueMatrix|PixelShapeMatrix} New matrix
   */
  intersectShape(shape, { shrink = false } = {}) {
    if ( shape instanceof PIXI.Rectangle ) return this.intersectRectangle(shape, { shrink });
    return this.intersectPolygon(shape, { shrink });
  }

  /**
   * Build a matrix from the elevation texture's alpha channel.
   * @param {PIXI.Rectangle} [frame]      Optional rectangle subset of the elevation texture.
   * @returns {PixelValueMatrix}
   */
  static fromElevationTexture(frame) {
    const tex = canvas.elevation._elevationTexture;
    const { width, height } = tex;

    frame ??= new PIXI.Rectangle(0, 0, width, height);
    return this.fromTexture(tex, frame);
  }

  /**
   * Build a matrix from the tile's alpha channel
   * @param {Tile} tile                 Tile to use for the texture
   * @param {PIXI.Rectangle} [frame]    Optional frame, relative to the tile.texture
   * @returns {PixelValueMatrix}
   */
  static fromTileAlpha(tile, frame) {
    const texture = tile.texture;
    frame ??= tile.texture.frame;
    return this.fromTextureAlpha(texture, frame);
  }

  /**
   * Build a matrix from a tile's cached _textureData property.
   * Only overhead tiles have this property, so if not found, return fromTileAlpha(tile).
   * @param {Tile} tile
   * @returns {PixelValueMatrix}
   */
  static fromOverheadTileAlpha(tile) {
    if ( !tile.document.overhead ) return this.fromTileAlpha(tile);

    // The aw and ah properties must be rounded to determine the dimensions.
    const width = Math.roundFast(Math.abs(tile._textureData.aw));
    const height = Math.roundFast(Math.abs(tile._textureData.ah));
    const mat = new this(0, 0, width, height);
    mat.resolution = 0.25; // Consistent with `_createTextureData` which divides by 4.

    // Keep only the alpha channel.
    mat.values.set(tile._textureData.pixels.filter((_px, i) => (i % 4) === 3), 0);
    return mat;
  }

  /**
   * Build a matrix from the texture's alpha channel.
   * @param {PIXI.RenderTexture} texture    Texture to extract data from.
   * @param {PIXI.Rectangle} frame          Frame to use for the extraction
   * @returns {PixelValueMatrix}
   */
  static fromTextureAlpha(texture, frame) {
    // Extraction should be from bottom-left corner, moving right, then up
    // https://stackoverflow.com/questions/47374367/in-what-order-does-webgl-readpixels-collapse-the-image-into-array
    const { pixels, x, y, width, height } = extractPixels(canvas.app.renderer, texture, frame);
    unpremultiplyPixels(pixels); // Consistent with `_createTextureData`: canvas.app.renderer.extract.pixels unpremultiplies.
    const mat = new this(x, y, width, height);
    const resolution = texture.baseTexture.resolution;
    mat.resolution = resolution;
    const ln = pixels.length;
    const values = mat.values;
    for ( let i = 0, j = 0; i < ln; i += 4, j += 1 ) values[j] = pixels[i];
    return mat;
  }

  /**
   * Draw a representation of this matrix on the canvas.
   * For debugging.
   * @param {Hex} [color]   Color to use for the fill
   */
  draw(color = Draw.COLORS.blue) {
    const ln = this.length;
    for ( let i = 0; i < ln; i += 1 ) {
      const pt = this.canvasCoordinatesAt(i);
      const alpha = this.values[i];
      Draw.point(pt, { color, alpha });
    }
  }

  /**
   * Draw a representation of this matrix, using aliased values
   * For debugging.
   * @param {Hex} [color]   Color to use for the fill
   */
  drawAliased(color = Draw.COLORS.blue) {
    const { width, height } = this;
    for ( let x = 0; x < width; x += 1 ) {
      for ( let y = 0; y < height; y += 1 ) {
        const pt = this.toCanvasCoordinates({x, y});
        const local = this.fromCanvasCoordinates(pt);
        const alpha = this._aliasedValueAtLocal(local);
        Draw.point(pt, { color, alpha });
      }
    }
  }
}

/* Testing
api = game.modules.get("elevatedvision").api
WallTracerEdge = api.WallTracerEdge
WallTracerVertex = api.WallTracerVertex
WallTracer = api.WallTracer
ClipperPaths = CONFIG.GeometryLib.ClipperPaths
Draw = CONFIG.GeometryLib.Draw
draw = new Draw
extractPixels = api.extract.extractPixels

tile = canvas.tiles.controlled[0]
tileMat = PixelValueMatrix.fromTileAlpha(tile);
Draw.clearDrawings();
tileMat.draw();

Draw.clearDrawings();
tileMat.drawAliased();

Draw.clearDrawings();
color = Draw.COLORS.blue
for ( let i = 0; i < tileMat.length; i += 1 ) {
  const local = tileMat._localCoordinatesAt(i);
  const pt = tileMat.toCanvasCoordinates(local);
  const alpha = tileMat._valueAt(local);
  Draw.point(pt, { color, alpha })
}

Draw.clearDrawings();
let { width, height } = tileMat;
for ( let x = 0.25; x < width; x += 1 ) {
  for ( let y = 0.35; y < height; y += 1 ) {
    const pt = tileMat.toCanvasCoordinates({x, y});
    const local = tileMat.fromCanvasCoordinates(pt)
    const alpha = tileMat._aliasedValueAt({x, y});
    Draw.point(pt, { color, alpha });
  }
}


*/

/**
 * Pixel values, but separately tracks holes in the shape using a separate boolean array.
 */
export class PixelValueShape extends PixelValueMatrix {
  /** @type {Uint8Array} */
  holes = new Uint8Array(0);

  constructor(x, y, width, height) {
    super(x, y, width, height);
    this.holes = new Uint8Array(width * height);
  }

  /** @type {number} */
  get area() { return super.area - this.areaHoles; }

  /** @type {number} */
  get areaHoles() { return this.holes.reduce((acc, curr) => acc + curr); }

  /** @inheritdoc */
  areaAboveThreshold(threshold) {
    return super.areaAboveThreshold(threshold) - this.areaHoles;
  }

  /** @inheritdoc */
  clone() {
    const clone = super.clone();
    clone.holes.set(this.holes, 0);
    return clone;
  }

  /**
   * Transform a PixelValueMatrix to a PixelValueShape
   * @param {PixelValueMatrix} mat
   * @returns {PixelValueShape}
   */
  static fromPixelValueMatrix(mat) {
    const newMat = new this.constructor(mat.x, mat.y, mat.width, mat.height);
    newMat.values.set(mat.values, 0);
    return newMat;
  }

  /**
   * Is there a hole at a specific x, y position?
   * @param {number} x    X canvas coordinate
   * @param {number} y    Y canvas coordinate
   * @returns {boolean}
   */
  _holeAtLocal({x, y}) { return this.holes[this._indexAtLocal({x, y})]; }

  /**
   * Is there a value or a hole at a specific x, y position?
   * Faster than separately calling this.valueAt() and this.holeAt()
   * @param {number} x    Local x coordinate
   * @param {number} y    Local y coordinate
   * @returns {number|null}
   */
  _valueOrHoleAtLocal({x, y}) {
    const i = this._indexAtLocal({x, y});
    return this.holes[i] ? null : this.values[i];
  }

  /** @inheritdoc */
  intersectRectangle(frame, { shrink = false } = {}) {
    const { top, bottom, left, right, width, height } = frame;
    let mat;
    if ( shrink ) {
      mat = new this.constructor(left, top, width, height);
    } else {
      mat = this.clone();
      mat.holes.fill(1); // Will reset holes inside the rectangle below.
    }

    // Update the portions of the new matrix inside the rectangle with the values from this matrix.
    const ln = this.length;
    for ( let i = 0, j = 0; i < ln; i += 1 ) {
      const { x, y } = this.canvasCoordinatesAt(i);
      if ( x < left || x > right ) continue;
      if ( y < top || y > bottom ) continue;
      mat.values[j] = this.values[i];
      mat.holes[j] = this.holes[i];
      j += 1;
    }
    return mat;
  }

  /** @inheritdoc */
  intersectPolygon(poly, { shrink = true } = {}) {
    let clone;
    if ( shrink ) {
      const bounds = this.poly.getBounds();
      clone = this.intersectRectangle(bounds);
    } else clone = this.clone();

    const ln = this.length;
    for ( let i = 0; i < ln; i += 1 ) {
      if ( this.holes[i] ) continue; // Already a hole.
      const pt = this.canvasCoordinatesAt(i);
      if ( !poly.contains(pt.x, pt.y) ) clone.holes[i] = 1;
    }
    return clone;
  }
}

function _setTileScaleData(mat, tile) {
  const tileDoc = tile.document;
  mat.scale.x = tileDoc.x;
  mat.scale.y = tileDoc.y;
  mat.scaleX = tileDoc.texture.scaleX;
  mat.scaleY = tileDoc.texture.scaleY;
  mat.rotationDegrees = tileDoc.rotation;
}

function fromCanvasCoordinates({x, y}) {
  // See Tile.prototype.#getTextureCoordinate
  const { width, height, left, top, rotation } = this;
  const { sscX, sscY, ascX, ascY } = this.scale;
  const width1_2 = width * 0.5;
  const height1_2 = height * 0.5;
  const pt = new PIXI.Point(x, y);

  // Account for tile rotation
  if ( rotation ) {
    // Center the coordinate so the tile center is 0,0 so the coordinate can be easily rotated.
    const center = { x: this.center.x + this.scale.x, y: this.center.y + this.scale.y };
    pt.subtract(center, pt);
    pt.rotate(-rotation, pt);
    pt.translate(this.center.x, this.center.y, pt);
  } else {
    pt.translate(-this.scale.x, -this.scale.y, pt);
  }

  // Account for scale
  // Mirror if scale is negative
  const xMult = sscX * (ascX - 1);
  const yMult = sscY * (ascY - 1);
  if ( sscX < 0 ) {
    pt.x = (-pt.x + width - (xMult*left) - (xMult*width1_2)) / (1 - xMult);
  } else {
    pt.x = (pt.x + (xMult*left) + (xMult*width1_2)) / (1 + xMult);
  }

  if ( sscY < 0 ) {
    pt.y = (-pt.y + height - (yMult*top) - (yMult*height1_2)) / (1 - yMult);
  } else {
    pt.y = (pt.y + (yMult*top) + (yMult*height1_2)) / (1 + yMult);
  }
  return pt;
}

function toCanvasCoordinates({x, y}) {
  const pt = new PIXI.Point(x, y);

  const { width, height, left, top, rotation } = this;
  const { sscX, sscY, ascX, ascY } = this.scale;

  const xStart = (pt.x - left - (width / 2));
  const yStart = (pt.y - top - (height / 2));

  // Mirror if scale is negative.
  if ( sscX < 0 ) pt.x = width - pt.x;
  if ( sscY < 0 ) pt.y = height - pt.y;

  // Account for scale.
  const xMult = sscX * (ascX - 1);
  const yMult = sscY * (ascY - 1);
  pt.translate(xMult * xStart, yMult * yStart, pt);

  // Shift to the tile location on the canvas.
  pt.translate(this.scale.x, this.scale.y, pt);

  // Account for tile rotation
  if ( rotation ) {
    // Center the coordinate so that the tile center is 0,0 so the coordinate can be easily rotated.
    const center = { x: this.center.x + this.scale.x, y: this.center.y + this.scale.y };
    pt.subtract(center, pt);
    pt.rotate(rotation, pt);
    pt.add(center, pt);
  }

  return pt;
}


/**
 * The PixelValueMatrix is tied to canvas position.
 * The underlying matrix is translated by x, y; possibly rotated, possibly scaled.
 */
export class CanvasPixelValueMatrix extends PixelValueMatrix {
  /**
   * @type {object}
   * @property {numeric} x                Translation in x direction
   * @property {numeric} y                Translation in y direction
   * @property {numeric} sscX             Sign of stretch in x directino
   * @property {numeric} sscY             Sign of stretch in y direction
   * @property {numeric} ascX             Absolute value of stretch in x directino
   * @property {numeric} ascY             Absolute value of stretch in y direction
   * @property {numeric} rotation         Rotation in degrees
   */
  scale = {
    x: 0,
    y: 0,
    sscX: 1,
    sscY: 1,
    ascX: 1,
    ascY: 1,
    rotation: 0 // Radians
  };

  /** @type {numeric} */
  get scaleX() { return this.scale.sscX * this.scale.ascX; }

  /** @type {numeric} */
  set scaleX(value) {
    this.scale.sscX = Math.sign(value);
    this.scale.ascX = Math.abs(value);
  }

  /** @type {numeric} */
  get scaleY() { return this.scale.sscY * this.scale.ascY; }

  /** @type {numeric} */
  set scaleY(value) {
    this.scale.sscY = Math.sign(value);
    this.scale.ascY = Math.abs(value);
  }

  /** @type {numeric} */
  get rotation() { return this.scale.rotation; }

  /** @type {numeric} */
  set rotation(value) { this.scale.rotation = Math.normalizeRadians(value); }

  /** @type {numeric} */
  get rotationDegrees() { return Math.toDegrees(this.scale.rotation); }

  /** @type {numeric} */
  set rotationDegrees(value) { this.scale.rotation = Math.toRadians(value); }

  /**
   * Build a matrix from the tile's alpha channel
   * @param {Tile} tile                 Tile to use for the texture
   * @param {PIXI.Rectangle} [frame]    Optional frame, relative to the tile.texture
   * @returns {PixelValueMatrix}
   */
  static fromTileAlpha(tile, frame) {
    const mat = super.fromTileAlpha(tile, frame);
    this._setTileScaleData(mat, tile);
    return mat;
  }

  /**
   * Build a matrix from a tile's cached _textureData property.
   * Only overhead tiles have this property, so if not found, return fromTileAlpha(tile).
   * @param {Tile} tile
   * @returns {PixelValueMatrix}
   */
  static fromOverheadTileAlpha(tile) {
    const mat = super.fromOverheadTileAlpha(tile);
    this._setTileScaleData(mat, tile);
    return mat;
  }
}

CanvasPixelValueMatrix.prototype.fromCanvasCoordinates = fromCanvasCoordinates;
CanvasPixelValueMatrix.prototype.toCanvasCoordinates = toCanvasCoordinates;
CanvasPixelValueMatrix._setTileScaleData = _setTileScaleData;

export class CanvasPixelValueShape extends PixelValueShape {
  /**
   * @type {object}
   * @property {numeric} x                Translation in x direction
   * @property {numeric} y                Translation in y direction
   * @property {numeric} sscX             Sign of stretch in x directino
   * @property {numeric} sscY             Sign of stretch in y direction
   * @property {numeric} ascX             Absolute value of stretch in x directino
   * @property {numeric} ascY             Absolute value of stretch in y direction
   * @property {numeric} rotation         Rotation in degrees
   */
  scale = {
    x: 0,
    y: 0,
    sscX: 1,
    sscY: 1,
    ascX: 1,
    ascY: 1,
    rotation: 0 // Radians
  };

  /** @type {numeric} */
  get scaleX() { return this.scale.sscX * this.scale.ascX; }

  /** @type {numeric} */
  set scaleX(value) {
    this.scale.sscX = Math.sign(value);
    this.scale.ascX = Math.abs(value);
  }

  /** @type {numeric} */
  get scaleY() { return this.scale.sscY * this.scale.ascY; }

  /** @type {numeric} */
  set scaleY(value) {
    this.scale.sscY = Math.sign(value);
    this.scale.ascY = Math.abs(value);
  }

  /** @type {numeric} */
  get rotation() { return this.scale.rotation; }

  /** @type {numeric} */
  set rotation(value) { this.scale.rotation = Math.normalizeRadians(value); }

  /** @type {numeric} */
  get rotationDegrees() { return Math.toDegrees(this.scale.rotation); }

  /** @type {numeric} */
  set rotationDegrees(value) { this.scale.rotation = Math.toRadians(value); }

  /**
   * Build a matrix from the tile's alpha channel
   * @param {Tile} tile                 Tile to use for the texture
   * @param {PIXI.Rectangle} [frame]    Optional frame, relative to the tile.texture
   * @returns {PixelValueMatrix}
   */
  static fromTileAlpha(tile, frame) {
    const mat = super.fromTileAlpha(tile, frame);
    this._setTileScaleData(mat, tile);
    return mat;
  }

  /**
   * Build a matrix from a tile's cached _textureData property.
   * Only overhead tiles have this property, so if not found, return fromTileAlpha(tile).
   * @param {Tile} tile
   * @returns {PixelValueMatrix}
   */
  static fromOverheadTileAlpha(tile) {
    const mat = super.fromOverheadTileAlpha(tile);
    this._setTileScaleData(mat, tile);
    return mat;
  }
}

CanvasPixelValueShape.prototype.fromCanvasCoordinates = fromCanvasCoordinates;
CanvasPixelValueShape.prototype.toCanvasCoordinates = toCanvasCoordinates;
CanvasPixelValueShape._setTileScaleData = _setTileScaleData;


/* Testing
tile = canvas.tiles.controlled[0]
tileMatOrig = PixelValueMatrix.fromTileAlpha(tile);

tileMat = CanvasPixelValueMatrix.fromTileAlpha(tile);
tileMat.scale.x = tile.document.x;
tileMat.scale.y = tile.document.y;
tileMat.scaleX = tile.document.texture.scaleX;
tileMat.scaleY = tile.document.texture.scaleY;
tileMat.rotationDegrees = tile.document.rotation
Draw.clearDrawings();
tileMat.draw();
Draw.clearDrawings();
tileMat.drawAliased();

Draw.clearDrawings();
color = Draw.COLORS.blue
for ( let i = 0; i < tileMat.length; i += 1 ) {
  const pt = tileMat.coordinatesAt(i);
  const alpha = tileMat.valueAt(pt);
  Draw.point(pt, { color, alpha })
}

*/
