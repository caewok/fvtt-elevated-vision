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
float penumbraSize(in float nearestDistance) {
  float totalDist = sqrt(dot(uLightPosition, vertexPosition));
  float nearest = sqrt(nearestDistance);
  float occluderDist = totalDist - nearest;
  return uLightSize * (occluderDist / nearest);
}

/**
 * Percentage distance from wall for the shadow fragment, between 0 and 1.
 */
float percentDistanceFromWall(ShadowPixel shadowPx) {
  float fragmentDistance = dot(uLightPosition, shadowPx.position);
  return (shadowPx.nearestDistance - fragmentDistance) / shadowPx.nearestDistance;
}

/**
 * Search for a valid shadow pixel location from which we can determine penumbra size.
 * Must be a point in shadow.
 *
 */
ShadowPixel penumbraLocation(in vec3 startingPosition) {
  vec3 offset = vec3(0.0);

  float position = startingPosition + offset;
  ShadowPixel shadowPx = getShadowPixel(position);
  if ( shadowPx.isShadowed ) return shadowPx;

  // TODO: Check all 4 directions? May not be worth the trouble.
  ShadowPixel startingShadow = shadowPx;
  for ( int i = 1; i < 100; i += 1 ) {
    float floatI = float(i);
    for ( int x = -1; x < 2; x += 1 ) {
      for ( int y = -1; y < 2; y += 1 ) {
        if ( x == 0 && y == 0 ) continue;
        vec3 offset = vec2(float(x), float(y), 0.0);
        position = startingPosition + (offset * floatI);
        shadowPx = getShadowPixel(position);
        if ( shadowPx.isShadowed ) return shadowPx;
      }
    }
  }
  return startingShadow;
}


/**
 * Find the penumbra size for this fragment.
 * If the fragment is shaded, use it.
 * If fragment is not shaded, search in cross pattern for shaded pixel max distance.
 */
float penumbraPercentageForFragment(in vec3 startingPosition) {
  ShadowPixel penumbraPx = penumbraLocation(startingPosition);
  if ( !penumbraPx.isShadowed ) return 0.0;

  float size = penumbraSize()

  float nearestDistance = nearestDistanceAt(startingPosition);
  float fragDist = dot(uLightPosition, vertexPosition);
  float EPSILON = 1e-08;
  float percentDist = 0.0;

  if ( nearestDistance != 0.0 && fragDist < nearestDistance ) {
    //return 0.0;
    return max(1.0, penumbraSize(nearestDistance));
  }

  // TODO: Calculate maximum based on canvas size, light radius?
  // TODO: Can this be combined with getting values for the blur?
  // TODO: Can this be simplified with a for loop or something?
  for ( int i = 0; i < 10; i += 1 ) {
    // Find the maximum at this level of the cross.
    float maxDist = 0.0;
    float iFloat = float(i);

    vec3 newPosition = vec3(startingPosition.x + iFloat, startingPosition.yz);
    float newDistance = nearestDistanceAt(newPosition);
    if ( isShadowAt(newPosition, newDistance) ) {
      //percentDist = percentDistanceFromWall(newDistance, dot(uLightPosition, newPosition));
      //if ( percentDist < EPSILON ) return 0.0;
      maxDist = max(maxDist, newDistance);
    }

    newPosition = vec3(startingPosition.x - iFloat, startingPosition.yz);
    newDistance = nearestDistanceAt(newPosition);
    if ( isShadowAt(newPosition, newDistance) ) {
      //percentDist = percentDistanceFromWall(newDistance, dot(uLightPosition, newPosition));
      //if ( percentDist < EPSILON ) return 0.0;
      maxDist = max(maxDist, newDistance);
    }

    newPosition = vec3(startingPosition.x, startingPosition.y + iFloat, startingPosition.z);
    newDistance = nearestDistanceAt(newPosition);
    if ( isShadowAt(newPosition, newDistance) ) {
      //percentDist = percentDistanceFromWall(newDistance, dot(uLightPosition, newPosition));
      //if ( percentDist < EPSILON ) return 0.0;
      maxDist = max(maxDist, newDistance);
    }

    newPosition = vec3(startingPosition.x, startingPosition.y - iFloat, startingPosition.z);
    newDistance = nearestDistanceAt(newPosition);
    if ( isShadowAt(newPosition, newDistance) ) {
      //percentDist = percentDistanceFromWall(newDistance, dot(uLightPosition, newPosition));
      //if ( percentDist < EPSILON ) return 0.0;
      maxDist = max(maxDist, newDistance);
    }

    if ( maxDist > 0.0 ) {
      return max(100.0, penumbraSize(maxDist));
    }
  }
  return 100.0;
}

/**
 * Set a blur based on the size provided.
 */
float penumbraBlurForFragment(in vec3 startingPosition, in float penumbraSize) {
  // Each step should be either a 0 or a 1.
  // Start with the middle point.
  vec3 position = startingPosition;
  float nearestDistance = nearestDistanceAt(position);
  float numerator = float(isShadowAt(position, nearestDistance));
  float denominator = 1.0;

  for ( float offset = 1.0; offset < penumbraSize; offset += 1.0 ) {
    // Horizontal
    position = vec3(startingPosition.x + offset, startingPosition.yz);
    nearestDistance = nearestDistanceAt(position);
    numerator += float(isShadowAt(position, nearestDistance));

    position = vec3(startingPosition.x - offset, startingPosition.yz);
    nearestDistance = nearestDistanceAt(position);
    numerator += float(isShadowAt(position, nearestDistance));

    // Vertical
    position = vec3(startingPosition.x, startingPosition.y + offset, startingPosition.z);
    nearestDistance = nearestDistanceAt(position);
    numerator += float(isShadowAt(position, nearestDistance));

    position = vec3(startingPosition.x, startingPosition.y - offset, startingPosition.z);
    nearestDistance = nearestDistanceAt(position);
    numerator += float(isShadowAt(position, nearestDistance));

    denominator += 4.0;
  }

  return numerator / denominator;
}

/**
 * Calculate the percent shadow for this fragment.
 * Currently 0 or 1 but the distance should allow for penumbra calcs.
 */
float shadowPercentage(in float nearestDistance) {
//   float fragDist = dot(uLightPosition, vertexPosition);
//   if ( fragDist < nearestDistance ) return 0.0; // Shadows
//   if ( fragDist > nearestDistance ) return 1.0; // Outside of shadows
//   if ( fragDist == nearestDistance ) return 0.5; // Never happens

  // Shadows have nearest distance that is not 0.
  // return nearestDistance == 0.0  ? 0.0 : 1.0;

  float penumbraSize = penumbraSizeForFragment(vertexPosition);
  if ( penumbraSize <= 0.0 ) return 0.0;
  if ( penumbraSize <= 1.01 ) return 1.0;

  return penumbraBlurForFragment(vertexPosition, penumbraSize);

  // float fragDist = dot(uLightPosition, vertexPosition);
  // return fragDist < nearestDistance ? 1.0 : 0.0;
}

void main() {
  float nearestDistance = nearestDistanceAt(vertexPosition);
  float shadow = shadowPercentage(nearestDistance);

  // nearestDistance / uMaxDistance: ratio --> 1 as the shadow moves away from walls
  // But that is all walls -- take the ratio between nearest and fragment distance
  // (nearestDistance - fragDist) / nearestDistance --> 1 as shadow moves away from a wall
  float fragDist = dot(uLightPosition, vertexPosition);
  // float shadowRatioFromWall = (nearestDistance - fragDist) / nearestDistance;
  float shadowRatioFromWall = percentDistanceFromWall(nearestDistance, fragDist);
  if ( shadow != 0.0 ) {
    shadow = mix(shadow, 1.0 - shadowRatioFromWall, 0.5);
  }

  fragColor = vec4(0.0, 0.0, 0.0, shadow);
  // fragColor = vec4((nearestDistance - fragDist) / nearestDistance, 0.0, 0.0, shadow);

}`;
