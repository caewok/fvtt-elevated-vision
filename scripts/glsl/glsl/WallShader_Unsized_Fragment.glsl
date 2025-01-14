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
in float vWallRatio;

flat in float fThresholdRadius2;
flat in float fWallSenseType;
flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in float fWallRatio;
flat in vec2 fNearRatios;
flat in vec2 fFarRatios;

out vec4 fragColor;

${PENUMBRA_FRAGMENT_FUNCTIONS}

/**
 * Determine the shadow percentage.
 * @returns {float}
 */
float shadowPercentage() {
  return 1.0;
  bool hasFar = any(notEqual(fFarRatios, vec2(-1.0)));
  bool hasNear = any(notEqual(fNearRatios, vec2(-1.0)));
  if ( hasFar || hasNear ) {
    vec2 farRatios = vec2(0.0);
    vec2 nearRatios = vec2(1.0);
    float canvasElevation = uElevationRes.x;
    float elevation = terrainElevation(uTerrainSampler, vTerrainTexCoord, uElevationRes);
    if ( elevation != canvasElevation ) {
      if ( hasFar ) {
        float farF = elevationHeightFraction(elevation, fWallHeights[TOP]);
        if ( fFarRatios[UMBRA] != -1.0 ) farRatios[UMBRA] = elevateShadowRatio(farRatios[UMBRA], fWallRatio, farF);
        if ( fFarRatios[PENUMBRA] != -1.0 ) farRatios[PENUMBRA] = elevateShadowRatio(farRatios[PENUMBRA], fWallRatio, farF);
      }
      if ( hasNear ) {
        float nearF = elevationHeightFraction(elevation, fWallHeights[BOTTOM]);
        if ( fNearRatios[UMBRA] != -1.0 ) nearRatios[UMBRA] = elevateShadowRatio(fNearRatios[UMBRA], fWallRatio, nearF);
        if ( fNearRatios[PENUMBRA] != -1.0 ) nearRatios[PENUMBRA] = elevateShadowRatio(fNearRatios[PENUMBRA], fWallRatio, nearF);
      }
    }
    if ( vWallRatio < farRatios[UMBRA] ) return 0.0;
    if ( vWallRatio < farRatios[PENUMBRA] ) return 0.0;
    if ( vWallRatio > nearRatios[UMBRA] ) return 0.0;
    if ( vWallRatio > nearRatios[PENUMBRA] ) return 0.0;
  }
  return 1.0;
}


void main() {
  ${PENUMBRA_FRAGMENT_CALCULATIONS}
}