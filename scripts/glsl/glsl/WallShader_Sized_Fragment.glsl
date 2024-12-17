#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Sized Fragment ----- */

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
in float vEdgeDist;
in float vWallRatio;

flat in float fWallSenseType;
flat in float fThresholdRadius2;
flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in float fWallRatio;
flat in vec2 fFarRatios;
flat in vec2 fNearRatios;
flat in vec2 fAmbient;

out vec4 fragColor;

${PENUMBRA_FRAGMENT_FUNCTIONS}

/**
 * Is fragment inside the side penumbra, without regard to near/far limits.
 * @returns {bool}
 */
bool inSidePenumbra0() { return barycentricPointInsideTriangle(vSidePenumbra0); }

/**
 * Is fragment inside the side penumbra, without regard to near/far limits.
 * @returns {bool}
 */
bool inSidePenumbra1() { return barycentricPointInsideTriangle(vSidePenumbra1); }


/**
 * Determine the shadow percentage.
 */
float shadowPercentage() {
  // Default to 1.0 for parts that are not affecting the shadow.
  float farShadow = 1.0;
  float nearShadow = 1.0;
  float side0Shadow = 1.0;
  float side1Shadow = 1.0;
  float umbraShadow = 1.0;


  // If in the far or near shadow, blend between 0 (penumbra) and 1 (umbra).

  vec2[2] nfRatios = elevateNearFarRatios();
  vec2 farRatios = nfRatios[FAR];
  vec2 nearRatios = nfRatios[NEAR];
  if ( farRatios[PENUMBRA] != -1.0 && vWallRatio < farRatios[PENUMBRA] ) return 0.0;
  if ( nearRatios[PENUMBRA] != -1.0 && vWallRatio > nearRatios[PENUMBRA] ) return 0.0;

  if ( between(farRatios[PENUMBRA], farRatios[UMBRA], vWallRatio) == 1.0 ) {
    farShadow = linearConversion(vWallRatio, farRatios[PENUMBRA], farRatios[UMBRA], 0.0, 1.0);
  }
  if ( between(nearRatios[PENUMBRA], nearRatios[UMBRA], vWallRatio) == 1.0 ) {
    nearShadow = linearConversion(vWallRatio, nearRatios[PENUMBRA], nearRatios[UMBRA], 0.0, 1.0);
  }


  // Blend the two side penumbras if overlapping by multiplying the light amounts.
  if ( inSidePenumbra0() ) side0Shadow = vSidePenumbra0.z / (vSidePenumbra0.y + vSidePenumbra0.z);
  if ( inSidePenumbra1() ) side1Shadow = vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z);

  /*
  1.0 * 0.0 = 0.0  / 0.25 = 0       (1 - x) = 1.0
  0.9 * 0.1 = 0.09 / 0.25 = 0.0225  (1 - x) = 0.9775
  0.6 * 0.4 = 0.24 / 0.25 = 0.96    (1 - x) = 0.04
  0.5 * 0.5 = 0.25 / 0.25 = 1.0     (1 - x) = 0.0
  0.4 * 0.6 = 0.24 / 0.25 = 0.96    (1 - x) = 0.04
  0.1 * 0.9 = 0.09 / 0.25 = 0.0225  (1 - x) = 0.9775
  0.0 * 1.0 = 0.0  / 0.25 = 0       (1 - x) = 1.0
  */
  if ( fAmbient[0] != 1.0 && fAmbient[1] != 1.0 ) {
    if ( inSidePenumbra0() ) side0Shadow *= fAmbient[0];
    if ( inSidePenumbra1() ) side1Shadow *= fAmbient[1];

    // Add in umbra shadow if any.
    if ( barycentricPointInsideTriangle(vUmbra) ) {
      float percentL = vUmbra.z / (vUmbra.y + vUmbra.z);
      float percentR = 1.0 - percentL;
      umbraShadow = 1.0 - (percentL * percentR / 0.25); // 0.5 * 0.5 = 0.25; normalize to 1.0.
      float ambient = mix(fAmbient[0], fAmbient[1], percentL); // Blend b/c wall no longer fully blocks at umbra.
      // umbraShadow *= ambient;
    }
  }

  return side0Shadow * side1Shadow * farShadow * nearShadow * umbraShadow;
}

void main() {
  ${PENUMBRA_FRAGMENT_CALCULATIONS}
}