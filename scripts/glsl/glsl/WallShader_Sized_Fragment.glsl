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
in float vLREdgeDist;

flat in float fWallSenseType;
flat in float fThresholdRadius2;
flat in vec2 fWallHeights; // topZ to canvas bottom, bottomZ to canvas bottom
flat in vec2 fFarDistances;
flat in vec2 fNearDistances;
flat in vec2 fAmbient;
flat in vec2 fFarRLPenumbraDistances;
flat in vec2 fFarRLUmbraDistances;
flat in vec2 fNearRLPenumbraDistances;
flat in vec2 fNearRLUmbraDistances;

out vec4 fragColor;

${defineFunction("interpolateBarycentric")}
${defineFunction("almostEqual")}

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
  float farLShadow = 1.0;
  float farRShadow = 1.0;
  float nearLShadow = 1.0;
  float nearRShadow = 1.0;

  float farPenumbraDist = fFarDistances[PENUMBRA];
  float farUmbraDist = fFarDistances[UMBRA];
  float nearPenumbraDist = fNearDistances[PENUMBRA];
  float nearUmbraDist = fNearDistances[UMBRA];

  float farLPenumbraDist = fFarRLPenumbraDistances[LEFT];
  float farLUmbraDist = fFarRLUmbraDistances[LEFT];
  float nearLPenumbraDist = fNearRLPenumbraDistances[LEFT];
  float nearLUmbraDist = fNearRLUmbraDistances[LEFT];
  float farRPenumbraDist = fFarRLPenumbraDistances[RIGHT];
  float farRUmbraDist = fFarRLUmbraDistances[RIGHT];
  float nearRPenumbraDist = fNearRLPenumbraDistances[RIGHT];
  float nearRUmbraDist = fNearRLUmbraDistances[RIGHT];

  /*
  if ( vLREdgeDist > 200.0 ) return 0.10;
  if ( vLREdgeDist > 100.0  ) return 0.25;
  if ( vLREdgeDist > 50.0  ) return 0.4;
  if ( vLREdgeDist > 0.0 ) return 0.5;
  if ( almostEqual(vLREdgeDist, 0.0, 1.0) ) return 1.0;
  if ( vLREdgeDist > -50.0  ) return 0.6;
  if ( vLREdgeDist > -100.0  ) return 0.75;
  if ( vLREdgeDist > -200.0  ) return 0.9;
  return 1.0;
  */

  // penumbra: 158.47547912597656, 302.0068664550781
  // umbra: 83.15863037109375, 158.47547912597656

  // return farLPenumbraDist < 158.4 ? .2 : farLPenumbraDist > 158.5 ? 0.7 : 1.0;
  //return farRPenumbraDist < 158.0 ? .2 : farRPenumbraDist > 159.0 ? 0.7 : 1.0;
  // return vLREdgeDist > 0.0 ? 1.0 : 0.5; // positive on left side
  // return farRPenumbraDist > 376.0 ? 1.0 : 0.5; // between 375 and 376
  // return farLPenumbraDist > 26.0 ? 1.0 : 0.5; // 0.0 Left: 375.51123046875, right: 25.40869140625 (between 25 and 26)
  // return farLUmbraDist > 9.0 ? 1.0 : 0.5; // 0.0 Left: 137.99560546875, right: 9.337370872497559 (between 9 and 10)
  // Penumbra RL: 83.301513671875, 327.778564453125
  // Umbra RL: 24.656877517700195, 97.02099609375
  bool isCollinear = fAmbient[0] * fAmbient[1] != 0.0;
  bool isLeft = vLREdgeDist > 0.0;
  bool hasFar = any(notEqual(fFarDistances, vec2(0.0)));
  bool hasNear = any(notEqual(fNearDistances, vec2(0.0)));
  if ( hasFar || hasNear ) {
    float canvasElevation = uElevationRes.x;
    float elevation = terrainElevation(uTerrainSampler, vTerrainTexCoord, uElevationRes);

    //if ( elevation > farPenumbraElevation() ) return 0.0;
    //if ( elevation > nearPenumbraElevation() ) return 0.0;

    farPenumbraDist = farPenumbraDistance(elevation);
    if ( hasFar && vEdgeDist > farPenumbraDist ) return 0.0; // Outside the penumbra.

    nearPenumbraDist = nearPenumbraDistance(elevation);
    if ( hasNear && !isCollinear && vEdgeDist < nearPenumbraDist ) return 0.0; // In front of the wall shadow.

    farUmbraDist = farUmbraDistance(elevation);
    nearUmbraDist = nearUmbraDistance(elevation);

    farLPenumbraDist = farLPenumbraDistance(elevation);
    if ( isLeft && isCollinear && farLPenumbraDist != 0.0 && vLREdgeDist > farLPenumbraDist ) return 0.0; // Outside the penumbra.

    farRPenumbraDist = farRPenumbraDistance(elevation);
    if ( !isLeft && isCollinear && farRPenumbraDist != 0.0 && -vLREdgeDist > farRPenumbraDist ) return 0.0; // Outside the penumbra.

    nearLPenumbraDist = nearLPenumbraDistance(elevation);
    nearRPenumbraDist = nearRPenumbraDistance(elevation);
    farLUmbraDist = farLUmbraDistance(elevation);
    farRUmbraDist = farRUmbraDistance(elevation);
    nearLUmbraDist = nearLUmbraDistance(elevation);
    nearRUmbraDist = nearRUmbraDistance(elevation);
  }
  // return 1.0;

  /*
  if ( vLREdgeDist > farLPenumbraDist ) return 0.10;
  //if ( vLREdgeDist < -farLPenumbraDist ) return 0.20;
  if ( vLREdgeDist > farLUmbraDist ) return 0.5;
  // if ( vLREdgeDist < -farLUmbraDist ) return 0.6;
  if ( -vLREdgeDist > farRPenumbraDist ) return 0.10;
  if ( -vLREdgeDist > farRUmbraDist) return 0.5;

  return 1.0;
  */

  /*
  vLREdgeDist = 200
  farLPenumbraDist = 150
  vLREdgeDist = 100
  farLUmbraDist = 50
  vLREdgeDist = 50

  200, 150, 50, 0, 1
  clamp(linearConversion(vLREdgeDist, farLPenumbraDist, farLUmbraDist, 0.0, 1.0), 0.0, 1.0); 100, 150, 50, 0, 1  => clamp(.5) => .5
  clamp(linearConversion(vLREdgeDist, farRPenumbraDist, farRUmbraDist, 0.0, 1.0), 0.0, 1.0); -100, 150, 50, 0, 1 => clamp(2.5) => 2.5


  vLREdgeDist = -200
  farRPenumbraDist = 150
  vLREdgeDist = -100
  farRUmbraDist = 50
  vLREdgeDist = -50
  clamp(linearConversion(vLREdgeDist, farLPenumbraDist, farLUmbraDist, 0.0, 1.0), 0.0, 1.0); -100, 150, 50, 0, 1 => clamp(2.5) => 1
  clamp(linearConversion(vLREdgeDist, farRPenumbraDist, farRPenumbraDist, 0.0, 1.0), 0.0, 1.0); 100, 150, 50, 0, 1 => clamp(.5) = .5
  */



  /*
  if ( vLREdgeDist > farRPenumbraDist ) return 0.10;
  if ( vLREdgeDist < -farRPenumbraDist ) return 0.20;
  if ( vLREdgeDist > farRUmbraDist ) return 0.5;
  if ( vLREdgeDist < -farRUmbraDist ) return 0.6;
  return 1.0;
  */

  /*
  if ( vEdgeDist > farPenumbraDist ) return 0.10;
  if ( vEdgeDist > farUmbraDist ) return 0.5;
  return 1.0;
  */

  // If in the far or near shadow, blend between penumbra (0) and umbra (1).
  // If in the far or near left/right shadow, blend between penumbra (0) and umbra (1).
  if ( hasFar ) {
    farShadow = clamp(linearConversion(vEdgeDist, farPenumbraDist, farUmbraDist, 0.0, 1.0), 0.0, 1.0);
    if ( isCollinear ) {
      // return vLREdgeDist > 50.0 ? 1.0 : 0.5; // ~ 50
      // return farLPenumbraDist > 8.0 ? 1.0 : 0.5; // 0.0 Left: 375.51123046875, right: 25.40869140625 (between 7 and 8)
      // return farLUmbraDist > 2.0 ? 1.0 : 0.5; // 0.0 Left: 137.99560546875, right: 9.337370872497559 (between 2 and 3)
      // return linearConversion(-vLREdgeDist, farRPenumbraDist, farRUmbraDist, 0.0, 1.0) == 0.0 ? 1.0 : 0.5; // 0.0
      if ( isLeft ) {
        farLShadow = (farLPenumbraDist == 0.0 && farLUmbraDist == 0.0)
          ? 1.0 : clamp(linearConversion(vLREdgeDist, farLPenumbraDist, farLUmbraDist, 0.0, 1.0), 0.0, 1.0);
      } else {
        farRShadow = (farRPenumbraDist == 0.0 && farRUmbraDist == 0.0)
          ? 1.0 : clamp(linearConversion(-vLREdgeDist, farRPenumbraDist, farRUmbraDist, 0.0, 1.0), 0.0, 1.0);
      }

      // vLREdgeDist = -59.00000150166488
      // farRPenumbraDist = 0
      // farRUmbraDist = 0
    }
  }

  if ( hasNear ) {
    nearShadow = clamp(linearConversion(vEdgeDist, nearPenumbraDist, nearUmbraDist, 0.0, 1.0), 0.0, 1.0);
    if ( isCollinear ) {
      if ( isLeft ) {
        nearLShadow = (nearLPenumbraDist == 0.0 && nearLPenumbraDist == 0.0)
          ? 1.0 : clamp(linearConversion(vLREdgeDist, nearLPenumbraDist, nearLPenumbraDist, 0.0, 1.0), 0.0, 1.0);
      } else {
        nearRShadow = (nearRPenumbraDist == 0.0 && nearRPenumbraDist == 0.0)
          ? 1.0 : clamp(linearConversion(-vLREdgeDist, nearRPenumbraDist, nearRPenumbraDist, 0.0, 1.0), 0.0, 1.0);
      }
    }
  }

  // Blend the two side penumbras if overlapping by multiplying the light amounts.
  // Needs to be 1.0 if outside the penumbra.
  // if ( inSidePenumbra0() ) side0Shadow = vSidePenumbra0.z / (vSidePenumbra0.y + vSidePenumbra0.z);
  // if ( inSidePenumbra1() ) side1Shadow = vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z);
  float inSide0 = float(inSidePenumbra0());
  float inSide1 = float(inSidePenumbra1());
  float denom0 = vSidePenumbra0.y + vSidePenumbra0.z;
  float denom1 = vSidePenumbra1.y + vSidePenumbra1.z;
  side0Shadow = almostEqual(denom0, 0.0, 1.0e-08) ? 1.0 : (inSide0 * vSidePenumbra0.z / denom0) + (1.0 - inSide0);
  side1Shadow = almostEqual(denom1, 0.0, 1.0e-08) ? 1.0 : (inSide1 * vSidePenumbra1.z / denom1) + (1.0 - inSide1);

  // side1Shadow = inSide1 == 1.0 ? 0.5 : 0.0;

  /*
  1.0 * 0.0 = 0.0  / 0.25 = 0       (1 - x) = 1.0
  0.9 * 0.1 = 0.09 / 0.25 = 0.0225  (1 - x) = 0.9775
  0.6 * 0.4 = 0.24 / 0.25 = 0.96    (1 - x) = 0.04
  0.5 * 0.5 = 0.25 / 0.25 = 1.0     (1 - x) = 0.0
  0.4 * 0.6 = 0.24 / 0.25 = 0.96    (1 - x) = 0.04
  0.1 * 0.9 = 0.09 / 0.25 = 0.0225  (1 - x) = 0.9775
  0.0 * 1.0 = 0.0  / 0.25 = 0       (1 - x) = 1.0
  */


  if ( isCollinear ) {
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


  // return side1Shadow;
  // return farShadow * nearShadow;
  // return farLShadow * nearLShadow * farRShadow * nearRShadow;
  // return side0Shadow * side1Shadow;
  // return farShadow * nearShadow;

  return side0Shadow * side1Shadow
    * farShadow * nearShadow
    * farLShadow * nearLShadow * farRShadow * nearRShadow
    * umbraShadow;
}

void main() {
  ${PENUMBRA_FRAGMENT_CALCULATIONS}
}