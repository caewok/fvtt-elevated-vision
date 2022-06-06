// Drawing tools for debugging.

/* globals
canvas,
PIXI,
CONFIG
*/

"use strict";

/**
 * Hex codes for common colors.
 */
export const COLORS = {
  orange: 0xFFA500,
  yellow: 0xFFFF00,
  greenyellow: 0xADFF2F,
  green: 0x00FF00,
  blue: 0x0000FF,
  lightblue: 0xADD8E6,
  red: 0xFF0000,
  gray: 0x808080,
  black: 0x000000,
  white: 0xFFFFFF
};


/**
 * Draw a point on the canvas.
 * @param {Point} p
 * Optional:
 * @param {Hex}     color   Hex code for the color to use.
 * @param {Number}  alpha   Transparency level.
 * @param {Number}  radius  Radius of the point in pixels.
 */
export function drawPoint(p, { color = COLORS.red, alpha = 1, radius = 5 } = {}) {
  /* eslint-disable indent */
  canvas.controls.debug
      .beginFill(color, alpha)
      .drawCircle(p.x, p.y, radius)
      .endFill();
}

export function drawPolygonPoints(poly, { color = COLORS.red, alpha = 1, radius = 5 } = {}) {
  for ( const pt of poly.iteratePoints() ) { drawPoint(pt, { color, alpha, radius}); }
}

/**
 * Draw a segment on the canvas.
 * @param {Segment} s   Object with A and B {x, y} points.
 * Optional:
 * @param {Hex}     color   Hex code for the color to use.
 * @param {Number}  alpha   Transparency level.
 * @param {Number}  width   Width of the line in pixels.
 */
export function drawSegment(s, { color = COLORS.blue, alpha = 1, width = 1 } = {}) {
  /* eslint-disable indent */
  canvas.controls.debug.lineStyle(width, color, alpha)
      .moveTo(s.A.x, s.A.y)
      .lineTo(s.B.x, s.B.y);
}

/**
 * Draw the edges of a polygon on the canvas.
 * @param {PIXI.Polygon} poly
 * Optional:
 * @param {Hex}     color   Hex code for the color to use.
 * @param {Number}  width   Width of the line in pixels.
 */
export function drawShape(shape, { color = COLORS.black, width = 1 } = {}) {
  canvas.controls.debug.lineStyle(width, color).drawShape(shape);
}

export const drawPolygon = drawShape;


/**
 * Create a text label at a specified position on the canvas.
 * Tracks location so that only one piece of text is at any given x,y position.
 * @param {Point}   p     Location of the start of the text.
 * @param {String}  text  Text to draw.
 */
export function labelPoint(p, text) {
  if (!canvas.controls.debug.polygonText) {
    canvas.controls.debug.polygonText = canvas.controls.addChild(new PIXI.Container());
  }
  const polygonText = canvas.controls.debug.polygonText;

  // Update existing label if it exists at or very near Poly endpoint
  const idx = polygonText.children.findIndex(c => p.x.almostEqual(c.position.x) && p.y.almostEqual(c.position.y));
  if (idx !== -1) { canvas.controls.debug.polygonText.removeChildAt(idx); }

  const t = polygonText.addChild(new PIXI.Text(String(text), CONFIG.canvasTextStyle));
  t.position.set(p.x, p.y);
}

/**
 * Clear all labels created by labelPoint.
 */
export function clearLabels() {
  canvas.controls.debug.polygonText?.removeChildren();
}

/**
 * Clear all drawings, such as those created by drawPoint, drawSegment, or drawPolygon.
 */
export function clearDrawings() { canvas.controls.debug.clear(); }

