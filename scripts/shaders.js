/* globals

*/
"use strict";

/**
 * Update the depth shader based on wall distance from light, from point of view of the light.
 */
export const depthShaderGLSL = {};

/**
 * Vertex shader
 * Set z values by converting to the light view, and projecting either orthogonal or perspective.
 */
depthShaderGLSL.vertexShader =
`#version 300 es
precision mediump float;

in vec3 aVertexPosition;
uniform mat4 uProjectionM;
uniform mat4 uViewM;

void main() {
  vec4 pos4 = vec4(aVertexPosition, 1.0);
  gl_Position = uProjectionM * uViewM * pos4;
}`;

/**
 * Fragment shader
 * Update the fragDepth based on z value from vertex shader.
 */
depthShaderGLSL.fragmentShader =
`#version 300 es
precision mediump float;

out float distance;

void main() {
  distance = gl_FragCoord.z;
}`;

/**
 * Sets terrain walls to "transparent"---set z to 1.
 * If depthShader already used, this will operate only on frontmost vertices / fragments.
 * Will change the depth of those to 1, meaning they will be at the end.
 */
export const terrainDepthShaderGLSL = {};

/**
 * Vertex shader.
 * Project to light view just like with depthShader.
 *
 */
terrainDepthShaderGLSL.vertexShader =
`#version 300 es
precision mediump float;

uniform mat4 uProjectionM;
uniform mat4 uViewM;

in float aTerrain;
in vec3 aVertexPosition;

out vec3 vertexPosition;
out float vTerrain;

void main() {
  vTerrain = aTerrain;
  vertexPosition = aVertexPosition;
  gl_Position = uProjectionM * uViewM * vec4(aVertexPosition, 1.0);
}`;

/**
 * Fragment shader.
 * Set the depth; for terrain vertices, set the z value to 1.
 */
terrainDepthShaderGLSL.fragmentShader =
`#version 300 es
precision mediump float;

uniform vec3 uLightPosition;
uniform sampler2D depthMap;

in vec3 lightPosition;
in vec3 vertexPosition;
in float vTerrain;

out float distance;

void main() {
  float fragDepth = gl_FragCoord.z; // 0 – 1

  // Unclear how to use texture correctly here.
  // vec2 fragCoord = gl_FragCoord.xy * 0.5 + 0.5;
  //vec2 fragCoord = gl_FragCoord.xy;
  //float nearestDepth = texture(depthMap, fragCoord.xy).r;

  ivec2 fragCoord = ivec2(gl_FragCoord.xy);
  float nearestDepth = texelFetch(depthMap, fragCoord, 0).r;

  if ( vTerrain > 0.5 && nearestDepth >= fragDepth ) {
    gl_FragDepth = 1.0;
    // return;
    distance = 1.0;
  } else {
    gl_FragDepth = gl_FragCoord.z;
    // distance = dot(uLightPosition, vertexPosition);
    distance = gl_FragCoord.z;
  }
}`;


/**
 * Write the wall coordinates for the wall that shadows.
 * @param {"A"|"B"} endpoint
 * @returns {object} {vertexShader: {string}, vertexShader: {string}}
 */
export function getWallCoordinatesShaderGLSL(endpoint = "A") {
  const wallCoordinatesShaderGLSL = {};
  wallCoordinatesShaderGLSL.vertexShader =
`#version 300 es
precision mediump float;

uniform mat4 uProjectionM;
uniform mat4 uViewM;

in vec3 aVertexPosition;
in vec3 aWall${endpoint};

out vec3 vWall;

void main() {
  vWall = aWall${endpoint};
  gl_Position = uProjectionM * uViewM * vec4(aVertexPosition, 1.0);
}`;

wallCoordinatesShaderGLSL.fragmentShader =
`#version 300 es
precision mediump float;

uniform sampler2D depthMap;

in vec3 vWall;
out ivec4 coordinates;
//out float coordinates;

void main() {
  ivec2 fragCoord = ivec2(gl_FragCoord.xy);
  float nearestDepth = texelFetch(depthMap, fragCoord, 0).r;

  if ( nearestDepth == 0.0 ) discard;

  if ( nearestDepth >= gl_FragCoord.z ) {
    // distance = gl_FragCoord.z;
    // coordinates = 1.0 - (vWall.x / 6000.0);
    coordinates = ivec4(vWall, 1);

  } else {
    discard;
  }
}`;

  return wallCoordinatesShaderGLSL;
}

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
precision mediump float;

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
precision mediump float;
precision mediump isampler2D;

#define EPSILON 1e-12

in vec2 vTexCoord;
in vec3 vertexPosition;
out vec4 fragColor;

// TODO: Use isampler2DArray or possibly usampler2DArray
uniform sampler2D wallA;
uniform sampler2D wallB;
uniform sampler2D distanceMap;
uniform float uMaxDistance;
uniform vec3 uLightPosition;
uniform float uLightSize;
uniform mat4 uProjectionM;
uniform mat4 uViewM;

struct Wall {
  vec3 A;
  vec3 B;
  bool shadowsFragment;
};

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
  if ( det > -EPSILON && det < EPSILON ) return -1.0; // Ray is parallel to triangle.
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
  return t > EPSILON ? t : -1.0;
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
float rayIntersectionQuad3d(in vec3 rayOrigin, in vec3 rayDirection, in vec3 p0, in vec3 p1) {
  // Quad goes v0 - v1 - v2 - v3
  vec3 diff = abs(p1 - p0);
  vec3 minP = min(p0, p1);
  vec3 maxP = max(p0, p1);

  vec3 v0 = p0;
  vec3 v1 = vec3(p1.x, p0.y, p0.z);
  vec3 v2 = p1;
  vec3 v3 = vec3(p0.x, p1.y, p1.z);

  // Triangles are v0 - v1 - v2, v0 - v2 - v3
  float t0 = rayIntersectionTriangle3d(rayOrigin, rayDirection, v0, v1, v2);
  if ( t0 != -1.0 ) return t0;

  float t1 = rayIntersectionTriangle3d(rayOrigin, rayDirection, v0, v2, v3);
  return t1;
}

/**
 * Pull the wall coordinates from the textures.
 * @returns {Wall}
 */
Wall getWallCoordinates(in vec3 position) {
  vec4 lightSpacePosition = uProjectionM * uViewM * vec4(position, 1.0);

  // Perspective divide.
  // Does nothing with orthographic; needed for perspective projection.
  vec3 projCoord = lightSpacePosition.xyz / lightSpacePosition.w;

  // Transform the NDC coordinates to range [0, 1]
  vec2 mapCoord = projCoord.xy * 0.5 + 0.5;

  // Sample the maps
  vec4 A = texture(wallA, mapCoord);
  vec4 B = texture(wallB, mapCoord);

  return Wall(vec3(A.xyz), vec3(B.xyz), A.w != 0.0);
}

/**
 * For testing
 * @returns {vec4}
 */
vec4 getCoordinates(in vec3 position) {
  vec4 lightSpacePosition = uProjectionM * uViewM * vec4(position, 1.0);

  // Perspective divide.
  // Does nothing with orthographic; needed for perspective projection.
  vec3 projCoord = lightSpacePosition.xyz / lightSpacePosition.w;

  // Transform the NDC coordinates to range [0, 1]
  vec2 mapCoord = projCoord.xy * 0.5 + 0.5;

  // return texture(wallA, mapCoord);
  ivec2 iProjCoord = ivec2(projCoord.xy);
  return texelFetch(wallA, iProjCoord, 0);
}

void main() {
  // Simplest version is to check the w value of a coordinate: will be 0 if not shadowed.
  // Wall fragWall = getWallCoordinates(vertexPosition);
  // float shadow = float(fragWall.shadowsFragment);

  vec4 coords = getCoordinates(vertexPosition);

  float shadow = 0.0;
  if ( coords.x > 0.0 ) shadow = 1.0;

  fragColor = vec4(0.0, 0.0, 0.0, shadow);
  // fragColor = vec4((nearestDistance - fragDist) / nearestDistance, 0.0, 0.0, shadow);
}`;
