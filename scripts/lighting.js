/* globals
PIXI,
canvas
*/
"use strict";

import { log, perpendicularPoint, distanceBetweenPoints } from "./util.js";
import { MODULE_ID } from "./const.js";

/*
https://ptb.discord.com/channels/732325252788387980/734082399453052938/1006958083320336534

- aVertexPosition are the vertices of the polygon normalized; origin is (0,0), radius 1
-  vUvs is aVertexPosition transformed such that the center is (0.5,0.5) and the radius 0.5, such that it's in the range [0,1]x[0,1]. Therefore the * 2.0 is required to calculate dist, otherwise dist wouldn't be in the range [0,1]
- aDepthValue/vDepth is the edge falloff: the distance to the boundary of the polygon normalized
- vSamplerUvs are the texture coordinates used for sampling from a screen-sized texture

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

  const shader = wrapped(...args);
  shader.uniforms.EV_numWalls = 0;
  shader.uniforms.EV_wallElevations = new Float32Array();
  shader.uniforms.EV_wallCoords = new Float32Array();
  shader.uniforms.EV_lightElevation = .5;
  shader.uniforms.EV_wallDistances = new Float32Array();
  return shader;
}

// In GLSL 2, cannot use dynamic arrays. So set a maximum number of walls for a given light.
const MAX_NUM_WALLS = 100;

// 4 coords per wall (A, B endpoints).
// I don't know why uniform vec2 EV_wallCoords[${MAX_NUM_WALLS * 2}]; doesn't work
const UNIFORMS =
`
uniform int EV_numWalls;
uniform vec4 EV_wallCoords[${MAX_NUM_WALLS}];
uniform float EV_wallElevations[${MAX_NUM_WALLS}];
uniform float EV_wallDistances[${MAX_NUM_WALLS}];
uniform float EV_lightElevation;
`;

// For now, just mark the endpoints of walls
// If near a wall endpoint, make depth 0.
// Use maxIts to avoid issue in GLSL 1 about indexing conditional must be constant
// const DEPTH_CALCULATION =
// `
// const int maxIts = ${MAX_NUM_WALLS * 2};
// for ( int i = 0; i < maxIts; i++ ) {
//   if ( maxIts > EV_numEndpoints ) break;
//
//   vec2 coords = EV_wallCoords[i];
//   float z = EV_wallHeights[i / 2];
//
//   vec3 e0 = vec3(coords, z);
//   vec4 t0 = vec4(projectionMatrix * (translationMatrix * e0), 1);
//
//   if ( distance(t0, gl_FragCoord) < EV_pointRadius ) {
//     depth = 0.0;
//     break;
//   }
// }
// `;

// origin is vec3
/*
float dist = distance(vUvs, vec2(0.5)) * 2.0;
dist 1 is the radius size
so:
  if ( dist < 0.1 ) { depth = 0.0; }
  if radius is 25, 25 * .1 = 2.5; alpha/depth will be 0 within 2.5 feet of the center.

Thus, vec2(0.5) (0.5, 0.5) must be the circle center.
If vUvs is (0, 0), then distance([0,0], [0.5,0.5]) = .707 * 2 = 1.414
If vUvs is (.4, .5), then it is 5 feet away (.1*2) from the circle center in the x direction.
  distance([.4, .5], [.5,.5]) = 0.1 * 2 = .2

*/


// Draw an empty space with 2.5 foot radius, 10 feet from circle center
// const DEPTH_CALCULATION =
// `
// vec2 coord = vec2(.3, .5);
// float distCoord = distance(vUvs, coord) * 2.0;
//
// if ( distCoord < EV_pointRadius ) {
//   depth = 0.0;
// }
// `

// Draw the height as alpha
// const DEPTH_CALCULATION =
// `
// if ( EV_numEndpoints > 0 ) {
//   depth = clamp(EV_wallElevations[0], 0.0, 1.0);
// }
//
// `

// Draw the light elevation as alpha
// const DEPTH_CALCULATION =
// `
// depth = clamp(EV_lightElevation, 0.0, 1.0);
//
// `

// Draw coord as alpha
// const DEPTH_CALCULATION =
// `
// if ( EV_numEndpoints > 0 ) {
//   float x = EV_wallCoords[0];
//   depth = clamp(x, 0.0, 1.0);
// }
// `

// Draw coord as alpha
// const DEPTH_CALCULATION =
// `
// if ( EV_numEndpoints > 0 ) {
//   vec2 coord0 = EV_wallCoords[0];
//   depth = clamp(coord0.x, 0.0, 1.0);
// }
// `




// Draw the endpoints
// const DEPTH_CALCULATION =
// `
// const int maxEndpoints = ${MAX_NUM_WALLS * 2};
// for ( int i = 0; i < maxEndpoints; i++ ) {
//   if ( i >= EV_numEndpoints ) break;
//
//   vec2 coords = EV_wallCoords[i];
//
//   float distCoord0 = distance(vUvs, coords) * 2.0;
//   if ( distCoord0 < .01 ) {
//     depth = 0.0;
//     break;
//   }
// }
// `

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
vec4 wall = EV_wallCoords[0];
float We =  EV_wallElevations[0];
// Does this location --> origin intersect the wall?
if ( EV_lightElevation > EV_wallElevations[0] && lineSegmentIntersects(vUvs, center, wall.xy, wall.zw) ) {
   float distOW = EV_wallDistances[0];

   // Distance from wall (as line) to this location
   vec2 wallIxPoint = perpendicularPoint(wall.xy, wall.zw, vUvs);
   float distWP = distance(vUvs, wallIxPoint);

   // atan(opp/adj) equivalent to JS Math.atan(opp/adj)
   // atan(y, x) equivalent to JS Math.atan2(y, x)
   float theta = atan((EV_lightElevation - We) /  distOW);

   // Distance from center/origin to furthest part of shadow perpendicular to wall
   float distOV = EV_lightElevation / tan(theta);   // tan(theta) = Oe / OV
   float maxDistWP = distOV - distOW;

   if ( distWP < maxDistWP ) {
     depth = 0.0; // Single depth value is fine.
//      depth = 1.0 - (distWP / maxDistWP); // Reverse gradient is fine
//      depth = distWP / maxDistWP;
   }
}
`

// Shadow calculation using endpoints.
// For now, just depth 0 if in shadow
// 1. Determine if the pixel location --> origin intersects the wall (overhead x,y view)
// 2. Determine if the pixel location --> origin intersects the wall (cross-section x,z view)
// const DEPTH_CALCULATION =
// `
// const vec2 center = vec2(0.5);
// const int maxEndpoints = ${MAX_NUM_WALLS * 2};
// const float originElevation = 0.5;
// for ( int i = 0; i < maxEndpoints; i++ ) {
//   if ( i >= EV_numWalls ) break;
//
//   vec4 wall = EV_wallCoords[i];
//
//   // does this location --> origin intersect the wall?
//   if ( !lineSegmentIntersects(vUvs, center, wall.xy, wall.zw) ) continue;
//
//   // Point of wall that forms a perpendicular line to the origin light
//   vec2 wallIxOrigin = perpendicularPoint(wall.xy, wall.zw, center);
//   vec2 wallIxPoint = perpendicularPoint(wall.xy, wall.zw, vUvs);
//
//   float distVT = distance(center, wallIxOrigin);
//   float distTO = distance(vUvs, wallIxPoint);
//
//   float theta = atan(abs(EV_lightElevation - originElevation) / distVT);
//   float distTOMax = abs(EV_wallElevations[i] - originElevation)  / tan(theta);
//
//   if ( distTO < distTOMax ) {
// //     if ( distTO < 0.5 ) {
// //       depth = 0.25;
// //     } else {
// //       depth = .75;
// //     }
//
//     depth = .25;
// //     depth = smoothstep(0.0, 1.0, distTO / distTOMax);
//
// //     depth = clamp(distTO, 0.1, 0.9);
// //     depth = clamp(distTO / distTOMax, 0.4, 0.7);
// //     depth = (1.0 - (distTO / distTOMax)); // This reverses it
//     break;
//   }
// }
// `

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


/*
Rotate a line to be vertical

if A.x == B.x already vertical

Take the lesser x: A.x or B.x. Rotate around that.
minP = A.x < B.x ? A : B

Two versions:
minP.y < maxP.y: line slopes down. angle = tan(angle) = opp / adj = (maxP.y - minP.y) / (maxP.x - minP.x)
minP.y > maxP.y: line slopes up. angle = tan(angle) = opp / adj = (minP.y - maxP.y) / (maxP.x - minP.x)

[x] = [ cos(angle) -sin(angle) ]
[y]   [ sin(angle)  cos(angle) ]

Also need to rotate in z direction (yz clockwise 90º / counter 270º?)
[ 0 cos(270) -sin(270) ]
[ 0 sin(270)  cos(270) ]
[ 0 0         1]
*/


/**
 * @param {number[]} mat    Array, representing a square matrix
 * @param {number[]} vec    Array, representing a vector
 * @return {number[]} Vector result of mat * v
 */
function multMatrixVector(mat, vec) {
  const vln = vec.length;
  const matLn = mat.length;
  if ( matLn % vln !== 0 ) console.warn("multSquareMatrixVector requires matrix rows to equal vector length.");

  const res = [];
  for ( let r = 0; r < matLn; r += vln ) {
    let val = 0;
    for ( let c = 0; c < vln; c += 1 ) {
//       console.log(`r: ${r}; c: ${c} | ${mat[r + c]} * ${vec[c]}`)
      val += mat[r + c] * vec[c];
    }
    res.push(val);
  }
  return res;
}

/**
 * @param {number[]} mat3   Array, representing a 3x3 matrix.
 * @return {number[]} An array representing a 4x4 matrix
 */
function to4D(mat3) {
  return [
    mat3[0], mat3[1], mat3[2], 0,
    mat3[3], mat3[4], mat3[5], 0,
    mat3[6], mat3[7], mat3[9], 0,
    0, 0, 0, 1
  ];
}

export function _updateColorationUniformsLightSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;

  log(`_updateColorationUniformsLightSource ${this.object.id}`);
  const { x, y, radius } = this;
  this._updateEVLightUniforms(this.coloration.shader);
}

export function _updateIlluminationUniformsLightSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;

  log(`_updateIlluminationUniformsLightSource ${this.object.id}`);
  const { x, y, radius } = this;
  this._updateEVLightUniforms(this.illumination.shader);
}

export function _updateEVLightUniformsLightSource(shader) {
  const { x, y, radius, elevationZ } = this;
  const shadows = this.los.shadowsWalls;
  if ( !shadows ) return;

  const center = {x, y};
  const r_inv = 1 / radius;
  const numWalls = shadows.length
  const lightE = elevationGridUnits(elevationZ);

  const u = shader.uniforms;

  // Radius is .5 in the shader coordinates; adjust elevation accordingly
  u.EV_lightElevation = lightE * 0.5 * r_inv;
  u.EV_numWalls = numWalls;

  const center_shader = {x: 0.5, y: 0.5};
  const wallCoords = [];
  const wallElevations = [];
  const wallDistances = [];

  for ( let i = 0; i < numWalls; i += 1 ) {
    const s = shadows[i];
    const a = pointCircleCoord(s.wall.A, center, radius, r_inv);
    const b = pointCircleCoord(s.wall.B, center, radius, r_inv);

    // Point where line from light, perpendicular to wall, intersects
    const wallIx = perpendicularPoint(a, b, center_shader);
    if ( !wallIx ) continue; // Likely a and b not proper wall
    const wallOriginDist = distanceBetweenPoints(center_shader, wallIx);
    wallDistances.push(wallOriginDist);

    const wallE = elevationGridUnits(s.wall.topZ);
    wallElevations.push(wallE * 0.5 * r_inv);

    wallCoords.push(a.x, a.y, b.x, b.y);
  }

  u.EV_wallCoords = wallCoords
  u.EV_wallElevations = wallElevations;
  u.EV_wallDistances = wallDistances;
}

function elevationGridUnits(e) {
  const { distance, size } = canvas.grid.grid.options.dimensions;
  return (e * size) / distance
}

/**
 * Transform a point coordinate to be in relation to a circle center and radius.
 * Between 0 and 1 where [0.5, 0.5] is the center
 * [0, .5] is at the edge in the westerly direction.
 * [1, .5] is the edge in the easterly direction
 * @param {Point} point
 * @param {number} radius
 * @param {Point} center
 * @returns {Point}
 */
function pointCircleCoord(point, center, r, r_inv = 1 / r) {
  return {
    x: circleCoord(point.x, center.x, r, r_inv),
    y: circleCoord(point.y, center.y, r, r_inv)
  }
}

function circleCoord(a, c = 0, r, r_inv = 1 / r) {
  return ((a - c) * r_inv * 0.5) + 0.5
}

// ((a - c) / 2r) + 0.5 = p
//  ((a - c) / 2r) = p +  0.5
//  a - c = (p + 0.5) * 2r
//  a = (p + 0.5) * 2r + c

function revCircleCoord(p, c = 0, r) {
  return ((p + 0.5) * 2 * r) + c;
}








/*
 this.fragmentShader = this.fragmentShader.replace(
            "uniform sampler2D uBkgSampler;",
            "uniform sampler2D uBkgSampler;\nuniform sampler2D mymodule_maskTexture;"
        );
        this.fragmentShader = this.fragmentShader.replace(
             "float depth = smoothstep(0.0, 1.0, vDepth);",
             "float depth = smoothstep(0.0, 1.0, vDepth);\ndepth *= texture2D(mymodule_maskTexture, vSamplerUvs).r;"
        );
*/

export function _createLOSLightSource(wrapped) {
  log(`_createLOSLightSource ${this.object.id}`);
  const los = wrapped();
//   if ( !los.shadows || !los.shadows.length ) return los;
//
//   log("Adding shadow filter");
//   this.createReverseShadowMaskFilter()
//   this.illumination.filters = [this.reverseShadowMaskFilter];
//   this.coloration.filters = [this.reverseShadowMaskFilter];
//

  // TO-DO: Only reset uniforms if:
  // 1. there are shadows
  // 2. there were previously shadows but are now none

  this._resetUniforms.illumination = true;
  this._resetUniforms.coloration = true;

  return los;
}


export function drawLightLightSource(wrapped) {
  log("drawLightLightSource");
  const isDebugging = game.modules.get("_dev-mode")?.api?.getPackageDebugValue(MODULE_ID);
  if ( isDebugging && this.los.shadows && this.los._drawShadows ) {
    log("drawLightLightSource has shadows");
    this.los._drawShadows();
  }
  return wrapped();
}
//
// export function createReverseShadowMaskFilter() {
// //   if ( !this.reverseShadowMaskFilter ) {
//     this.shadowsRenderTexture =
//        canvas.primary.createRenderTexture({renderFunction: this.renderShadows.bind(this), clearColor: [0, 0, 0, 0]});
//     this.reverseShadowMaskFilter = ReverseMaskFilter.create({
//       uMaskSampler: this.shadowsRenderTexture,
//       channel: "a"
//     });
//     this.reverseShadowMaskFilter.blendMode = PIXI.BLEND_MODES.NORMAL;
// //   }
//   return this.reverseShadowMaskFilter;
// }
//
// export function renderShadows(renderer) {
//   const cir = new PIXI.Circle(0, 0, 50);
//   const graphics = new PIXI.Graphics();
//   const rt = renderer.renderTexture;
//   graphics.beginFill(0, 1); // color, alpha
//   graphics.drawCircle(cir);
//   graphics.endFill;
//   renderer.render(graphics, rt);
//   return rt;
// }

// Simple version
// export function _createLOSLightSource(wrapped) {
//   const los = wrapped();
//   this.createReverseMaskFilter();
//   this.illumination.filters = [this.reverseMaskFilter];
//   this.coloration.filters = [this.reverseMaskFilter];
//   return los;
// }
//
// // Added to LightSource.prototype
// export function createReverseMaskFilter() {
//   const rt = canvas.primary.createRenderTexture({renderFunction: renderInnerCircle.bind(this), clearColor: [0, 0, 0, 0]});
//   this.reverseMaskFilter = ReverseMaskFilter.create({
//     uMaskSampler: rt,
//     channel: "a"
//   });
//   this.reverseMaskFilter.blendMode = PIXI.BLEND_MODES.NORMAL;
//   return this.reverseMaskFilter;
// }
//
// function renderInnerCircle(renderer) {
//   const cir = new PIXI.Circle(0, 0, 50);
//   const graphics = new PIXI.Graphics();
//   const rt = renderer.renderTexture;
//   graphics.beginFill(0, 1); // color, alpha
//   graphics.drawCircle(cir);
//   graphics.endFill;
//   renderer.render(graphics, rt);
//   return rt;
// }




// export function renderShadows(renderer) {
//   if ( !this.los.shadows || !this.los.shadows.length ) return;
//
//   const graphics = new PIXI.Graphics();
//   const rt = renderer.renderTexture;
//
//   for ( const shadow of this.los.shadows) {
//     graphics.beginFill(0, 1); // color, alpha
//     graphics.drawPolygon(shadow);
//     graphics.endFill;
//   }
//   renderer.render(graphics, rt);
//   return rt;
// }




//   #createReverseMaskFilter() {
//     if ( !this.reverseMaskfilter ) {
//       this.reverseMaskfilter = ReverseMaskFilter.create({
//         uMaskSampler: canvas.primary.tokensRenderTexture,
//         channel: "a"
//       });
//       this.reverseMaskfilter.blendMode = PIXI.BLEND_MODES.NORMAL;
//     }
//     return this.reverseMaskfilter;
//   }
//
//
//    this.tokensRenderTexture =
//       this.createRenderTexture({renderFunction: this._renderTokens.bind(this), clearColor: [0, 0, 0, 0]});
//
//
//
//
//
//   createRenderTexture({renderFunction, clearColor}={}) {
//     const renderOptions = {};
//     const renderer = canvas.app?.renderer;
//
//     // Creating the render texture
//     const renderTexture = PIXI.RenderTexture.create({
//       width: renderer?.screen.width ?? window.innerWidth,
//       height: renderer?.screen.height ?? window.innerHeight,
//       resolution: renderer.resolution ?? PIXI.settings.RESOLUTION
//     });
//     renderOptions.renderFunction = renderFunction;            // Binding the render function
//     renderOptions.clearColor = clearColor;                    // Saving the optional clear color
//     this.#renderPaths.set(renderTexture, renderOptions);      // Push into the render paths
//
//     // Return a reference to the render texture
//     return renderTexture;
//   }
//
//   _renderTokens(renderer) {
//     for ( const tokenMesh of this.tokens ) {
//       tokenMesh.render(renderer);
//     }
//


// Class PointSource:
/**
 * Create a new Mesh for this source using a provided shader class
 * @param {Function} shaderCls  The subclass of AdaptiveLightingShader being used for this Mesh
 * @returns {PIXI.Mesh}         The created Mesh
 * @protected
 */
//   _createMesh(shaderCls) {
//     const state = new PIXI.State();
//     const mesh = new PIXI.Mesh(this.constructor.GEOMETRY, shaderCls.create(), state);
//     mesh.mask = this.losMask;
//     Object.defineProperty(mesh, "uniforms", {get: () => mesh.shader.uniforms});
//     return mesh;
//   }

/**
 * Update the position and size of the mesh each time it is drawn.
 * @param {PIXI.Mesh} mesh      The Mesh being updated
 * @returns {PIXI.Mesh}         The updated Mesh
 * @protected
 */
// _updateMesh(mesh) {
//   mesh.position.set(this.data.x, this.data.y);
//   mesh.width = mesh.height = this.radius * 2;
//   return mesh




