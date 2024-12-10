#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Sized Fragment 2 (LightRay sampling) ----- */

// #define SHADOW true

uniform sampler2D uTerrainSampler;
uniform vec3 uLightPosition;
uniform float uLightSize;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier

in vec2 vVertexPosition;
in vec2 vTerrainTexCoord;
in vec3 vPenumbra;
in vec3 vSidePenumbra0;
in vec3 vSidePenumbra1;
in vec3 vUmbra;
out float vEdgeDist;

flat in float fWallSenseType;
flat in float fThresholdRadius2;
flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in vec2 fWallRatios;
flat in vec2 fFarRatios0;
flat in vec2 fFarRatios1;
flat in vec2 fNearRatios0;
flat in vec2 fNearRatios1;
flat in vec2 fAmbient;

out vec4 fragColor;

${PENUMBRA_FRAGMENT_FUNCTIONS}

/**
 * Determine the shadow percentage.
 */
float shadowPercentage() {
  // Determine whether in near, far, side0, or side1.
  float far0Shadow = 1.0;
  float far1Shadow = 1.0;
  float near0Shadow = 1.0;
  float near1Shadow = 1.0;

  vec2 farRatios0 = vec2(fFarRatios0);
  vec2 farRatios1 = vec2(fFarRatios1);
  vec2 nearRatios0 = vec2(fNearRatios0);
  vec2 nearRatios1 = vec2(fNearRatios1);
  bool needsElevation = fFarRatios0[PENUMBRA] != -1.0 || fFarRatios0[UMBRA] != -1.0
                      || fFarRatios1[PENUMBRA] != -1.0 || fFarRatios1[UMBRA] != -1.0
                      || fNearRatios0[PENUMBRA] != -1.0 || fNearRatios0[UMBRA] != -1.0
                      || fNearRatios1[PENUMBRA] != -1.0 || fNearRatios1[UMBRA] != -1.0;

  if ( needsElevation ) {
    // Get the elevation at this fragment.
    float canvasElevation = uElevationRes.x;
    float elevation = terrainElevation(uTerrainSampler, vTerrainTexCoord, uElevationRes);
    if ( elevation != canvasElevation ) {
      float farF = elevationHeightFraction(elevation, fWallHeights[TOP]);
      float nearF = elevationHeightFraction(elevation, fWallHeights[BOTTOM]);

      if ( fFarRatios0[UMBRA] != -1.0 ) farRatios0[UMBRA] = elevateShadowRatios(fFarRatios0[UMBRA], fWallRatios[0], farF);
      if ( fFarRatios1[UMBRA] != -1.0 ) farRatios1[UMBRA] = elevateShadowRatios(fFarRatios1[UMBRA], fWallRatios[1], farF);
      if ( fFarRatios0[PENUMBRA] != -1.0 ) farRatios0[PENUMBRA] = elevateShadowRatios(fFarRatios0[PENUMBRA], fWallRatios[0], farF);
      if ( fFarRatios1[PENUMBRA] != -1.0 ) farRatios1[PENUMBRA] = elevateShadowRatios(fFarRatios1[PENUMBRA], fWallRatios[1], farF);
      if ( fNearRatios0[UMBRA] != -1.0 ) nearRatios0[UMBRA] = elevateShadowRatios(fNearRatios0[UMBRA], fWallRatios[0], nearF);
      if ( fNearRatios1[UMBRA] != -1.0 ) nearRatios1[UMBRA] = elevateShadowRatios(fNearRatios1[UMBRA], fWallRatios[1], nearF);
      if ( fNearRatios0[PENUMBRA] != -1.0 ) nearRatios0[PENUMBRA] = elevateShadowRatios(fNearRatios0[PENUMBRA], fWallRatios[0], nearF);
      if ( fNearRatios1[PENUMBRA] != -1.0 ) nearRatios1[PENUMBRA] = elevateShadowRatios(fNearRatios1[PENUMBRA], fWallRatios[1], nearF);
    }
  }

  // Determine the near/far penumbra inclusion.
  bool inNF0 = barycentricPointInsideTriangle(vNearFarPenumbra0);
  bool inNF1 = barycentricPointInsideTriangle(vNearFarPenumbra1);
  bool inFarPenumbra0 = inNF0 && between(farRatios0[PENUMBRA], farRatios0[UMBRA], vNearFarPenumbra0.x) == 1.0;
  bool inFarPenumbra1 = inNF1 && between(farRatios1[PENUMBRA], farRatios1[UMBRA], vNearFarPenumbra1.x) == 1.0;
  bool inNearPenumbra0 = inNF0 && between(nearRatios0[PENUMBRA], nearRatios0[UMBRA], vNearFarPenumbra0.x) == 1.0;
  bool inNearPenumbra1 = inNF1 && between(nearRatios1[PENUMBRA], nearRatios1[UMBRA], vNearFarPenumbra1.x) == 1.0;

  if ( inFarPenumbra0 ) far0Shadow = linearConversion(vNearFarPenumbra0.x, farRatios0[PENUMBRA], farRatios0[UMBRA], 0.0, 1.0);
  if ( inFarPenumbra0 ) far1Shadow = linearConversion(vNearFarPenumbra1.x, farRatios1[PENUMBRA], farRatios1[UMBRA], 0.0, 1.0);
  if ( inNearPenumbra1 ) near0Shadow = linearConversion(vNearFarPenumbra0.x, nearRatios0[PENUMBRA], nearRatios0[UMBRA], 0.0, 1.0);
  if ( inNearPenumbra1 ) near1Shadow = linearConversion(vNearFarPenumbra1.x, nearRatios1[PENUMBRA], nearRatios1[UMBRA], 0.0, 1.0);

  // Blend the two side penumbras if overlapping by multiplying the light amounts.
  if ( inSidePenumbra0() ) side0Shadow = vSidePenumbra0.z / (vSidePenumbra0.y + vSidePenumbra0.z);
  if ( inSidePenumbra1() ) side1Shadow = vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z);

  float percentUmbra = 1.0;
  if ( fAmbient[0] != 1.0 && fAmbient[1] != 1.0 ) {
    if ( inSidePenumbra0() ) side0Shadow *= fAmbient[0];
    if ( inSidePenumbra1() ) side1Shadow *= fAmbient[1];

    // Add in umbra shadow if any.
    if ( barycentricPointInsideTriangle(vUmbra) ) {
      float percentL = vUmbra.z / (vUmbra.y + vUmbra.z);
      percentUmbra = (percentL * (1.0 - percentL)) / 0.25; // 0.5 * 0.5 = 0.25; normalize to 1.0.
      float ambient = mix(fAmbient[0], fAmbient[1], percentL); // Blend b/c wall no longer fully blocks.
      percentUmbra *= ambient;
    }
  }

  return side0Shadow * side1Shadow *
    far0Shadow * far1Shadow *
    near0Shadow * near1Shadow *
    percentUmbra;
}

void main() {
  ${PENUMBRA_FRAGMENT_CALCULATIONS}
}