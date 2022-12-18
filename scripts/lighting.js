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
const MAX_NUM_WALLS = 200; // Now actually number of wall endpoints, where each wall has 2

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
 * Adapted from https://github.com/mourner/robust-predicates/blob/main/src/orient3d.js
 * @in {vec3} a   Point in the plane
 * @in {vec3} b   Point in the plane
 * @in {vec3} c   Point in the plane
 * @in {vec3} d   Point to test
 * @out {float}
 *   - Returns a positive value if the point d lies above the plane passing through a, b, and c,
 *     meaning that a, b, and c appear in counterclockwise order when viewed from d.
 *   - Returns a negative value if d lies below the plane.
 *   - Returns zero if the points are coplanar.
 */
const FN_ORIENT3D =
`
  vec3 ad = a - d;
  vec3 bd = b - d;
  vec3 cd = c - d;

  return (ad.x * ((bd.y * cd.z) - (bd.z * cd.y)))
    + (bd.x * ((cd.y * ad.z) - (cd.z * ad.y)))
    + (cd.x * ((ad.y * bd.z) - (ad.z * bd.y)));
`;

/**
 * GLSL
 * Quickly test whether the line segment AB intersects with a plane.
 * This method does not determine the point of intersection, for that use lineLineIntersection.
 * Each Point3d should have {x, y, z} coordinates.
 *
 * @in {vec3} a   The first endpoint of segment AB
 * @in {vec3} b   The second endpoint of segment AB
 * @in {vec3} c   The first point defining the plane
 * @in {vec3} d   The second point defining the plane
 * @in {vec3} e   The third point defining the plane.
 *
 * @out {bool} Does the line segment intersect the plane?
 * Note that if the segment is part of the plane, this returns false.
 */
const FN_PLANE_LINE_SEGMENT_INTERSECTS =
`
  float xa = orient3d(a, c, d, e);
  float xb = orient3d(b, c, d, e);
  return (xa * xb) <= 0.0;
`;

/**
 * GLSL
 * Line segment-plane intersection
 * @in {vec3} a  First point on plane
 * @in {vec3} b  Second point on plane
 * @in {vec3} c  Third point on plane
 * @in {vec3} p0   First endpoint of line segment
 * @in {vec3} p1   Second endpoint of line segment
 * @inout {bool} intersects  Does the line intersect the plane?
 * @out {vec3}
 */
const FN_PLANE_LINE_INTERSECTION =
`
  vec3 vAB = b - a;
  vec3 vAC = c - a;
  vec3 n = normalize(cross(vAB, vAC));
  vec3 vLine = p1 - p0;

  float dotNL = dot(n, vLine);
  if ( dotNL == 0.0 ) {
    intersects = false;
    return vec3(0.0);
  }

  intersects = true;

  vec3 w = p0 - a;
  float fac = dot(-n, w) / dotNL;
  vec3 u = vLine * fac;
  return p0 + u;
`;

/**
 * GLSL
 * Matrix to project points onto plane as a shadow
 * // http://www.it.hiof.no/~borres/j3d/explain/shadow/p-shadow.html
 * Same as Shadow._calculateShadowMatrix
 * @in {vec3} p0  First point on plane
 * @in {vec3} p1  Second point on plane
 * @in {vec3} p2  Third point on plane
 * @in {vec3} s   The viewer origin(light, vision, etc.)
 * @out {mat4}
 */
const FN_CALCULATE_SHADOW_MATRIX =
`
  // First, get the plane equation
  vec3 vAB = b - a;
  vec3 vAC = c - a;
  vec3 n = normalize(cross(vAB, vAC));
  vec4 P = vec4(n.xyz, -dot(n, a));

  float dot = dot(P.xyz, s.xyz) + P.w

  // Defined by columns
  return mat4(
    dot - (s.x * P.x), -(s.x * P.y), -(s.x * P.z), -(s.x * P.w), // First column
    -(s.y * P.x), dot - (s.y * P.y), -(s.y * P.z), -(s.y * P.w), // Second column
    -(s.z * P.x), -(s.z * P.y), dot - (s.z * P.z), -(s.z * P.w), // Third column
    -P.x, -P.y, -P.z, dot - P.w
  );
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
 * @in {vec3} wallTL
 * @in {vec3} wallBR
 * @in {vec3} sourceLocation
 * @in {vec3} pixelLocation
 * @out {boolean} True if location is in shadow of this wall
 */

/* Methodology:
A point is in shadow if the line between it and the source intersects:
- Any wall or
- 2 terrain walls.

Note: Must ensure that the intersection point lies between the source and the point.

Moving from the point toward the source, the first wall (or 2nd terrain wall) is "blocking."
The distance from the blocking wall to the point is the distance from the wall.
The furthest shadow point is the part of the shadow furthest from the wall.
Percent distance is how far a given point is from the wall, divided by the maximum distance
it could be if it were at the edge of the shadow.
*/
const FN_LOCATION_IN_WALL_SHADOW =
`
  // If the wall is higher than the light, skip. Should not occur.
  if ( sourceLocation.z <= wallBR.z ) return false;

  // If the pixel is above the wall, skip.
  if ( pixelLocation.z >= wallTL.z ) return false;

  vec3 Atop = wallTL;
  vec3 Abottom = vec3(wallTL.xy, wallBR.z);
  vec3 Btop = vec3(wallBR.xy, wallTL.z);
  vec3 Bbottom = wallBR;

  // If point and source on same side of plane, then no intersection
  if ( !planeLineSegmentIntersects(sourceLocation, pixelLocation, Atop, Abottom, Btop) ) {
    return false;
  }

  // Locate the intersection point with this wall.
  bool ixIntersects = false;
  vec3 ix = planeLineIntersection(Atop, Abottom, Btop, sourceLocation, pixelLocation, ixIntersects);
  if ( !ixIntersects ) return false; // Just in case

  // Confirm the intersection is within the wall bounds.
  // Because walls are vertical rectangles, first do an easy check that ix is within height
  if ( ix.z < Bbottom.z || ix.z > Btop.z ) return false;

  // check that ix.xy is within the line segment XY of the wall
  // See https://lucidar.me/en/mathematics/check-if-a-point-belongs-on-a-line-segment
  vec2 vAB = Btop.xy - Atop.xy;
  vec2 vAC = ix.xy - Atop.xy;

  float dotABAC = dot(vAB, vAC);
  float dotABAB = dot(vAB, vAB);
  if ( dotABAC < 0.0 || dotABAC > dotABAB ) return false;

  return true;
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
  in vec3 wallA,
  in vec3 wallB,
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
int numWallEndpoints = EV_numWalls * 2;
int numHeightWallEndpoints = (EV_numWalls - EV_numTerrainWalls) * 2;
vec2 EV_textureCoord = EV_transform.xy * vUvs + EV_transform.zw;
backgroundElevation = texture2D(EV_elevationSampler, EV_textureCoord);

float pixelElevation = canvasElevationFromPixel(backgroundElevation.r, EV_elevationResolution);
if ( pixelElevation > EV_lightElevation ) {
  // If elevation at this point is above the light, then light cannot hit this pixel.
  depth = 0.0;
  numWallEndpoints = 0;
  inShadow = EV_isVision; // inShadow is a global
}

vec3 sourceLoc = vec3(0.5, 0.5, EV_lightElevation);
vec3 pixelLoc = vec3(vUvs.x, vUvs.y, pixelElevation);

for ( int i = 0; i < MAX_NUM_WALLS; i += 2 ) {
  if ( i >= numWallEndpoints ) break;

  vec3 wallTL = EV_wallCoords[i];
  vec3 wallBR = EV_wallCoords[i + 1];

  bool thisWallShadows = locationInWallShadow(
    wallTL,
    wallBR,
    sourceLoc,
    pixelLoc
  );

//   if ( distance(pixelLoc.xy, wallBR.xy) < 0.1 && thisWallShadows ) {
//     inShadow = true;
//     break;
//   }

  if ( !thisWallShadows ) continue;

  bool isTerrainWall = i >= numHeightWallEndpoints;



  if ( isTerrainWall ) {
    // Check each terrain wall for a shadow.
    // We can ignore the height walls, b/c shadows from height wall --> terrain wall --> pt
    // are covered by the height wall.
    thisWallShadows = false; // Assume none shadow until proven otherwise

    for ( int j = 0; j < MAX_NUM_WALLS; j += 2 ) {
      if ( j >= numWallEndpoints ) break;
      if ( j < numHeightWallEndpoints ) continue;
      vec3 terrainTL = EV_wallCoords[j];
      vec3 terrainBR = EV_wallCoords[j + 1];

      if ( terrainTL == wallTL && terrainBR == wallBR ) continue;

      bool thisSecondaryWallShadows = locationInWallShadow(
        terrainTL,
        terrainBR,
        sourceLoc,
        pixelLoc
      );

      if ( thisSecondaryWallShadows ) {
        thisWallShadows = true;
        break;
      }
    }
  }

  if ( thisWallShadows ) {
    inShadow = true;
    break;
  }
}

if ( inShadow ) {
  depth = min(depth, 0.1);
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
      .addUniform("EV_numTerrainWalls", "int")
      .addUniform("EV_wallCoords[MAX_NUM_WALLS]", "vec3")
      .addUniform("EV_lightElevation", "float")
      .addUniform("EV_isVision", "bool")
      .addUniform("EV_elevationSampler", "sampler2D")
      .addUniform("EV_transform", "vec4")
      .addUniform("EV_elevationResolution", "vec4")
      .addUniform("EV_hasElevationSampler", "bool")

      // Functions must be in reverse-order of dependency.
      .addFunction("locationInWallShadow", "bool", FN_LOCATION_IN_WALL_SHADOW, [
        { qualifier: "in", type: "vec3", name: "wallTL" },
        { qualifier: "in", type: "vec3", name: "wallBR" },
        { qualifier: "in", type: "vec3", name: "sourceLocation" },
        { qualifier: "in", type: "vec3", name: "pixelLocation" }
      ])
      .addFunction("planeLineIntersection", "vec3", FN_PLANE_LINE_INTERSECTION, [
        { qualifier: "in", type: "vec3", name: "a" },
        { qualifier: "in", type: "vec3", name: "b" },
        { qualifier: "in", type: "vec3", name: "c" },
        { qualifier: "in", type: "vec3", name: "p0" },
        { qualifier: "in", type: "vec3", name: "p1" },
        { qualifier: "out", type: "bool", name: "intersects" }
      ])
      .addFunction("planeLineSegmentIntersects", "bool", FN_PLANE_LINE_SEGMENT_INTERSECTS, [
        { qualifier: "in", type: "vec3", name: "a" },
        { qualifier: "in", type: "vec3", name: "b" },
        { qualifier: "in", type: "vec3", name: "c" },
        { qualifier: "in", type: "vec3", name: "d" },
        { qualifier: "in", type: "vec3", name: "e" }
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
      .addFunction("orient3d", "float", FN_ORIENT3D, [
        { qualifier: "in", type: "vec3", name: "a" },
        { qualifier: "in", type: "vec3", name: "b" },
        { qualifier: "in", type: "vec3", name: "c" },
        { qualifier: "in", type: "vec3", name: "d" }
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
  shader.uniforms.EV_numTerrainWalls = 0;
  shader.uniforms.EV_wallCoords = new Float32Array(MAX_NUM_WALLS*6);
  shader.uniforms.EV_lightElevation = 0.5;
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

  const terrainWallPointsArr = this.los._elevatedvision?.terrainWallPointsArr ?? [];
  const heightWallPointsArr = this.los._elevatedvision?.heightWallPointsArr ?? [];

  const center = {x, y};
  const r_inv = 1 / radius;

  // Radius is .5 in the shader coordinates; adjust elevation accordingly
  const u = shader.uniforms;
  u.EV_lightElevation = elevationZ * 0.5 * r_inv;

  let wallCoords = [];

  // Important: height walls go first!
  // (b/c the shader may never need to test terrain walls for some points)
  const wallPointsArr = [...heightWallPointsArr, ...terrainWallPointsArr];
  for ( const wallPoints of wallPointsArr ) {
    // Because walls are rectangular, we can pass the top-left and bottom-right corners
    const tl = pointCircleCoord(wallPoints.A.top, radius, center, r_inv);
    const br = pointCircleCoord(wallPoints.B.bottom, radius, center, r_inv);

    wallCoords.push(
      tl.x, tl.y, tl.z,
      br.x, br.y, br.z
    );
  }

  u.EV_numWalls = wallPointsArr.length;
  u.EV_numTerrainWalls = terrainWallPointsArr.length;

  if ( !wallCoords.length ) wallCoords = new Float32Array(MAX_NUM_WALLS*6);

  u.EV_wallCoords = wallCoords;
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
export function pointCircleCoord(point, r, center = {}, r_inv = 1 / r) {

  return {
    x: circleCoord(point.x, r, center.x, r_inv),
    y: circleCoord(point.y, r, center.y, r_inv),
    z: point.z * 0.5 * r_inv
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
