/* globals
GlobalLightSource,
canvas,
PIXI
*/
"use strict";

import { log } from "./util.js";
import { ShaderPatcher, applyPatches } from "./perfect-vision/shader-patcher.js";

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

const FN_ORIENT2D =
`
return (a.y - c.y) * (b.x - c.x) - (a.x - c.x) * (b.y - c.y);
`;

/**
 * GLSL
 * Does segment AB intersect the segment CD?
 * @in {vec2} a
 * @in {vec2} b
 * @in {vec2} c
 * @in {vec2} d
 * @returns {boolean}
 */
const FN_LINE_SEGMENT_INTERSECTS =
`
  float xa = orient2d(a, b, c);
  float xb = orient2d(a, b, d);
  if ( xa == 0.0 && xb == 0.0 ) return false;

  bool xab = (xa * xb) <= 0.0;
  bool xcd = (orient2d(c, d, a) * orient2d(c, d, b)) <= 0.0;
  return xab && xcd;
`;

/**
 * GLSL
 * Point on line AB that forms perpendicular point to C
 * @in {vec2} a
 * @in {vec2} b
 * @in {vec2} c
 * @returns {vec2}
 */
const FN_PERPENDICULAR_POINT =
`
  vec2 deltaBA = b - a;

  // dab might be 0 but only if a and b are equal
  float dab = pow(deltaBA.x, 2.0) + pow(deltaBA.y, 2.0);
  vec2 deltaCA = c - a;

  float u = ((deltaCA.x * deltaBA.x) + (deltaCA.y * deltaBA.y)) / dab;
  return vec2(a.x + (u * deltaBA.x), a.y + (u * deltaBA.y));
`;

/**
 * GLSL
 * Calculate the canvas elevation given a pixel value
 * Maps 0–1 to elevation in canvas coordinates.
 * @in {float} pixel
 * @in {vec4} EV_elevationResolution
 * @returns {float}
 *
 * EV_elevationResolution:
 * - r: elevation min; g: elevation step; b: max pixel value (likely 255); a: canvas size / distance
 * - u.EV_elevationResolution = [elevationMin, elevationStep, maximumPixelValue, elevationMult];
 */
const FN_CANVAS_ELEVATION_FROM_PIXEL =
`
  return (EV_elevationResolution.r + (pixel * EV_elevationResolution.b * EV_elevationResolution.g)) * EV_elevationResolution.a;
`;


/**
 * GLSL
 * Determine if a given location from a wall is in shadow or not.
 * @in {vec4} wall
 * @in {float} wallElevation
 * @in {float} wallDistance
 * @in {vec3} sourceLocation
 * @in {vec3} pixelLocation
 * @out {float} percentDistanceFromWall
 * @returns {boolean} True if location is in shadow of this wall
 */
const FN_LOCATION_IN_WALL_SHADOW =
`
  percentDistanceFromWall = 0.0; // Set a default value when returning early.

  // If the wall is higher than the light, skip. Should not occur.
  if ( sourceLocation.z <= wallElevation ) return false;

  // If the pixel is above the wall, skip.
  if ( pixelLocation.z >= wallElevation ) return false;

  // If the wall does not intersect the line between the center and this point, no shadow here.
  if ( !lineSegmentIntersects(pixelLocation.xy, sourceLocation.xy, wall.xy, wall.zw) ) return false;

  // Distance from wall (as line) to this location
  vec2 wallIxPoint = perpendicularPoint(wall.xy, wall.zw, pixelLocation.xy);
  float distWP = distance(pixelLocation.xy, wallIxPoint);

  // atan(opp/adj) equivalent to JS Math.atan(opp/adj)
  // atan(y, x) equivalent to JS Math.atan2(y, x)
  float adjWe = wallElevation - pixelLocation.z;
  float adjSourceElevation = sourceLocation.z - pixelLocation.z;
  float theta = atan((adjSourceElevation - adjWe) /  wallDistance);

  // Distance from center/origin to furthest part of shadow perpendicular to wall
  float distOV = adjSourceElevation / tan(theta);
  float maxDistWP = distOV - wallDistance;

  if ( distWP < maxDistWP ) {
    // Current location is within shadow of the wall
    percentDistanceFromWall = distWP / maxDistWP;
    return true;
  }
  return false;
`;

/**
 * GLSL
 * Determine the relative orientation of three points in two-dimensional space.
 * The result is also an approximation of twice the signed area of the triangle defined by the three points.
 * This method is fast - but not robust against issues of floating point precision. Best used with integer coordinates.
 * Same as Foundry utils version
 * @in {vec2} a An endpoint of segment AB, relative to which point C is tested
 * @in {vec2} b An endpoint of segment AB, relative to which point C is tested
 * @in {vec2} c A point that is tested relative to segment AB
 * @returns {float} The relative orientation of points A, B, and C
 *                  A positive value if the points are in counter-clockwise order (C lies to the left of AB)
 *                  A negative value if the points are in clockwise order (C lies to the right of AB)
 *                  Zero if the points A, B, and C are collinear.
 */
export const FRAGMENT_FUNCTIONS = `
float orient2d(in vec2 a, in vec2 b, in vec2 c) {
  ${FN_ORIENT2D}
}

// Does segment AB intersect the segment CD?
bool lineSegmentIntersects(in vec2 a, in vec2 b, in vec2 c, in vec2 d) {
  ${FN_LINE_SEGMENT_INTERSECTS}
}

// Point on line AB that forms perpendicular point to C
vec2 perpendicularPoint(in vec2 a, in vec2 b, in vec2 c) {
  ${FN_PERPENDICULAR_POINT}
}

// Calculate the canvas elevation given a pixel value
// Maps 0–1 to elevation in canvas coordinates.
// EV_elevationResolution:
// r: elevation min; g: elevation step; b: max pixel value (likely 255); a: canvas size / distance
float canvasElevationFromPixel(in float pixel, in vec4 EV_elevationResolution) {
  ${FN_CANVAS_ELEVATION_FROM_PIXEL}
}

// Determine if a given location from a wall is in shadow or not.
bool locationInWallShadow(
  in vec4 wall,
  in float wallElevation,
  in float wallDistance, // distance from source location to wall
  in float sourceElevation,
  in vec2 sourceLocation,
  in float pixelElevation,
  in vec2 pixelLocation,
  out float percentDistanceFromWall) {

  ${FN_LOCATION_IN_WALL_SHADOW}
}
`;

const DEPTH_CALCULATION =
`
float depth = smoothstep(0.0, 1.0, vDepth);
vec4 backgroundElevation = vec4(0.0, 0.0, 0.0, 1.0);
int wallsToProcess = EV_numWalls;
vec2 EV_textureCoord = EV_transform.xy * vUvs + EV_transform.zw;
backgroundElevation = texture2D(EV_elevationSampler, EV_textureCoord);

float percentDistanceFromWall;
float pixelElevation = canvasElevationFromPixel(backgroundElevation.r, EV_elevationResolution);
if ( pixelElevation > EV_lightElevation ) {
  // If elevation at this point is above the light, then light cannot hit this pixel.
  depth = 0.0;
  wallsToProcess = 0;
  inShadow = EV_isVision;
}

vec3 sourceLoc = vec3(0.5, 0.5, EV_lightElevation);
vec3 pixelLoc = vec3(vUvs.x, vUvs.y, pixelElevation);

for ( int i = 0; i < MAX_NUM_WALLS; i++ ) {
  if ( i >= wallsToProcess ) break;

  bool thisWallInShadow = locationInWallShadow(
    EV_wallCoords[i],
    EV_wallElevations[i],
    EV_wallDistances[i],
    sourceLoc,
    pixelLoc,
    percentDistanceFromWall
  );

  if ( thisWallInShadow ) {
    // Current location is within shadow of the wall
    // Don't break out of loop; could be more than one wall casting shadow on this point.
    // For now, use the closest shadow for depth.
    inShadow = true;
    depth = min(depth, percentDistanceFromWall);
  }
}
`;

const FRAG_COLOR =
`
  if ( EV_isVision && inShadow ) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
`;

function addShadowCode(source) {
  try {
    source = new ShaderPatcher("frag")
      .setSource(source)

      .addUniform("EV_numWalls", "int")
      .addUniform("EV_wallCoords[MAX_NUM_WALLS]", "vec4")
      .addUniform("EV_wallElevations[MAX_NUM_WALLS]", "float")
      .addUniform("EV_wallDistances[MAX_NUM_WALLS]", "float")
      .addUniform("EV_lightElevation", "float")
      .addUniform("EV_isVision", "bool")
      .addUniform("EV_elevationSampler", "sampler2D")
      .addUniform("EV_transform", "vec4")
      .addUniform("EV_elevationResolution", "vec4")
      .addUniform("EV_hasElevationSampler", "bool")

      // Functions must be in reverse-order of dependency.
      .addFunction("locationInWallShadow", "bool", FN_LOCATION_IN_WALL_SHADOW, [
        { qualifier: "in", type: "vec4", name: "wall" },
        { qualifier: "in", type: "float", name: "wallElevation" },
        { qualifier: "in", type: "float", name: "wallDistance" },
        { qualifier: "in", type: "vec3", name: "sourceLocation" },
        { qualifier: "in", type: "vec3", name: "pixelLocation" },
        { qualifier: "out", type: "float", name: "percentDistanceFromWall" }
      ])
      .addFunction("canvasElevationFromPixel", "float", FN_CANVAS_ELEVATION_FROM_PIXEL, [
        { qualifier: "in", type: "float", name: "pixel" },
        { qualifier: "in", type: "vec4", name: "EV_elevationResolution" }
      ])
      .addFunction("perpendicularPoint", "vec2", FN_PERPENDICULAR_POINT, [
        { qualifier: "in", type: "vec2", name: "a" },
        { qualifier: "in", type: "vec2", name: "b" },
        { qualifier: "in", type: "vec2", name: "c" }
      ])
      .addFunction("lineSegmentIntersects", "bool", FN_LINE_SEGMENT_INTERSECTS, [
        { qualifier: "in", type: "vec2", name: "a" },
        { qualifier: "in", type: "vec2", name: "b" },
        { qualifier: "in", type: "vec2", name: "c" },
        { qualifier: "in", type: "vec2", name: "d" }
      ])
      .addFunction("orient2d", "float", FN_ORIENT2D, [
        { qualifier: "in", type: "vec2", name: "a" },
        { qualifier: "in", type: "vec2", name: "b" },
        { qualifier: "in", type: "vec2", name: "c" }
      ])

      // Add variable that can be seen by wrapped main
      .addGlobal("inShadow", "bool", "false")

      // Add define after so it appears near the top
      .prependBlock(`#define MAX_NUM_WALLS ${MAX_NUM_WALLS}`)

      .replace(/float depth = smoothstep[(]0.0, 1.0, vDepth[)];/, DEPTH_CALCULATION)

      .wrapMain(`\
        void main() {
          @main();

          ${FRAG_COLOR}
        }

      `)

      .getSource();

  } finally {
    return source;
  }

}

/**
 * Wrap AdaptiveLightShader.prototype.create
 * Modify the code to add shadow depth based on background elevation and walls
 * Add uniforms used by the fragment shader to draw shadows in the color and illumination shaders.
 */
export function createAdaptiveLightingShader(wrapped, ...args) {
  log("createAdaptiveLightingShaderPV");

  applyPatches(this,
    false,
    source => {
      source = addShadowCode(source);
      return source;
    });

  const shader = wrapped(...args);
  shader.uniforms.EV_numWalls = 0;
  shader.uniforms.EV_wallElevations = new Float32Array(MAX_NUM_WALLS);
  shader.uniforms.EV_wallCoords = new Float32Array(MAX_NUM_WALLS*4);
  shader.uniforms.EV_lightElevation = 0.5;
  shader.uniforms.EV_wallDistances = new Float32Array(MAX_NUM_WALLS);
  shader.uniforms.EV_isVision = false;
  shader.uniforms.EV_elevationSampler = canvas.elevation._elevationTexture ?? PIXI.Texture.EMPTY;

  shader.uniforms.EV_transform = [1, 1, 1, 1];
  shader.uniforms.EV_hasElevationSampler = false;

  // [min, step, maxPixelValue ]
  shader.uniforms.EV_elevationResolution = [0, 1, 255, 1];

  return shader;
}

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
applies. That can be simplified by just shifting the elevations of the above diagram.
So Oe becomes Oe - pixelE. We = We - pixelE.
*/

/**
 * Wrap LightSource.prototype._updateColorationUniforms.
 * Add uniforms needed for the shadow fragment shader.
 */
export function _updateColorationUniformsLightSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;
  this._updateEVLightUniforms(this.coloration);
}

/**
 * Wrap LightSource.prototype._updateIlluminationUniforms.
 * Add uniforms needed for the shadow fragment shader.
 */
export function _updateIlluminationUniformsLightSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;
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

  const walls = this.los.wallPointsBelowSource || [];

  const center = {x, y};
  const r_inv = 1 / radius;

  // Radius is .5 in the shader coordinates; adjust elevation accordingly
  const u = shader.uniforms;
  u.EV_lightElevation = elevationZ * 0.5 * r_inv;

  const center_shader = {x: 0.5, y: 0.5};
  let wallCoords = [];
  let wallElevations = [];
  let wallDistances = [];

  for ( const w of walls ) {
    const a = pointCircleCoord(w.A.top, radius, center, r_inv);
    const b = pointCircleCoord(w.B.top, radius, center, r_inv);

    // Point where line from light, perpendicular to wall, intersects
    const wallIx = CONFIG.GeometryLib.utils.perpendicularPoint(a, b, center_shader);
    if ( !wallIx ) continue; // Likely a and b not proper wall
    const wallOriginDist = PIXI.Point.distanceBetween(center_shader, wallIx);
    wallDistances.push(wallOriginDist);
    wallElevations.push(w.A.top.z * 0.5 * r_inv);

    wallCoords.push(a.x, a.y, b.x, b.y);
  }

  u.EV_numWalls = wallElevations.length;

  if ( !wallCoords.length ) wallCoords = new Float32Array(MAX_NUM_WALLS*4);
  if ( !wallElevations.length ) wallElevations = new Float32Array(MAX_NUM_WALLS);
  if ( !wallDistances.length ) wallDistances = new Float32Array(MAX_NUM_WALLS);

  u.EV_wallCoords = wallCoords;
  u.EV_wallElevations = wallElevations;
  u.EV_wallDistances = wallDistances;
  u.EV_elevationSampler = canvas.elevation?._elevationTexture;

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

  /*
  Elevation of a given pixel from the texture value:
  texture value in the shader is between 0 and 1. Represents value / maximumPixelValue where
  maximumPixelValue is currently 255.

  To get to elevation in the light vUvs space:
  elevationCanvasUnits = (((value * maximumPixelValue * elevationStep) - elevationMin) * size) / distance;
  elevationLightUnits = elevationCanvasUnits * 0.5 * r_inv;
  = (((value * maximumPixelValue * elevationStep) - elevationMin) * size) * inv_distance * 0.5 * r_inv;
  */

  // [min, step, maxPixelValue ]
  if ( !u.EV_elevationSampler ) {
    u.EV_elevationSampler = PIXI.Texture.EMPTY;
    u.EV_hasElevationSampler = false;
  } else {
    const { elevationMin, elevationStep, maximumPixelValue} = canvas.elevation;
    const { distance, size } = canvas.scene.grid;
    const elevationMult = size * (1 / distance) * 0.5 * r_inv;
    u.EV_elevationResolution = [elevationMin, elevationStep, maximumPixelValue, elevationMult];
    u.EV_hasElevationSampler = true;
  }
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
export function pointCircleCoord(point, r, center, r_inv = 1 / r) {
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
export function _createPolygonLightSource(wrapped) {
  const los = wrapped();

  // TO-DO: Only reset uniforms if:
  // 1. there are shadows
  // 2. there were previously shadows but are now none

  this._resetUniforms.illumination = true;
  this._resetUniforms.coloration = true;

  return los;
}
