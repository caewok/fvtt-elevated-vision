/* globals
GlobalLightSource,
canvas,
PIXI
*/
"use strict";

import { log, perpendicularPoint, distanceBetweenPoints } from "./util.js";

/** To test a light
drawing = game.modules.get("elevatedvision").api.drawing
drawing.clearDrawings()
[l] = canvas.lighting.placeables
l.source.los._drawShadows()

*/


/*
https://ptb.discord.com/channels/732325252788387980/734082399453052938/1006958083320336534

- aVertexPosition are the vertices of the polygon normalized; origin is (0,0), radius 1
- vUvs is aVertexPosition transformed such that the center is (0.5,0.5) and the radius 0.5,
  such that it's in the range [0,1]x[0,1]. Therefore the * 2.0 is required to calculate dist,
  otherwise dist wouldn't be in the range [0,1]
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
  log("createAdaptiveLightingShader");

  if ( this.fragmentShader.includes(FRAGMENT_UNIFORMS) ) return wrapped(...args);

  log("createAdaptiveLightingShader adding shadow shader code");
  const replaceFragUniformStr = "uniform sampler2D uBkgSampler;";
  const replaceFragStr = "float depth = smoothstep(0.0, 1.0, vDepth);";
  const replaceFragFnStr = "void main() {";

  this.fragmentShader = this.fragmentShader.replace(
    replaceFragUniformStr, `${replaceFragUniformStr}\n${FRAGMENT_UNIFORMS}`);

  this.fragmentShader = this.fragmentShader.replace(
    replaceFragStr, `${replaceFragStr}\n${DEPTH_CALCULATION}`);

  this.fragmentShader = this.fragmentShader.replace(
    replaceFragFnStr, `${FRAGMENT_FUNCTIONS}\n${replaceFragFnStr}\n`);

  // Replace at the very end
  this.fragmentShader = this.fragmentShader.replace(/}$/, `${FRAG_COLOR}\n }\n`);


//   log("createAdaptiveLightingShader adding shadow vertex code");
//   const replaceVertexUniformStr = "uniform vec3 origin;";
//   const replaceVertexStr = "vDepth = aDepthValue;";
//
//   this.vertexShader = this.vertexShader.replace(
//     replaceVertexUniformStr, `${replaceVertexUniformStr}\n${VERTEX_UNIFORMS}`);
//
//   this.vertexShader = this.vertexShader.replace(
//     replaceVertexStr, `${replaceVertexStr}\n${VERTEX_CANVAS_POSITION}`);

  const shader = wrapped(...args);
  shader.uniforms.EV_numWalls = 0;
  shader.uniforms.EV_wallElevations = new Float32Array(MAX_NUM_WALLS);
  shader.uniforms.EV_wallCoords = new Float32Array(MAX_NUM_WALLS*4);
  shader.uniforms.EV_lightElevation = 0.5;
  shader.uniforms.EV_wallDistances = new Float32Array(MAX_NUM_WALLS);
  shader.uniforms.EV_isVision = false;
  shader.uniforms.EV_elevationSampler = canvas.elevation._elevationTexture ?? PIXI.Texture.EMPTY;

  shader.uniforms.EV_transform = [1, 1, 1, 1];

  return shader;
}

const VERTEX_UNIFORMS =
`
uniform vec2 EV_canvasDimensions;
varying vec2 EV_vCanvasCoordNorm;
// uniform vec4 worldMatrix;
uniform vec4 EV_transform;
`;

const VERTEX_CANVAS_POSITION =
`
//   vec2 EV_vCanvasCoord = (translationMatrix * vec3(aVertexPosition, 1.0)).xy;
//   EV_vCanvasCoordNorm = EV_vCanvasCoord / EV_canvasDimensions;

//   vec4 EV_vCanvasCoord = worldMatrix * vec4(aVertexPosition, 1.0, 1.0);
//   EV_vCanvasCoordNorm = (worldMatrix / vec4(EV_canvasDimensions, 1.0, 1.0)).xy;

   vec2 EV_vCanvasCoord = (EV_canvasMatrix * vec3(aVertexPosition, 1.0)).xy;
   EV_vCanvasCoordNorm = EV_vCanvasCoord / EV_canvasDimensions;
`;

// 4 coords per wall (A, B endpoints).
const FRAGMENT_UNIFORMS =
`
uniform int EV_numWalls;
uniform vec4 EV_wallCoords[${MAX_NUM_WALLS}];
uniform float EV_wallElevations[${MAX_NUM_WALLS}];
uniform float EV_wallDistances[${MAX_NUM_WALLS}];
uniform float EV_lightElevation;
uniform bool EV_isVision;
uniform sampler2D EV_elevationSampler;
uniform vec4 EV_transform;
`;

// Helper functions used to calculate shadow trapezoids.
const FRAGMENT_FUNCTIONS =
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
`;


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

Also need the height from the current position on the canvas for which the shadow no longer
applies. That can be simplified:
- Subtract the current pixel elevation from the light elevation to get a new light elevation.



*/

const DEPTH_CALCULATION =
`
// If elevation at this point is above the light, then set depth to 0.0.
// vec4 backgroundElevation = texture2D(EV_elevationSampler, EV_vCanvasCoordNorm);
// if ( backgroundElevation.r)

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
`;

const FRAG_COLOR =
`
  if ( EV_isVision && depth == 0.0 ) {
//     gl_FragColor = vec4(EV_vCanvasCoordNorm.xy, 0.0, 1.0);
    vec2 EV_textureCoord = EV_transform.xy * vUvs + EV_transform.zw;
    vec4 backgroundElevation = texture2D(EV_elevationSampler, EV_textureCoord);

    gl_FragColor = backgroundElevation;
//     if ( backgroundElevation.r > 0.1 ) {
//       gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
//     } else {
//       gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
//     }
  }
`;

/**
 * Wrap LightSource.prototype._updateColorationUniforms.
 * Add uniforms needed for the shadow fragment shader.
 */
export function _updateColorationUniformsLightSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;

  log(`_updateColorationUniformsLightSource ${this.object.id}`);
  this._updateEVLightUniforms(this.coloration);
}

/**
 * Wrap LightSource.prototype._updateIlluminationUniforms.
 * Add uniforms needed for the shadow fragment shader.
 */
export function _updateIlluminationUniformsLightSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;

  log(`_updateIlluminationUniformsLightSource ${this.object.id}`);
  this._updateEVLightUniforms(this.illumination);
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
export function _updateEVLightUniformsLightSource(mesh) {
  const shader = mesh.shader;
  const { x, y, radius, elevationZ } = this;
  const { width, height } = canvas.dimensions;

  const walls = this.los.wallsBelowSource;

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
    const a = pointCircleCoord(w.A, radius, center, r_inv);
    const b = pointCircleCoord(w.B, radius, center, r_inv);

    // Point where line from light, perpendicular to wall, intersects
    const wallIx = perpendicularPoint(a, b, center_shader);
    if ( !wallIx ) continue; // Likely a and b not proper wall
    const wallOriginDist = distanceBetweenPoints(center_shader, wallIx);
    wallDistances.push(wallOriginDist);
    wallElevations.push(w.topZ * 0.5 * r_inv);

    wallCoords.push(a.x, a.y, b.x, b.y);
  }

  u.EV_wallCoords = wallCoords;
  u.EV_wallElevations = wallElevations;
  u.EV_wallDistances = wallDistances;
  u.EV_elevationSampler = canvas.elevation._elevationTexture;
  u.EV_canvasDimensions = [width, height];
  u.EV_isVision = true;

  // Screen-space to local coords:
  // https://ptb.discord.com/channels/732325252788387980/734082399453052938/1010914586532261909
  // shader.uniforms.EV_canvasMatrix ??= new PIXI.Matrix();
  // shader.uniforms.EV_canvasMatrix
  //   .copyFrom(canvas.stage.worldTransform)
  //   .invert()
  //   .append(mesh.transform.worldTransform);

  // Alternative version using vUvs, given that light source mesh have no rotation
  // https://ptb.discord.com/channels/732325252788387980/734082399453052938/1010999752030171136
  u.EV_transform = [
    radius * 2 / width,
    radius * 2 / height,
    (x - radius) / width,
    (y - radius) / height];
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
function pointCircleCoord(point, r, center, r_inv = 1 / r) {
  return {
    x: circleCoord(point.x, r, center.x, r_inv),
    y: circleCoord(point.y, r, center.y, r_inv)
  };
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
function circleCoord(a, r, c = 0, r_inv = 1 / r) {
  return ((a - c) * r_inv * 0.5) + 0.5;
}

/**
 * Inverse of circleCoord.
 * @param {number} p    Coordinate value, in the shader coordinate system between 0 and 1.
 * @param {number} c    Center value, along the axis of interest
 * @param {number} r    Radius
 * @returns {number}
 */
function revCircleCoord(p, r, c = 0) { // eslint-disable-line no-unused-vars
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
