/* globals
PIXI,
canvas
*/
"use strict";

import { log, perpendicularPoint, distanceBetweenPoints, zValue } from "./util.js";
import { MODULE_ID } from "./const.js";

/** To test a light
drawing = game.modules.get("elevatedvision").api.drawing
drawing.clearDrawings()
[l] = canvas.lighting.placeables
l.source.los._drawShadows()

*/


/*
https://ptb.discord.com/channels/732325252788387980/734082399453052938/1006958083320336534

- aVertexPosition are the vertices of the polygon normalized; origin is (0,0), radius 1
-  vUvs is aVertexPosition transformed such that the center is (0.5,0.5) and the radius 0.5, such that it's in the range [0,1]x[0,1]. Therefore the * 2.0 is required to calculate dist, otherwise dist wouldn't be in the range [0,1]
- aDepthValue/vDepth is the edge falloff: the distance to the boundary of the polygon normalized
- vSamplerUvs are the texture coordinates used for sampling from a screen-sized texture

*/

// In GLSL 2, cannot use dynamic arrays. So set a maximum number of walls for a given light.
const MAX_NUM_WALLS = 100;

/**
 * Wrap AdaptiveLightingShader.prototype.create
 * Add uniforms used by the fragment shader to draw shadows in the color and illumination shaders.
 */
export function createAdaptiveLightingShader(wrapped, ...args) {
//   if (!this.fragmentShader.includes("#version 300 es")) {
// //     this.vertexShader = "#version 300 es \n" + this.vertexShader;
//     this.fragmentShader = "#version 300 es \n precision mediump float; \n" + this.fragmentShader;
//   }

  log("createAdaptiveLightingShader");

  if ( this.fragmentShader.includes(UNIFORMS) ) return wrapped(...args);

  log("createAdaptiveLightingShader adding shadow shader code");

  const replaceUniformStr = "uniform sampler2D uBkgSampler;";
  const replaceFragStr = "float depth = smoothstep(0.0, 1.0, vDepth);";
  const replaceFnStr = "void main() {";

  this.fragmentShader = this.fragmentShader.replace(
    replaceUniformStr, `${replaceUniformStr}\n${UNIFORMS}`);

  this.fragmentShader = this.fragmentShader.replace(
    replaceFragStr, `${replaceFragStr}\n${DEPTH_CALCULATION}`);

  this.fragmentShader = this.fragmentShader.replace(
    replaceFnStr, `${FUNCTIONS}\n${replaceFnStr}\n`);

  // replace at the very end
  this.fragmentShader = this.fragmentShader.replace(new RegExp("}$"), `${FRAG_COLOR}\n }\n`);


  const shader = wrapped(...args);
  shader.uniforms.EV_numWalls = 0;
  shader.uniforms.EV_wallElevations = new Float32Array(MAX_NUM_WALLS);
  shader.uniforms.EV_wallCoords = new Float32Array(MAX_NUM_WALLS*4);;
  shader.uniforms.EV_lightElevation = 0.5;
  shader.uniforms.EV_wallDistances = new Float32Array(MAX_NUM_WALLS);
  shader.uniforms.EV_isVision = false;
  return shader;
}



// 4 coords per wall (A, B endpoints).
const UNIFORMS =
`
uniform int EV_numWalls;
uniform vec4 EV_wallCoords[${MAX_NUM_WALLS}];
uniform float EV_wallElevations[${MAX_NUM_WALLS}];
uniform float EV_wallDistances[${MAX_NUM_WALLS}];
uniform float EV_lightElevation;
uniform bool EV_isVision;
`;

// Helper functions used to calculate shadow trapezoids.
const FUNCTIONS =
`
float orient2d(in vec2 a, in vec2 b, in vec2 c) {
  return (a.y - c.y) * (b.x - c.x) - (a.x - c.x) * (b.y - c.y);
}

// Does segment AB intersect the segment CD?
bool lineSegmentIntersects(in vec2 a, in vec2 b, in vec2 c, in vec2 d) {
  float xa = orient2d(a, b, c);
  float xb = orient2d(a, b, d);
  if ( xa == 0.0 && xb == 0.0 ) return false;

  bool xab = (xa * xb) <= 0.0;
  bool xcd = (orient2d(c, d, a) * orient2d(c, d, b)) <= 0.0;
  return xab && xcd;
}

// Point on line AB that forms perpendicular point to C
vec2 perpendicularPoint(in vec2 a, in vec2 b, in vec2 c) {
  vec2 deltaBA = b - a;

  // dab might be 0 but only if a and b are equal
  float dab = pow(deltaBA.x, 2.0) + pow(deltaBA.y, 2.0);
  vec2 deltaCA = c - a;

  float u = ((deltaCA.x * deltaBA.x) + (deltaCA.y * deltaBA.y)) / dab;
  return vec2(a.x + (u * deltaBA.x), a.y + (u * deltaBA.y));
}
`


/*

 Looking at a cross-section:
  O----------W----V-----?
  | \ Ø      |    |
Oe|    \     |    |
  |       \  |    |
  |          \    |
  |        We| Ø \ | <- point V where obj can be seen by O for given elevations
  ----------------•----
  |<-   OV      ->|
 e = height of O (vision/light object center)
 Ø = theta
 W = wall

Oe must be greater than We or no shadow.

opp = Oe - We
adj = OW
theta = atan(opp / adj)

OV = Oe / tan(theta)

*/

const DEPTH_CALCULATION =
`
const vec2 center = vec2(0.5);
const int maxWalls = ${MAX_NUM_WALLS};
for ( int i = 0; i < maxWalls; i++ ) {
  if ( i >= EV_numWalls ) break;

  // If the wall is higher than the light, skip. (Should not currently happen.)
  float We = EV_wallElevations[i];
  if ( EV_lightElevation <= We ) continue;

  // If the wall does not intersect the line between the center and this point, no shadow here.
  vec4 wall = EV_wallCoords[i];
  if ( !lineSegmentIntersects(vUvs, center, wall.xy, wall.zw) ) continue;

  float distOW = EV_wallDistances[i];

   // Distance from wall (as line) to this location
   vec2 wallIxPoint = perpendicularPoint(wall.xy, wall.zw, vUvs);
   float distWP = distance(vUvs, wallIxPoint);

   // atan(opp/adj) equivalent to JS Math.atan(opp/adj)
   // atan(y, x) equivalent to JS Math.atan2(y, x)
   float theta = atan((EV_lightElevation - We) /  distOW);

   // Distance from center/origin to furthest part of shadow perpendicular to wall
   float distOV = EV_lightElevation / tan(theta);
   float maxDistWP = distOV - distOW;

   if ( distWP < maxDistWP ) {
     // Current location is within shadow.
     // Could be more than one wall casting shadow on this point, so don't break.
     // depth = 0.0; // For testing
     depth = distWP / maxDistWP;

     if ( EV_isVision ) depth = 0.0;
   }
}
`

const FRAG_COLOR =
`
  if ( EV_isVision && depth == 0.0 ) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
`

/**
Testing:

function clearDrawings() { canvas.controls.debug.clear(); }

COLORS = {
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

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function perpendicularPoint(a, b, c) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dab = Math.pow(dx, 2) + Math.pow(dy, 2);
  if ( !dab ) return null;

  const u = (((c.x - a.x) * dx) + ((c.y - a.y) * dy)) / dab;
  return {
    x: a.x + u * dx,
    y: a.y + u * dy
  };
}

function revCirclePoint(p, c, r) {
  return {
    x: revCircleCoord(p.x, c.x, r),
    y: revCircleCoord(p.y, c.y, r)
  }
}

function revCircleCoord(p, c, r) {
  return (((p * 2) - 1) * r) + c;
}

function drawTranslatedPoint(p, c, r, { color = COLORS.red, alpha = 1, radius = 5 } = {}) {
  p = revCirclePoint(p, c, r);
  canvas.controls.debug
      .beginFill(color, alpha)
      .drawCircle(p.x, p.y, radius)
      .endFill();
}

function drawTranslatedSegment(s, c, r, { color = COLORS.blue, alpha = 1, width = 1 } = {}) {
  const A = revCirclePoint(s.A, c, r);
  const B = revCirclePoint(s.B, c, r);

  canvas.controls.debug.lineStyle(width, color, alpha)
      .moveTo(A.x, A.y)
      .lineTo(B.x, B.y);
}


[l] = canvas.lighting.placeables
cirCenter = { x: l.source.x, y: l.source.y }
cirRadius = l.source.radius

shader = l.source.illumination.shader
let { EV_lightElevation, EV_numWalls, EV_wallCoords, EV_wallElevations } = shader.uniforms;

center = { x: 0.5, y: 0.5 };
drawTranslatedPoint(center, cirCenter, cirRadius, {color: COLORS.blue});

maxEndpoints = 200;
originElevation = 0.5

for ( let j = 0; j < 10000; j += 1 ) {
// vUvs = { x: 0.1, y: 0.1 }
vUvs = { x: Math.random(), y: Math.random() }

drawTranslatedPoint(vUvs, cirCenter, cirRadius, {color: COLORS.red, alpha: .1, radius: 2});
  for ( let i = 0; i < maxEndpoints; i++ ) {
    if ( i >= EV_numWalls ) break;

    wall = {
      x: EV_wallCoords[i * 4],
      y: EV_wallCoords[i * 4 + 1],
      z: EV_wallCoords[i * 4 + 2],
      w: EV_wallCoords[i * 4 + 3]
    }
    A = { x: wall.x, y: wall.y };
    B = { x: wall.z, y: wall.w }

  //   drawTranslatedSegment({A, B}, cirCenter, cirRadius, {color: COLORS.black})

    // does this location --> origin intersect the wall?
    if ( !foundry.utils.lineSegmentIntersects(vUvs, center, {x: wall.x, y: wall.y}, {x: wall.z, y: wall.w}) ) continue;

  //   drawTranslatedSegment({A: center, B: vUvs}, cirCenter, cirRadius, { color: COLORS.blue, alpha: 0.5})

    // Point of wall that forms a perpendicular line to the origin light
    wallIxOrigin = perpendicularPoint(A, B, center);
    if ( !wallIxOrigin ) continue;

    wallIxPoint = perpendicularPoint(A, B, vUvs);
    if ( !wallIxPoint ) continue;

    distVT = distance(center, wallIxOrigin);
    distTO = distance(vUvs, wallIxPoint);

    theta = Math.atan(Math.abs(EV_lightElevation - originElevation) / distVT);
    distTOMax = Math.abs(EV_wallElevations[i] - originElevation)  / Math.tan(theta);

    if ( distTO < distTOMax ) {
      //depth = 0.0;
      //depth = smoothstep(0.0, 1.0, distTO);
      depth = (1 - distTO / distTOMax);
      if ( depth < 0 || depth > 1 ) console.log(depth);

      drawTranslatedPoint(vUvs, cirCenter, cirRadius, {color: COLORS.red, alpha: depth, radius: 2});
      break;
    }
  }
}


*/

/**
 * Wrap LightSource.prototype._updateColorationUniforms.
 * Add uniforms needed for the shadow fragment shader.
 */
export function _updateColorationUniformsLightSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;

  log(`_updateColorationUniformsLightSource ${this.object.id}`);
  const { x, y, radius } = this;
  this._updateEVLightUniforms(this.coloration.shader);
}

/**
 * Wrap LightSource.prototype._updateIlluminationUniforms.
 * Add uniforms needed for the shadow fragment shader.
 */
export function _updateIlluminationUniformsLightSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;

  log(`_updateIlluminationUniformsLightSource ${this.object.id}`);
  const { x, y, radius } = this;
  this._updateEVLightUniforms(this.illumination.shader);
}

/**
 * Helper function to add uniforms for the light shaders.
 * Add:
 * - elevation of the light
 * - number of walls that are in the LOS and below the light source elevation
 * For each wall that is below the light source, add
 *   (in the coordinate system used in the shader):
 * - wall coordinates
 * - wall elevations
 * - distance between the wall and the light source center
 * @param {PIXI.Shader} shader
 */
export function _updateEVLightUniformsLightSource(shader) {
  const { x, y, radius, elevationZ } = this;
  const walls = this.los.wallsBelowSource;
  if ( !walls || !walls.size ) return;

  const center = {x, y};
  const r_inv = 1 / radius;

  // Radius is .5 in the shader coordinates; adjust elevation accordingly
  const u = shader.uniforms;
  u.EV_lightElevation = elevationZ * 0.5 * r_inv;
  u.EV_numWalls = walls.size;

  const center_shader = {x: 0.5, y: 0.5};
  const wallCoords = [];
  const wallElevations = [];
  const wallDistances = [];

  for ( const w of walls ) {
    const a = pointCircleCoord(w.A, center, radius, r_inv);
    const b = pointCircleCoord(w.B, center, radius, r_inv);

    // Point where line from light, perpendicular to wall, intersects
    const wallIx = perpendicularPoint(a, b, center_shader);
    if ( !wallIx ) continue; // Likely a and b not proper wall
    const wallOriginDist = distanceBetweenPoints(center_shader, wallIx);
    wallDistances.push(wallOriginDist);
    wallElevations.push(w.topZ * 0.5 * r_inv);

    wallCoords.push(a.x, a.y, b.x, b.y);
  }

  u.EV_wallCoords = wallCoords
  u.EV_wallElevations = wallElevations;
  u.EV_wallDistances = wallDistances;
}

/**
 * Transform a point coordinate to be in relation to a circle center and radius.
 * Between 0 and 1 where [0.5, 0.5] is the center
 * [0, .5] is at the edge in the westerly direction.
 * [1, .5] is the edge in the easterly direction
 * @param {Point} point
 * @param {Point} center
 * @param {number} r      Radius
 * @param {number} r_inv  Inverse of the radius. Optional; for repeated calcs.
 * @returns {Point}
 */
function pointCircleCoord(point, center, r, r_inv = 1 / r) {
  return {
    x: circleCoord(point.x, center.x, r, r_inv),
    y: circleCoord(point.y, center.y, r, r_inv)
  }
}

/**
 * Transform a coordinate to be in relation to a circle center and radius.
 * Between 0 and 1 where [0.5, 0.5] is the center.
 * @param {number} a    Coordinate value
 * @param {number} c    Center value, along the axis of interest
 * @param {number} r    Light circle radius
 * @param {number} r_inv  Inverse of the radius. Optional; for repeated calcs.
 * @returns {number}
 */
function circleCoord(a, c = 0, r, r_inv = 1 / r) {
  return ((a - c) * r_inv * 0.5) + 0.5
}

/**
 * Inverse of circleCoord.
 * @param {number} p    Coordinate value, in the shader coordinate system between 0 and 1.
 * @param {number} c    Center value, along the axis of interest
 * @param {number} r    Radius
 * @returns {number}
 */
function revCircleCoord(p, c = 0, r) {
  // Calc:
  // ((a - c) / 2r) + 0.5 = p
  //  ((a - c) / 2r) = p +  0.5
  //  a - c = (p + 0.5) * 2r
  //  a = (p + 0.5) * 2r + c
  return ((p + 0.5) * 2 * r) + c;
}

/**
 * Wrap LightSource.prototype._createLOS.
 * Trigger an update to the illumination and coloration uniforms, so that
 * the light reflects the current shadow positions when dragged.
 * @returns {ClockwiseSweepPolygon}
 */
export function _createLOSLightSource(wrapped) {
  log(`_createLOSLightSource ${this.object.id}`);
  const los = wrapped();

  // TO-DO: Only reset uniforms if:
  // 1. there are shadows
  // 2. there were previously shadows but are now none

  this._resetUniforms.illumination = true;
  this._resetUniforms.coloration = true;

  return los;
}
