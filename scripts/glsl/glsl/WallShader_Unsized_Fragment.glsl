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

flat in float fThresholdRadius2;
flat in float fWallSenseType;
flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in float fWallRatio;
flat in float fFarRatio;
flat in float fNearRatio;

out vec4 fragColor;

${PENUMBRA_FRAGMENT_FUNCTIONS}

void main() {
  ${PENUMBRA_FRAGMENT_CALCULATIONS}
}