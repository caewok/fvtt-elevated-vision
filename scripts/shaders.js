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

in float aTerrain;
in vec3 aVertexPosition;
uniform mat4 uProjectionM;
uniform mat4 uViewM;
uniform vec3 uLightPosition;
out vec3 lightPosition;
out vec3 vertexPosition;
out float vTerrain;

void main() {
  vTerrain = aTerrain;
  vertexPosition = aVertexPosition;
  lightPosition = uLightPosition;
  gl_Position = uProjectionM * uViewM * vec4(aVertexPosition, 1.0);
}`;

/**
 * Fragment shader.
 * Set the depth; for terrain vertices, set the z value to 1.
 */
terrainDepthShaderGLSL.fragmentShader =
`#version 300 es
precision mediump float;

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

  if ( vTerrain > 0.5 && nearestDepth < fragDepth) {
    distance = dot(lightPosition, vertexPosition);

  } else if ( vTerrain > 0.5 ) {
    return;

  } else {
    distance = dot(lightPosition, vertexPosition);
  }
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
precision mediump float;

in vec3 aVertexPosition;
in vec2 texCoord;
out vec2 vTexCoord;
out vec4 fragPosLightSpace;
out vec3 lightPosition;
out vec3 vertexPosition;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform mat4 uProjectionM;
uniform mat4 uViewM;
uniform vec3 uLightPosition;

void main() {
  vTexCoord = texCoord;
  vertexPosition = aVertexPosition;
  lightPosition = uLightPosition;
  fragPosLightSpace = uProjectionM * uViewM * vec4(aVertexPosition, 1.0);
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

in vec2 vTexCoord;
in vec4 fragPosLightSpace;
in vec3 lightPosition;
in vec3 vertexPosition;
out vec4 fragColor;

uniform sampler2D distanceMap;
uniform float uMaxDistance;

/**
 * Pull the nearest distance for the given position, in light space.
 * Distances are distance-squared.
 */
float nearestDistanceForFragment() {
  // Perspective divide.
  // Needed when using perspective projection; does nothing with orthographic projection
  // Returns light-space position in range [-1, 1].
  vec3 projCoord = fragPosLightSpace.xyz / fragPosLightSpace.w;

  // Transform the NDC coordinates to range [0, 1].
  // Use to sample the depth map in range [0, 1].
  vec2 fragCoord = projCoord.xy * 0.5 + 0.5;

  // Sample the depth map
  float nearestDistance = texture(distanceMap, fragCoord).r;

  // Sample the depth map
  // ivec2 fragCoordI = ivec2(projCoord.xy);
  // float nearestDistance = texelFetch(distanceMap, fragCoordI, 0).r;

  return nearestDistance;
}

/**
 * Calculate the percent shadow for this fragment.
 * Currently 0 or 1 but the distance should allow for penumbra calcs.
 */
float shadowPercentage(in float nearestDistance) {
  float fragDist = dot(lightPosition, vertexPosition);
  return fragDist < nearestDistance ? 1.0 : 0.0;
}

void main() {
  float nearestDistance = nearestDistanceForFragment();
  float shadow = shadowPercentage(nearestDistance);

  nearestDistance = nearestDistance / uMaxDistance;

  // For testing, just draw the shadow.
  // fragColor = vec4(0.0, 0.0, 0.0, shadow * 0.5);
  fragColor = vec4(nearestDistance, 0.0, 0.0, shadow * 0.5);

}`;
