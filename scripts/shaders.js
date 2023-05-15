/* globals
CONFIG,
PIXI
*/
"use strict";

import { MODULE_ID } from "./const.js";

export const PLACEABLE_TYPES = {
  WALL: 0,
  TERRAIN_WALL: 1,
  TILE: 2,
  TRANSPARENT_TILE: 3
};

/** Basic approach

(Assume light is at the top, fragment is at the bottom)
  --********--   tile: z = 0.1
------           terrain1: z = 0.2
   ------------- terrain2: z = 0.3


Phase I:
  ------------   tile
--               terrain1
              -- terrain2
2211111111111133 depth

Phase II:
  ------------   tile
xx               terrain1
              xx terrain2
9911111111111199

Phase III:
  --xxxxxxxx--  tile
    --          terrain1
      ------    terrain2
9911223333331199

Would require cycling through all tiles and terrain walls as many times as there are tiles + 1.

Simpler version:
Tiles are set in elevation. A light must be above the tile to count.
Tiles at same elevation cannot overlap (let's assume!) (If they did, could merge them...)
Could also render all tiles on the same elevation to a texture...

So sort tiles from highest to lowest. Check terrain walls every time a tile is checked.

If no tiles --> run the basic terrain wall.
If tiles --> skip basic terrain wall, run tiles

Do we need a final run with just terrain walls after tiles are completed?

*/


export const terrainFrontShaderGLSL = {};
terrainFrontShaderGLSL.vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

uniform mat4 uProjectionM;
uniform mat4 uViewM;
in vec3 aVertexPosition;
in float aObjType;
out float vObjType;

void main() {
  vObjType = aObjType;
  vec4 pos4 = vec4(aVertexPosition, 1.0);
  gl_Position = uProjectionM * uViewM * pos4;
}`;

terrainFrontShaderGLSL.fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;

#define TERRAIN_WALL ${PLACEABLE_TYPES.TERRAIN_WALL.toFixed(1)}

in float vObjType;
out float terrainDepth;

void main() {
  // gl_FragCoord.x: [0, texture width (e.g., 1024)]
  // gl_FragCoord.y: [0, texture height (e.g., 1024)]
  // gl_FragCoord.z: [0, 1]

  float depth = gl_FragCoord.z; // [0, 1]
  terrainDepth = vObjType == TERRAIN_WALL ? depth : 1.0;
}`;


/**
 * Project each object (currently walls and tiles) from point of view of the light.
 * Update the depth buffer with the object z values from that point of view.
 * @param {number} numTileTextures    Number of tile textures passed to the shader.
 *   Transparent tiles must let depth through, which means referencing the underlying texture.
 * https://webglfundamentals.org/webgl/lessons/webgl-qna-how-to-bind-an-array-of-textures-to-a-webgl-shader-uniform-.html
 * @returns {object} {fragmentShader, vertexShader}
 */
export const depthShaderGLSL = {};
/**
 * Vertex shader.
 * Convert wall and tile objects to point of view of the light.
 * @uniform {mat4} uProjectionM         Perspective or orthogonal projection matrix
 * @uniform {mat4} uViewM               View matrix from point of view of the light
 * @attribute {vec3} aVertexPosition    Vertices (corners) of the wall or tile
 */
depthShaderGLSL.vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

uniform mat4 uProjectionM;
uniform mat4 uViewM;
in vec3 aVertexPosition;

void main() {
  vec4 pos4 = vec4(aVertexPosition, 1.0);
  gl_Position = uProjectionM * uViewM * pos4;
}`;

/**
 * Fragment shader.
 * Update the depth buffer and render the depth values.
 * @output {float} distance   Depth value between 0 and 1.
 */
depthShaderGLSL.fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;

out float depth;

void main() {
  // gl_FragCoord.x: [0, texture width (e.g., 1024)]
  // gl_FragCoord.y: [0, texture height (e.g., 1024)]
  // gl_FragCoord.z: [0, 1]

  depth = gl_FragCoord.z; // [0, 1]
}`;


/**
 * Mark transparent portions of terrain walls by setting them to 1.0 in the depth buffer.
 * Relies on first running depthShader to set depths based on the light's point of view.
 */
export const terrainWallDepthShaderGLSL = {};
/**
 * Vertex shader.
 * Convert wall and tile objects to point of view of the light.
 * @uniform {mat4} uProjectionM         Perspective or orthogonal projection matrix
 * @uniform {mat4} uViewM               View matrix from point of view of the light
 * @attribute {vec3} aVertexPosition    Vertices (corners) of the wall or tile
 * @attribute {float} aObjType          Type of object this vertex belongs to. See PLACEABLE_TYPES.
 * @output {float} vObjType             Conversion of aObjType to varying.
 */
terrainWallDepthShaderGLSL.vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

uniform mat4 uProjectionM;
uniform mat4 uViewM;
in vec3 aVertexPosition;
in float aObjType;
out float vObjType;

void main() {
  vObjType = aObjType;
  gl_Position = uProjectionM * uViewM * vec4(aVertexPosition, 1.0);
}`;


/**
 * Fragment shader.
 * Test terrain wall fragments against the saved depth texture. Mark the frontmost
 * terrain wall fragments as depth = 1.0 to make "transparent."
 * @uniform {sampler2D} depthMap  Saved depth values, usually from running depthShaderGLSL.
 * @input {float} vObjType        Type of wall for this fragment. See PLACEABLE_TYPES.
 * @output {float} distance   Depth value between 0 and 1.
 */
terrainWallDepthShaderGLSL.fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;

#define TERRAIN_WALL ${PLACEABLE_TYPES.TERRAIN_WALL.toFixed(1)}

uniform sampler2D depthMap;
uniform sampler2D terrainDepthMap;
in float vObjType;
out float depth;

void main() {
  float fragDepth = gl_FragCoord.z;
  ivec2 fragCoord = ivec2(gl_FragCoord.xy);
  float nearestDepth = texelFetch(depthMap, fragCoord, 0).r;

  if ( fragDepth < nearestDepth ) {
    // Already handled this layer previously.
    depth = 1.0;

  } else if ( vObjType == TERRAIN_WALL && nearestDepth == fragDepth ) {
    // Frontmost terrain wall fragment?
    float frontmostTerrainDepth = texelFetch(terrainDepthMap, fragCoord, 0).r;
    depth = frontmostTerrainDepth == fragDepth ? 1.0 : fragDepth;

  } else {
    depth = fragDepth;
  }

  // depth = nearestDepth - fragDepth; // nearest depth is always equal to or greater than frag depth

}`;


/**
 * For a given tile, compare its texture and mark as "transparent" (depth = 1)
 * any transparent portions of the tile, from point of view of the light.
 * Relies on first running depthShader to set depths based on the light's point of view.
 * May be run repeatedly for distinct tiles.
 * Function so that CONFIG[MODULE_ID].alphaThreshold works.
 */
export function tileDepthShaderGLSL() {
  const tileDepthShaderGLSL = {};

/**
 * Vertex shader.
 * Convert vertices to light's point of view. Modify the tex coordinate for the tile accordingly.
 * @uniform {mat4} uProjectionM         Perspective or orthogonal projection matrix
 * @uniform {mat4} uViewM               View matrix from point of view of the light
 * @attribute {vec3} aVertexPosition    Vertices (corners) of the wall or tile
 * @attribute {float} aObjType          Type of object this vertex belongs to; see PLACEABLE_TYPES
 * @attribute {vec2} aTexCoord          Texture location associated with the vertex
 * @output {float} vObjType             Conversion of aObjType to varying
 * @output {vec2} vTexCoord             Conversion of aTexCoord to varying
 */
tileDepthShaderGLSL.vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

uniform mat4 uProjectionM;
uniform mat4 uViewM;
in vec3 aVertexPosition;
in float aObjType;
in float aObjIndex;
in vec2 aTexCoord;
out float vObjType;
out float vObjIndex;
out vec2 vTexCoord;

void main() {
  vTexCoord = aTexCoord;
  vObjType = aObjType;
  vObjIndex = aObjIndex;
  gl_Position = uProjectionM * uViewM * vec4(aVertexPosition, 1.0);
}`;

/**
 * Fragment shader.
 * Look up the tile texture color at this location. If it meets the transparency threshold,
 * mark as transparent in the depth buffer. Render the updated depth values.
 * Also test terrain walls, in case the walls were behind the transparent portion of the tile.
 * This is set up to handle a single tile texture, to be run repeatedly.
 * To run repeatedly, tiles must be first sorted from high to low elevation.
 * @uniform {sampler2D} depthMap  Saved depth values, usually from running depthShaderGLSL
 * @uniform {int} uTileIndex      The placeable object index for the tile.
 * @input {float} vObjType        Type of placeable for this fragment; see PLACEABLE_TYPES
 * @input {vec2} vTexCoord        Texture location associated with the fragment
 * @output {float} distance       Depth value between 0 and 1.
 */
tileDepthShaderGLSL.fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;

#define ALPHA_THRESHOLD ${CONFIG[MODULE_ID].alphaThreshold.toFixed(1)}
#define TRANSPARENT_TILE ${PLACEABLE_TYPES.TRANSPARENT_TILE.toFixed(1)}
#define TERRAIN_WALL ${PLACEABLE_TYPES.TERRAIN_WALL.toFixed(1)}

uniform sampler2D depthMap;
uniform sampler2D uTileTexture;
uniform sampler2D terrainDepthMap;
uniform int uTileIndex;
in float vObjType;
in float vObjIndex;
in vec2 vTexCoord;
out float depth;

void main() {
  float fragDepth = gl_FragCoord.z;
  ivec2 fragCoord = ivec2(gl_FragCoord.xy);
  float nearestDepth = texelFetch(depthMap, fragCoord, 0).r;

  // Order matters here!
  if ( fragDepth < nearestDepth ) {
    // Already handled this layer previously.
    depth = 1.0;

  } else if ( vObjType == TERRAIN_WALL && nearestDepth == fragDepth ) {
    // Frontmost terrain wall fragment?
    float frontmostTerrainDepth = texelFetch(terrainDepthMap, fragCoord, 0).r;
    depth = frontmostTerrainDepth == fragDepth ? 1.0 : fragDepth;

  } else if ( vObjIndex == float(uTileIndex) && nearestDepth >= fragDepth ) {
    // Locate tile texture for this fragment; test for transparency.
    float alpha = texture(uTileTexture, vTexCoord).a;
    depth = alpha < ALPHA_THRESHOLD ? 1.0 : fragDepth;

  } else {
    depth = fragDepth;
  }
}`;

  return tileDepthShaderGLSL;
}

/**
 * Write the placeable index for the object that shadows.
 */
export const placeableIndicesShaderGLSL = {};

/**
 * Vertex shader.
 * Track the placeable object index associated with this vertex.
 * @uniform {mat4} uProjectionM         Perspective or orthogonal projection matrix
 * @uniform {mat4} uViewM               View matrix from point of view of the light
 * @attribute {vec3} aVertexPosition    Vertices (corners) of the wall or tile
 * @attribute {float} aObjIndex         Index for the placeable object.
 * @output {float} vObjIndex           Conversion of aObjIndex to varying.
 */
placeableIndicesShaderGLSL.vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

uniform mat4 uProjectionM;
uniform mat4 uViewM;
in vec3 aVertexPosition;
in float aObjIndex;
out float vObjIndex;

void main() {
  vObjIndex = aObjIndex;
  gl_Position = uProjectionM * uViewM * vec4(aVertexPosition, 1.0);
}`;

/**
 * Fragment shader.
 * If this is the frontmost fragment according to the buffer, render its index.
 * Presumes depth testing is working and the depth buffer has been updated.
 * @uniform {sampler2D} depthMap  Saved depth values, usually from running depthShaderGLSL.
 * @input {float} vObjIndex       Index of placeable for this fragment
 * @output {float} objIndex       Index of placeable
 */
placeableIndicesShaderGLSL.fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;

uniform sampler2D depthMap;
in float vObjIndex;
out float objIndex;

void main() {
  float fragDepth = gl_FragCoord.z;
  ivec2 fragCoord = ivec2(gl_FragCoord.xy);
  float nearestDepth = texelFetch(depthMap, fragCoord, 0).r;

  if ( fragDepth != nearestDepth ) objIndex = -1.0;
  else objIndex = vObjIndex;
}`;

/**
 * For debugging
 * Render the placeable indices, using a distinct color for each.
 */
export const placeableIndicesRenderGLSL = {};
placeableIndicesRenderGLSL.vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

uniform mat4 uProjectionM;
uniform mat4 uViewM;
in vec3 aVertexPosition;

void main() {
  gl_Position = uProjectionM * uViewM * vec4(aVertexPosition, 1.0);
}`;

placeableIndicesRenderGLSL.fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;

uniform sampler2D indicesMap;
out vec4 color;

void main() {
  ivec2 fragCoord = ivec2(gl_FragCoord.xy);
  float index = texelFetch(indicesMap, fragCoord, 0).r;

  if ( index == -1.0 ) discard;
  color = vec4(mod(index, 10.0) / 10.0, mod(index + 1.0, 10.0) / 10.0, mod(index + 2.0, 10.0) / 10.0, 0.9);
}`;


/**
 * For debugging.
 * Render the shadows on the scene canvas, using the depth texture.
 */
export const shadowRenderShaderGLSL = {};

/**
 * Convert the vertex to light space.
 * Pass through the texture coordinates to pull from the depth texture.
 * Translate and project the vector coordinate as usual.
 */
shadowRenderShaderGLSL.vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertexPosition;
in vec2 texCoord;
out vec2 vTexCoord;
out vec4 fragPosLightSpace;
out vec3 vertexPosition;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

void main() {
  vTexCoord = texCoord;
  vertexPosition = aVertexPosition;

  // gl_Position for 2-d canvas vertex calculated as normal
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition.xy, 1.0)).xy, 0.0, 1.0);
}`;

/**
 * Determine if the fragment position is in shadow by comparing to the depth texture.
 * Fragment position is converted by vertex shader to point of view of light.
 * Set shadow fragments to black, 50% alpha.
 */
shadowRenderShaderGLSL.fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

#define EPSILON 1e-12
#define M_PI 3.1415926535897932384626433832795
#define ELEVATION_OFFSET 32767.0
#define M_PI_180 0.017453292519943295

in vec2 vTexCoord;
in vec3 vertexPosition;
out vec4 fragColor;

uniform sampler2D uObjIndices;
uniform sampler2D uTerrainMap;
uniform usampler2D uObjCoordinates;
uniform float uMaxDistance;
uniform vec3 uLightPosition;
uniform float uLightSize;
uniform float uLightRadius;
uniform mat4 uProjectionM;
uniform mat4 uViewM;
uniform vec2 uCanvas;
uniform vec3 uLightDirection;
uniform bool uOrthogonal;
uniform vec4 uScene;
uniform vec4 EV_elevationRes;

struct Placeable {
  vec3 v0;
  vec3 v1;
  vec3 v2;
  vec3 v3;
  bool shadowsFragment;
};

/**
 * Calculate the canvas elevation given a pixel value
 * Maps 0–1 to elevation in canvas coordinates
 * EV_elevationRes:
 * r: elevation min; g: elevation step; b: max pixel value (likely 255); a: canvas size / distance
 * u.EV_elevationResolution = [elevationMin, elevationStep, maximumPixelValue, elevationMult];
 */
float canvasElevationFromPixel(in float pixel) {
  return (EV_elevationRes.r + (pixel * EV_elevationRes.b * EV_elevationRes.g)) * EV_elevationRes.a;
}

/**
 * Möller-Trumbore intersection algorithm for a triangle.
 * This function first calculates the edge vectors of the triangle and the determinant
 * of the triangle using the cross product and dot product. It then uses the Möller–Trumbore
 * intersection algorithm to calculate the intersection point using barycentric coordinates,
 * and checks if the intersection point is within the bounds of the triangle. If it is,
 * the function returns the distance from ray origin to point of intersection.
 * If the ray is parallel to the triangle or the intersection point is outside of the triangle,
 * the function returns null.
 * @param {vec3} rayOrigin
 * @param {vec3} rayDirection
 * @param {vec3} v0   First vertex of the triangle
 * @param {vec3} v1   Second vertex of the triangle
 * @param {vec3} v2   Third vertex of the triangle
 * @returns {float} Distance from ray origin to the point of intersection
 *   Returns -1.0 if no intersection.
 */
float rayIntersectionTriangle3d(in vec3 rayOrigin, in vec3 rayDirection, in vec3 v0, in vec3 v1, in vec3 v2) {
  // Triangle edge vectors.
  vec3 edge1 = v1 - v0;
  vec3 edge2 = v2 - v0;

  // Calculate the determinant of the triangle.
  vec3 pvec = cross(rayDirection, edge2);

  // If the determinant is near zero, ray lies in plane of triangle.
  float det = dot(edge1, pvec);
  if ( abs(det) < EPSILON ) return -1.0; // Ray is parallel to triangle.

  float invDet = 1.0 / det;

  // Calculate the intersection using barycentric coordinates.
  vec3 tvec = rayOrigin - v0;
  float u = invDet * dot(tvec, pvec);
  if ( u < 0.0 || u > 1.0 ) return -1.0; // Intersection point is outside triangle.

  vec3 qvec = cross(tvec, edge1);
  float v = invDet * dot(rayDirection, qvec);
  if ( v < 0.0 || (u + v) > 1.0 ) return -1.0; // Intersection point is outside of triangle.

  // Calculate the distance to the intersection point.
  float t = invDet * dot(edge2, qvec);
  return abs(t);

  // return t > EPSILON ? t : -1.0;
}

/**
 * Möller-Trumbore intersection algorithm for a quad.
 * Test the two triangles of the quad.
 * @param {vec3} rayOrigin
 * @param {vec3} rayDirection
 * @param {vec3} p0   Upper corner of the quad
 * @param {vec3} p1   Bottom corner of the quad
 * @returns {float} Distance from ray origin to the point of intersection
 *   Returns -1.0 if no intersection.
 */
float rayIntersectionQuad3d(in vec3 rayOrigin, in vec3 rayDirection, in vec3 v0, in vec3 v1, in vec3 v2, in vec3 v3) {
  // Triangles are v0 - v1 - v2, v0 - v2 - v3
  float t0 = rayIntersectionTriangle3d(rayOrigin, rayDirection, v0, v1, v2);
  if ( t0 != -1.0 ) return t0;

  float t1 = rayIntersectionTriangle3d(rayOrigin, rayDirection, v1, v2, v3);
  return t1;
}



/**
 * Cross x and y parameters in a vec2.
 * @param {vec2} a  First vector
 * @param {vec2} b  Second vector
 * @returns {float} The cross product
 */
float cross2d(in vec2 a, in vec2 b) { return a.x * b.y - a.y * b.x; }

/**
 * Quad intersect
 * https://www.shadertoy.com/view/XtlBDs
 * @param {vec3} ro   Ray origin
 * @param {vec3} rd   Ray direction
 * @param {vec3} v0   Corner #0
 * @param {vec3} v1   Corner #1
 * @param {vec3} v2   Corner #2
 * @param {vec3} v3   Corner #3
 * 0--b--3
 * |\
 * a c
 * |  \
 * 1    2
 * @returns {vec3} Returns barycentric coords or vec3(-1.0) if no intersection.
 */
const int lut[4] = int[](1, 2, 0, 1);

vec3 quadIntersect(in vec3 ro, in vec3 rd, in vec3 v0, in vec3 v1, in vec3 v2, in vec3 v3) {
  // Let's make v0 the origin.
  vec3 a = v1 - v0;
  vec3 b = v3 - v0;
  vec3 c = v2 - v0;
  vec3 p = ro - v0;

  // Intersect plane.
  vec3 nor = cross(a, b);
  float t = -dot(p, nor) / dot(rd, nor);
  if ( t < 0.0 ) return vec3(-1.0); // Parallel to plane

  // Intersection point.
  vec3 pos = p + (t * rd);

  // See here: https://www.shadertoy.com/view/lsBSDm.

  // Select projection plane.
  vec3 mor = abs(nor);
  int id = (mor.x > mor.y && mor.x > mor.z ) ? 0 : (mor.y > mor.z) ? 1 : 2;
  int idu = lut[id];
  int idv = lut[id + 1];

  // Project to 2D
  vec2 kp = vec2(pos[idu], pos[idv]);
  vec2 ka = vec2(a[idu], a[idv]);
  vec2 kb = vec2(b[idu], b[idv]);
  vec2 kc = vec2(c[idu], c[idv]);

  // Find barycentric coords of the quad.
  vec2 kg = kc - kb - ka;
  float k0 = cross2d(kp, kb);
  float k2 = cross2d(kc - kb, ka);  // Alt: float k2 = cross2d(kg, ka);
  float k1 = cross2d(kp, kg) - nor[id]; // Alt: float k1 = cross(kb, ka) + cross2d(kp, kg);

  float u;
  float v;
  if ( abs(k2) < 0.00001 ) { // TODO: use EPSILON?
    // Edges are parallel; this is a linear equation.
    v = -k0 / k1;
    u = cross2d(kp, ka) / k1;
  } else {
    // Otherwise, it's a quadratic.
    float w = (k1 * k1) - (4.0 * k0 * k2);
    if ( w < 0.0 ) return vec3(-1.0);
    w = sqrt(w);
    float ik2 = 1.0 / (2.0 * k2);
    v = (-k1 - w) * ik2;
    if ( v < 0.0 || v > 1.0 ) v = (-k1 + w) * ik2;
    u = (kp.x - (ka.x * v)) / (kb.x + (kg.x * v));
  }

  if ( u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0 ) return vec3(-1.0);
  return vec3(t, u, v);
}

/**
 * Pull the wall coordinates from the textures.
 */
Placeable getObjectCoordinates(in vec3 position) {
  vec4 lightSpacePosition = uProjectionM * uViewM * vec4(position, 1.0);

  // Perspective divide.
  // Does nothing with orthographic; needed for perspective projection.
  vec3 projCoord = lightSpacePosition.xyz / lightSpacePosition.w;
  //vec3 projCoord = lightSpacePosition.xyz;

  // Transform the NDC coordinates to range [0, 1].
  vec2 mapCoord = projCoord.xy * 0.5 + 0.5;

  // Pull the shadowing wall index for this location.
  float objIndex = texture(uObjIndices, mapCoord).r;

  // -1.0 signifies no shadow and so no valid coordinates.
  if ( objIndex == -1.0 ) return Placeable(vec3(-1.0), vec3(-1.0), vec3(-1.0), vec3(-1.0), false);

  // texelFetch is preferable to ensure we get the actual values.
  vec4 dat0 = vec4(texelFetch(uObjCoordinates, ivec2(0, int(objIndex)), 0));
  vec4 dat1 = vec4(texelFetch(uObjCoordinates, ivec2(1, int(objIndex)), 0));
  vec4 dat2 = vec4(texelFetch(uObjCoordinates, ivec2(2, int(objIndex)), 0));

  // Adjust the elevation coordinate
  vec2 elevationZ = dat2.rg - ELEVATION_OFFSET;

  // Assign coordinates; see quad
  vec3 v0 = vec3(dat0.xy, elevationZ.r); // A top (TL)
  vec3 v1 = vec3(dat1.zw, elevationZ.g); // A bottom (BL)
  vec3 v2 = vec3(dat1.xy, elevationZ.g); // B bottom (BR)
  vec3 v3 = vec3(dat0.zw, elevationZ.r); // B top (TR)

  return Placeable(v0, v1, v2, v3, true);
}

/**
 * Beta inverse function, avoiding infinity at 0.
 * Clamps values to between 0 and 1.
 * @param {float} x
 * @param {float} alpha
 * @param {float} beta
 * @returns {float} Returns 1 / beta(x, alpha, beta)
 */
float betaInv(in float x, in float alpha, in float beta) {
  if ( x <= 0.0 ) return 0.0;
  float value = 1.0 / (pow(x, alpha - 1.0) * pow(1.0 - x, beta - 1.0));
  return clamp(value, 0.0, 1.0);
}

/**
 * Sin function, clamping between 0 and 1.
 * @param {float} x
 * @param {float} amplitude       How high the wave goes (note it will still clamp to 1).
 * @param {float} frequency       How many times to repeat between 0 and 1.
 * @param {float} displacement    Shift values up or down along the 0–1 range.
 * @returns {float} Number [0,1]
 */
// As needed, may want to enable one or more of these parameters:
// float sinBlender(in float x, in float frequency, in float amplitude, in float displacement) {
//   float value = sin(x * frequency) * amplitude + displacement;
//   return clamp(value, 0.0, 1.0);
// }

float sinBlender(in float x, in float frequency, in float amplitude) {
  float value = sin(x * frequency) * amplitude;
  return clamp(value, 0.0, 1.0);
}

void main() {
  // vertexPosition is in canvas coordinates.

  // Retrieve the terrain elevation at this fragment.
  // Terrain is sized to the scene
  // uScene is [left, top, width, height]
  vec2 terrainCoord = (vertexPosition.xy - uScene.xy) / uScene.zw;
  float terrainZ = 0.0;
  if ( all(greaterThanEqual(terrainCoord, vec2(0.0))) && all(lessThanEqual(terrainCoord, vec2(1.0))) ) {
    vec4 terrainPixel = texture(uTerrainMap, terrainCoord);
    terrainZ = canvasElevationFromPixel(terrainPixel.r);
  }

  // Canvas position then is the vertex xy at the terrain elevation.
  vec3 canvasPosition = vec3(vertexPosition.xy, terrainZ);

  // If the light does not reach the location, no shadow.
  // Use squared distance.
  vec3 diff = uLightPosition - canvasPosition;
  if ( !uOrthogonal && dot(diff, diff) > (uLightRadius * uLightRadius) ) {
    fragColor = vec4(0.0);
    return;
  }

  Placeable fragPlaceable = getObjectCoordinates(vertexPosition);
  if ( !fragPlaceable.shadowsFragment ) {
    fragColor = vec4(0.0);
    return;
  }

  // Test for wall intersection given the actual elevation of the terrain.
  vec3 rayDirection = uOrthogonal ? uLightDirection : normalize(uLightPosition - canvasPosition);
  vec3 bary = quadIntersect(canvasPosition, rayDirection, fragPlaceable.v0, fragPlaceable.v1, fragPlaceable.v2, fragPlaceable.v3);
  // bary.x: [0–??] distance from fragment to the wall. In grid units.
  // bary.y: [0–1] where 0 is left-most portion of shadow, 1 is right-most portion
  //         (where left is left of the ray from fragment towards the light)
  // bary.z: [0–1] where 1 is nearest to the wall; 0 is furthest.

  float shadow = bary.x == -1.0 ? 0.0 : 0.8;
  fragColor = vec4(vec3(0.0), shadow);
}`;
