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
  distance = gl_FragCoord.z; // [0, 1]
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
  // gl_FragCoord.x: [0, texture width (e.g., 1024)]
  // gl_FragCoord.y: [0, texture height (e.g., 1024)]
  // gl_FragCoord.z: [0, 1]
  // depthMap: [0, 1] (see depthShader, above)

  float fragDepth = gl_FragCoord.z; // 0 – 1
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
export function getWallCoordinatesShaderGLSL(endpoint = "A", coord = "x") {
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
//out ivec4 coordinates;
out float coordinate;

void main() {
  ivec2 fragCoord = ivec2(gl_FragCoord.xy);
  float nearestDepth = texelFetch(depthMap, fragCoord, 0).r;

  if ( nearestDepth == 0.0 ) discard;

  if ( nearestDepth >= gl_FragCoord.z ) {
    // distance = gl_FragCoord.z;
    // coordinates = 1.0 - (vWall.x / 6000.0);
    coordinate = vWall.${coord};

    // coordinates = ivec4(vWall, 1);

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
uniform sampler2D wallAx;
uniform sampler2D wallAy;
uniform sampler2D wallAz;
uniform sampler2D wallBx;
uniform sampler2D wallBy;
uniform sampler2D wallBz;
uniform float uMaxDistance;
uniform vec3 uLightPosition;
uniform float uLightSize;
uniform mat4 uProjectionM;
uniform mat4 uViewM;
uniform vec2 uCanvas;
uniform vec3 uLightDirection;
uniform bool uOrthogonal;

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
  vec3 coordA = vec3(-1.0);
  vec3 coordB = vec3(-1.0);

  coordA.x = texture(wallAx, mapCoord).r;

  // -1.0 signifies no shadow and so no valid coordinates.
  if ( coordA.x == -1.0 ) return Wall(coordA, coordB, false);

  coordA.y = texture(wallAy, mapCoord).r;
  coordA.z = texture(wallAz, mapCoord).r;
  coordB.x = texture(wallBx, mapCoord).r;
  coordB.y = texture(wallBy, mapCoord).r;
  coordB.z = texture(wallBz, mapCoord).r;
  return Wall(coordA, coordB, true);
}

/**
 * For testing
 * @returns {float}
 */
float getCoordinates(in vec3 position) {
  vec4 lightSpacePosition = uProjectionM * uViewM * vec4(position, 1.0);

  // Perspective divide.
  // Does nothing with orthographic; needed for perspective projection.
  vec3 projCoord = lightSpacePosition.xyz / lightSpacePosition.w;

  // Transform the NDC coordinates to range [0, 1]
  vec2 mapCoord = projCoord.xy * 0.5 + 0.5;

  return texture(wallAx, mapCoord).r;
}

void main() {

  Wall fragWall = getWallCoordinates(vertexPosition);
  // fragColor = vec4(0.0, 0.0, fragWall.B.z / 1600.0 , float(fragWall.shadowsFragment));
  //fragColor = vec4(fragWall.B.x / 5000.0, 0.0, 0.0, float(fragWall.shadowsFragment));
  // fragColor = vec4(0.0, fragWall.B.y / 3800.0, 0.0, float(fragWall.shadowsFragment));
  //fragColor = vec4(fragWall.A.x / 5000.0, fragWall.A.y / 3800.0, fragWall.A.z / 1600.0, float(fragWall.shadowsFragment));
  //fragColor = vec4(fragWall.B.x / 5000.0, fragWall.B.y / 3800.0, fragWall.B.z / 1600.0, float(fragWall.shadowsFragment));
  //return;

  // Simplest version is to check the w value of a coordinate: will be 0 if not shadowed.
  // TODO: Consider terrain elevation
  //Wall fragWall = getWallCoordinates(vertexPosition);
  float shadow = float(fragWall.shadowsFragment);
  float red = 0.0;
  float blue = 0.0;
  float green = 0.0;
  float alpha = shadow;

//   float coord = getCoordinates(vertexPosition);
//   float shadow = coord == -1.0 ? 0.0 : coord / 1024.0;
  if ( shadow != 0.0 ) {
    // TODO: Consider terrain elevation
    // TODO: Subtract x, y by 0.5 to shift the vertices to pixel integers instead of pixel middles?
    // Adjust for flipped y axis in GPU? Not needed currently, as vertexPosition based on canvas.
    vec3 canvasCenter = vec3(uCanvas * 0.5, 0.0);
    vec3 rayOrigin = vec3(vertexPosition.x, vertexPosition.y , 0.0);
    vec3 rayDirection = uOrthogonal ? uLightDirection : (uLightPosition - rayOrigin);

    vec3 v0 = fragWall.A;
    vec3 v1 = vec3(fragWall.A.xy, fragWall.B.z);
    vec3 v2 = fragWall.B;
    vec3 v3 = vec3(fragWall.B.xy, fragWall.A.z);
    // TODO: Why is rayIntersectionQuad3d broken?
    // float t = rayIntersectionQuad3d(rayOrigin, rayDirection, v0, v1, v2, v3);
    vec3 bary = quadIntersect(rayOrigin, rayDirection, v0, v1, v2, v3);
    // float t = bary.x;


    red = bary.x;
    blue = bary.y;
    green = bary.z;





//       vec3 ix = rayOrigin + (rayDirection * t);
//       float nearestDist = distance(uLightPosition, ix);
//       float fragDist = distance(uLightPosition, rayOrigin);
//       shadow = (nearestDist - fragDist) / nearestDist;

      // float nearestT = 1.0 - t;
      // shadow = (nearestT - t) / nearestT;

  }
  fragColor = vec4(red, green, blue, shadow);
  // fragColor = vec4(0.0, 0.0, 0.0, shadow);
  // fragColor = vec4((nearestDistance - fragDist) / nearestDistance, 0.0, 0.0, shadow);
}`;
