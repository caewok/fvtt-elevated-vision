#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Unsized Fragment ----- */

#define UNSIZED_SOURCE   true
// #define SHADOW true

uniform sampler2D uTerrainSampler;
uniform vec3 uLightPosition;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier

in vec2 vVertexPosition;
in vec2 vTerrainTexCoord;
in float vEdgeDist;
in vec3 vLeftRightEdgeBary;

flat in float fThresholdRadius2;
flat in float fWallSenseType;
flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in vec2 fNearDistances;
flat in vec2 fFarDistances;
flat in vec2 fFarLRDistances;
flat in vec2 fNearLRDistances;
flat in float fLeftRightWallDist;

out vec4 fragColor;

${PENUMBRA_FRAGMENT_FUNCTIONS}

/**
 * Determine the shadow percentage.
 * @returns {float}
 */
float shadowPercentage() {
  return 1.0;

  bool hasFar = fFarDistances[PENUMBRA] != 0.0;
  bool hasNear = fNearDistances[PENUMBRA] != 0.0;
  if ( !(hasFar || hasNear) ) return 1.0;

  float canvasElevation = uElevationRes.x;
  float elevation = terrainElevation(uTerrainSampler, vTerrainTexCoord, uElevationRes);

  if ( elevation > farPenumbraElevation() ) return 0.0;
  if ( elevation > nearPenumbraElevation() ) return 0.0;
  return 1.0;
}

void main() {
  ${PENUMBRA_FRAGMENT_CALCULATIONS}
}
