#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Directional Fragment ----- */

// #define SHADOW
#define EV_DIRECTIONAL_LIGHT true

uniform sampler2D uTerrainSampler;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier
uniform vec4 uSceneDims;

in vec2 vVertexPosition;
in vec2 vTerrainTexCoord;
in vec3 vPenumbra;
in vec3 vSidePenumbra0;
in vec3 vSidePenumbra1;
in vec3 vUmbra;
in float vEdgeDist;

flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in float fWallRatio;
flat in vec2 fNearRatios;
flat in float fFarRatio;
flat in float fWallSenseType;
flat in float fThresholdRadius2;
flat in vec2 fAmbient;

out vec4 fragColor;

${PENUMBRA_FRAGMENT_FUNCTIONS}

void main() {
  ${PENUMBRA_FRAGMENT_CALCULATIONS}
}