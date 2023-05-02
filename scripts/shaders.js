/* globals

*/
"use strict";

// Note: GLSL shaders

/**
 * For debugging.
 * Render the shadows on the scene canvas, using the depth texture.
 */
export const shadowRenderShader = {};

/**
 * Convert the vertex to light space.
 * Pass through the texture coordinates to pull from the depth texture.
 * Translate and project the vector coordinate as usual.
 */
shadowRenderShader.vertexShader =
`
#version 300 es
precision mediump float;

in vec3 aVertexPosition;
in vec2 texCoord;
out vec2 vTexCoord;
out vec4 fragPosLightSpace;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform mat4 projectionM;
uniform mat4 viewM;

void main() {
  vTexCoord = texCoord;
  fragPosLightSpace = projectionM * viewM * vec4(aVertexPosition, 1.0);

  // gl_Position for 2-d canvas vertex calculated as normal
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition.xy, 1.0)).xy, 0.0, 1.0);

}`;

/**
 * Determine if the fragment position is in shadow by comparing to the depth texture.
 * Fragment position is converted by vertex shader to point of view of light.
 * Set shadow fragments to black, 50% alpha.
 */
shadowRenderShader.fragmentShader =
`
#version 300 es
precision mediump float;

in vec2 vTexCoord;
in vec4 fragPosLightSpace;
out vec4 fragColor;

uniform sampler2D depthMap;

/**
 * Determine if the given position, in light space, is in shadow, by comparing to the depth texture.
 */
float shadowCalculation(in vec4 fragPosLightSpace) {
  // Perspective divide.
  // Needed when using perspective projection; does nothing with orthographic projection
  // Returns light-space position in range [-1, 1].
  vec3 projCoords = fragPosLightSpace.xyz / fragPosLightSpace.w;

  // Transform the NDC coordinates to range [0, 1].
  // Use to sample the depth map in range [0, 1].
  vec2 texCoords = projCoords.xy * 0.5 + 0.5;

  // Sample the depth map
  float closestDepth = texture(depthMap, texCoords).r;
  // if ( closestDepth == 1.0 ) return 0.0; // Depth 1.0 means no obstacle.

  // Projected vector's z coordinate equals depth of this fragment from light's perspective.
  // Check whether current position is in shadow.
  // currentDepth is closer to 1 the further we are from the light.
  float currentDepth = projCoords.z;

  float shadow = closestDepth != 1.0 && currentDepth < closestDepth ? 1.0 : 0.0;
  return shadow;
}

void main() {
  float shadow = shadowCalculation(fragPosLightSpace);

  // For testing, just draw the shadow.
  fragColor = vec4(0.0, 0.0, 0.0, shadow * 0.5);
  // fragColor = vec4(vec3(0.0), shadow);
}`;

/**
 * Update the depth shader based on wall distance from light, from point of view of the light.
 */
export const depthShader = {};

/**
 * Set z values by converting to the light view, and projecting either orthogonal or perspective.
 */
depthShader.vertexShader =
`
#version 300 es
precision mediump float;

in vec3 aVertexPosition;
uniform mat4 projectionM;
uniform mat4 viewM;

void main() {
  vec4 pos4 = vec4(aVertexPosition, 1.0);
  gl_Position = projectionM * viewM * pos4;
}`;

/**
 * Fragment shader simply used to update the fragDepth based on z value from vertex shader.
 */
depthShader.fragmentShader =
`
#version 300 es
precision mediump float;
out vec4 fragColor;

void main() {
  fragColor = vec4(gl_FragCoord.z * 0.5 + 0.5);
  // fragColor = vec4(0.0); // Needed so the fragment shader actually saves the depth values.
  //fragColor = vec4(1.0, 0.0, 0.0, 1.0); // For testing
}`;

/**
 * Output to a texture the distance squared of the object nearest to the light for each pixel.
 * This is the depth buffer, translated back to canvas coordinates.
 * But also ignore front-most terrain walls.
 */

/**
 * Output to a texture the frontmost terrain walls only.
 * The shader simply writes to the color buffer for terrain walls only.
 */
export const terrainRenderShader = {};

/**
 * Translate to canvas position
 */
terrainRenderShader.vertexShader =
`
#version 300 es
precision mediump float;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

in vec3 aVertexPosition;
in float aTerrain;
out float vTerrain;

void main() {
  vTerrain = aTerrain;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition.xy, 1.0)).xy, 0.0, 1.0);
}
`;

/**
 * Draw only if terrain.
 */
terrainRenderShader.fragmentShader =
`
#version 300 es
precision mediump float;

in float vTerrain;
out vec4 fragColor;
void main() {
  fragColor = vec4(vTerrain);
}
`;

/**
 * Sets terrain walls to "transparent"---set z to 1.
 * If depthShader already used, this will operate only on frontmost vertices / fragments.
 * Will change the depth of those to 1, meaning they will be at the end.
 */
export const terrainDepthShader = {};

/**
 * Project to light view just like with depthShader.
 *
 */
terrainDepthShader.vertexShader =
`
#version 300 es
precision mediump float;

in vec3 aVertexPosition;
in float aTerrain;
uniform mat4 projectionM;
uniform mat4 viewM;
out float vTerrain;

void main() {
  vec4 pos4 = vec4(aVertexPosition, 1.0);
  vec4 projectedPosition = projectionM * viewM * pos4;
  vTerrain = aTerrain;
  gl_Position = projectedPosition;
}`;

/**
 * Set the depth; for terrain vertices, set the z value to 1.
 */
terrainDepthShader.fragmentShader =
`
#version 300 es
precision mediump float;

in float vTerrain;
uniform sampler2D depthMap;
out vec4 fragColor;

void main() {
  if ( vTerrain > 0.5 ) {
    // Transform the NDC coordinates to range [0, 1].
    // Use to sample the depth map in range [0, 1].
    vec2 texCoord = gl_FragCoord.xy * 0.5 + 0.5;

    // Sample the depth map
    float previousDepth = texture(depthMap, texCoord).r;
    if ( previousDepth <= gl_FragCoord.z ) gl_FragDepth = 1.0;
  } else {
    gl_FragDepth = gl_FragCoord.z;
  }

  fragColor = vec4(0.0); // Needed so the fragment shader actually saves the depth values.
  //fragColor = vec4(1.0, 0.0, 0.0, 1.0); // For testing
}`;

