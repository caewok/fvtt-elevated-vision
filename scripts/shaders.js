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
    return;
  } else {
    distance = dot(uLightPosition, vertexPosition);
  }
}`;


/**
 * Write the wall coordinates for the wall that shadows.
 */
wallACoordinatesShaderGLSL = {};

wallACoordinatesShaderGLSL.vertexShader =
`#version 300 es
precision mediump float;

uniform mat4 uProjectionM;
uniform mat4 uViewM;

in float aTerrain;
in vec3 aVertexPosition;
in vec3 aWallA;
in vec3 aWallB;

out vec3 vertexPosition;
out float vTerrain;
out vec3 vWallA;
out vec3 vWallB;

void main() {
  vTerrain = aTerrain;
  vWallA = aWallA;
  vWallB = aWallB;
  vertexPosition = aVertexPosition;
  gl_Position = uProjectionM * uViewM * vec4(aVertexPosition, 1.0);
}`;

wallACoordinatesShaderGLSL.fragmentShader =
`#version 300 es
precision mediump float;

uniform vec3 uLightPosition;
uniform sampler2D distanceMap;
in vec3 lightPosition;
in vec3 vertexPosition;
in float vTerrain;
in vec3 vWallA;
in vec3 vWallB;
out vec3 coordinates;

void main() {
  float fragDepth = gl_FragCoord.z; // 0 – 1

  // Unclear how to use texture correctly here.
  // vec2 fragCoord = gl_FragCoord.xy * 0.5 + 0.5;
  //vec2 fragCoord = gl_FragCoord.xy;
  //float nearestDepth = texture(depthMap, fragCoord.xy).r;

  ivec2 fragCoord = ivec2(gl_FragCoord.xy);
  float nearestDistance = texelFetch(distanceMap, fragCoord, 0).r;
  float thisDistance = dot(uLightPosition, vertexPosition);

  if ( nearestDistance < thisDistance ) return;
  coordinates = vWallA;
}`;

/**
 * Write the wall coordinates for the wall that shadows.
 */
wallBCoordinatesShaderGLSL = {};

wallBCoordinatesShaderGLSL.vertexShader =
`#version 300 es
precision mediump float;

uniform mat4 uProjectionM;
uniform mat4 uViewM;

in float aTerrain;
in vec3 aVertexPosition;
in vec3 aWallA;
in vec3 aWallB;

out vec3 vertexPosition;
out float vTerrain;
out vec3 vWallA;
out vec3 vWallB;

void main() {
  vTerrain = aTerrain;
  vWallA = aWallA;
  vWallB = aWallB;
  vertexPosition = aVertexPosition;
  gl_Position = uProjectionM * uViewM * vec4(aVertexPosition, 1.0);
}`;

wallBCoordinatesShaderGLSL.fragmentShader =
`#version 300 es
precision mediump float;

uniform vec3 uLightPosition;
uniform sampler2D distanceMap;
in vec3 lightPosition;
in vec3 vertexPosition;
in float vTerrain;
in vec3 vWallA;
in vec3 vWallB;
out vec3 coordinates;

void main() {
  float fragDepth = gl_FragCoord.z; // 0 – 1

  // Unclear how to use texture correctly here.
  // vec2 fragCoord = gl_FragCoord.xy * 0.5 + 0.5;
  //vec2 fragCoord = gl_FragCoord.xy;
  //float nearestDepth = texture(depthMap, fragCoord.xy).r;

  ivec2 fragCoord = ivec2(gl_FragCoord.xy);
  float nearestDistance = texelFetch(distanceMap, fragCoord, 0).r;
  float thisDistance = dot(uLightPosition, vertexPosition);

  if ( nearestDistance < thisDistance ) return;
  coordinates = vWallB;
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

in vec2 vTexCoord;
in vec3 vertexPosition;
in vec3 lightPosition;
out vec4 fragColor;

uniform vec3 uLightPosition;
uniform sampler2D distanceMap;
uniform float uMaxDistance;
uniform float uLightSize;
uniform mat4 uProjectionM;
uniform mat4 uViewM;

struct ShadowPixel {
  vec3 position;
  float nearestDistance;
  bool isShadowed;
};

bool isShadowAt(float nearestDistance) {
  return nearestDistance > 0.0;

  // if ( shadowPx.nearestDistance <= 0.0 ) return false;

//   float fragDist = dot(uLightPosition, shadowPx.position);
//   return fragDist < nearestDistance;
}

/**
 * Pull the nearest distance for the given position.
 * Distances are distance-squared.
 */
ShadowPixel getShadowPixel(in vec3 position) {
  vec4 lightSpacePosition = uProjectionM * uViewM * vec4(position, 1.0);

  // Perspective divide.
  // Needed when using perspective projection; does nothing with orthographic projection
  // Returns light-space position in range [-1, 1].
  vec3 projCoord = lightSpacePosition.xyz / lightSpacePosition.w;

  // Transform the NDC coordinates to range [0, 1].
  // Use to sample the depth map in range [0, 1].
  vec2 fragCoord = projCoord.xy * 0.5 + 0.5;

  // Sample the depth map
  float nearestDistance = texture(distanceMap, fragCoord).r;

  // Sample the depth map
  // ivec2 fragCoordI = ivec2(projCoord.xy);
  // float nearestDistance = texelFetch(distanceMap, fragCoordI, 0).r;

  bool isShadowed = isShadowAt(nearestDistance);
  return ShadowPixel(position, nearestDistance, isShadowed);
}



/**
 * Determine penumbra size given distance from light.
 * See https://blog.imaginationtech.com/implementing-fast-ray-traced-soft-shadows-in-a-game-engine/
 * Equation there seems slightly off: really want the ratio of wall to light : frag to wall.
 * A = wall to light (nearest)
 * B = frag to wall (total - nearest)
 * Penumbra radius = light radius * B / A
 */
float penumbraSize(in ShadowPixel shadowPx) {
  float totalDist = sqrt(dot(uLightPosition, shadowPx.position));
  float nearest = sqrt(shadowPx.nearestDistance);
  float occluderDist = totalDist - nearest;
  return uLightSize * (occluderDist / nearest);
}

/**
 * Percentage distance from wall for the shadow fragment, between 0 and 1.
 */
float percentDistanceFromWall(in ShadowPixel shadowPx) {
  float fragmentDistance = dot(uLightPosition, shadowPx.position);
  return (shadowPx.nearestDistance - fragmentDistance) / shadowPx.nearestDistance;
}

/**
 * Search for a valid shadow pixel location from which we can determine penumbra size.
 * Must be a point in shadow.
 *
 */
ShadowPixel penumbraLocation(in ShadowPixel startingShadowPx) {
  if ( startingShadowPx.isShadowed ) return startingShadowPx;

  // TODO: Check all 4 directions to find max? May not be worth the trouble.
  // Placeholders
  vec3 offsetV = vec3(0.0);
  vec3 position = vec3(0.0);
  ShadowPixel shadowPx = startingShadowPx;
  for ( float mult = 1.0; mult < 100.0; mult += 1.0 ) {
    for ( int x = -1; x < 2; x += 1 ) {
      for ( int y = -1; y < 2; y += 1 ) {
        if ( x == 0 && y == 0 ) continue;
        offsetV = vec3(float(x), float(y), 0.0);
        position = startingShadowPx.position + (offsetV * mult);
        shadowPx = getShadowPixel(position);
        if ( shadowPx.isShadowed ) return shadowPx;
      }
    }
  }
  return startingShadowPx;
}


// TODO: Could probably combine penumbraLocation and penumbraBlurForFragment.

/**
 * Set a blur based on the size provided.
 */
float penumbraBlurForFragment(in ShadowPixel startingShadowPx, in float penumbraSize) {
  // Each step should be either a 0 or a 1.
  // Start with the middle point.
  float numerator = float(startingShadowPx.isShadowed);
  float denominator = 1.0;

  // Placeholders
  vec3 offsetV = vec3(0.0);
  vec3 position = vec3(0.0);
  ShadowPixel shadowPx = startingShadowPx;
  for ( float mult = 1.0; mult < penumbraSize; mult += 1.0 ) {
    for ( int x = -1; x < 2; x += 1 ) {
      for ( int y = -1; y < 2; y += 1 ) {
        if ( x == 0 && y == 0 ) continue;
        offsetV = vec3(float(x), float(y), 0.0);
        position = startingShadowPx.position + (offsetV[0] * mult);
        shadowPx = getShadowPixel(position);
        numerator += float(shadowPx.isShadowed);
        denominator += 1.0;
      }
    }
  }
  return numerator / denominator;
}

/**
 * Calculate the percent shadow for this fragment.
 * Currently 0 or 1 but the distance should allow for penumbra calcs.
 */
float shadowPercentage(in ShadowPixel fragShadowPx) {
//   float fragDist = dot(uLightPosition, vertexPosition);
//   if ( fragDist < nearestDistance ) return 0.0; // Shadows
//   if ( fragDist > nearestDistance ) return 1.0; // Outside of shadows
//   if ( fragDist == nearestDistance ) return 0.5; // Never happens

  // Shadows have nearest distance that is not 0.
  // return nearestDistance == 0.0  ? 0.0 : 1.0;
  return float(fragShadowPx.isShadowed);

  // ShadowPixel penumbraLocation = penumbraLocation(fragShadowPx);
  // float penumbraSize = penumbraSize(penumbraLocation);
  // if ( penumbraSize <= 0.0 ) return 0.0;
  // if ( penumbraSize <= 1.01 ) return 1.0;

  // return penumbraBlurForFragment(fragShadowPx, penumbraSize);

  // float fragDist = dot(uLightPosition, vertexPosition);
  // return fragDist < nearestDistance ? 1.0 : 0.0;
}

void main() {
  ShadowPixel fragShadowPx = getShadowPixel(vertexPosition);
  float shadow = shadowPercentage(fragShadowPx);

  // nearestDistance / uMaxDistance: ratio --> 1 as the shadow moves away from walls
  // But that is all walls -- take the ratio between nearest and fragment distance
  // (nearestDistance - fragDist) / nearestDistance --> 1 as shadow moves away from a wall
  float shadowRatioFromWall = percentDistanceFromWall(fragShadowPx);
  if ( shadow != 0.0 ) {
    shadow = mix(shadow, 1.0 - shadowRatioFromWall, 0.5);
  }

  fragColor = vec4(0.0, 0.0, 0.0, shadow);
  // fragColor = vec4((nearestDistance - fragDist) / nearestDistance, 0.0, 0.0, shadow);

}`;
