#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Unsized Fragment ----- */

in vec2 vVertexPosition;
in vec2 vTerrainTexCoord;
in float vEdgeDist;

uniform sampler2D uTerrainSampler;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier
uniform vec3 uLightPosition;

/**
 * Fragment color when no shadow present.
 * @returns {vec4}
 */
vec4 noShadow() {
  // If not in shadow, need to treat limited wall as non-limited
  #ifdef SHADOW
  return vec4(0.0);
  #endif
  return vec4(1.0);
}

/**
 * Fragment color to encode percentage of light.
 * @param {float} light   Percent light present, between 0.0 and 1.0.
 * @returns {vec4}
 */
vec4 lightEncoding(in float light) {
  if ( light == 1.0 ) return noShadow();

  // For testing, return the amount of shadow, which can be directly rendered to the canvas.
  #if defined SHADOW
  return vec4(vec3(0.0), (1.0 - light) * 0.7)

  #elif defined LIMITED_WALL
  return vec4(1.0, 0.5, light, 1.0);

  #else
  return vec4(light, 1.0, 1.0, 1.0);
  #endif
}

/**
 * Is the fragment location in front of the wall?
 * @returns {bool}
 */
bool inFrontOfWall() { return vEdgeDist < 0.0; }

/**
 * Does a threshold apply?
 * @returns {bool}
 */
bool thresholdApplies() {
  #ifdef EV_DIRECTIONAL_LIGHT
  return false;
  #else
  return uThresholdRadius2 != 0.0
    && distanceSquared(vVertexPosition, uLightPosition.xy) < fThresholdRadius2;
  #endif
}

void main() {
  // Assume no shadow as the default
  fragColor = noShadow();

  // Tests for within relevant bounds.
  if ( inFrontOfWall() ) return;
  if ( thresholdApplies() ) return;

  float shadow = 1.0;

  // Light is simply the absence of shadow.
  float totalLight = clamp(0.0, 1.0, 1.0 - shadow);
  fragColor = lightEncoding(totalLight);
}