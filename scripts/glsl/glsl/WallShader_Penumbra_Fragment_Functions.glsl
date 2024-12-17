/* ----- NOTE: Penumbra Fragment Functions ----- */

// From CONST.WALL_SENSE_TYPES.
#define LIMITED_WALL      10.0
#define PROXIMATE_WALL    30.0
#define DISTANCE_WALL     40.0

// Enumerated parts of the shadow.
#define UMBRA                             0
#define MIDPENUMBRA                       2
#define PENUMBRA                          1
#define TOP                               0
#define BOTTOM                            1
#define FAR                               0
#define NEAR                              1

${defineFunction("terrainElevation")}
${defineFunction("between")}
${defineFunction("distanceSquared")}
${defineFunction("linearConversion")}
${defineFunction("barycentricPointInsideTriangle")}

/**
 * Encode the amount of light in the fragment color to accommodate limited walls.
 * Percentage light is used so 2+ shadows can be multiplied together.
 * For example, if two shadows each block 50% of the light, would expect 25% of light to get through.
 * @param {float} light   Percent of light for this fragment, between 0 and 1.
 * @returns {vec4}
 *   - r: percent light for a non-limited wall fragment
 *   - g: wall type: limited (1.0) or non-limited (0.5) (again, for multiplication: .5 * .5 = .25)
 *   - b: percent light for a limited wall fragment
 *   - a: unused (1.0)
 * @example
 * light = 0.8
 * r: (0.8 * (1. - ltd)) + ltd
 * g: 1. - (0.5 * ltd)
 * b: (0.8 * ltd) + (1. - ltd)
 * limited == 0: 0.8, 1.0, 1.0
 * limited == 1: 1.0, 0.5, 0.8
 *
 * light = 1.0
 * limited == 0: 1.0, 1.0, 1.0
 * limited == 1: 1.0, 0.5, 1.0
 *
 * light = 0.0
 * limited == 0: 0.0, 1.0, 1.0
 * limited == 1: 1.0, 0.5, 0.0
 */

// If not in shadow, need to treat limited wall as non-limited
vec4 noShadow() {
  #ifdef SHADOW
  return vec4(0.0);
  #endif
  return vec4(1.0);
}

vec4 lightEncoding(in float light) {
  if ( light == 1.0 ) return noShadow();

  float ltd = fWallSenseType == LIMITED_WALL ? 1.0 : 0.0;
  float ltdInv = 1.0 - ltd;

  #ifdef SHADOW
  // For testing, return the amount of shadow, which can be directly rendered to the canvas.
  // if ( light < 1.0 && light > 0.0 ) return vec4(0.0, 1.0, 0.0, 1.0);
  vec4 c = vec4(vec3(0.0), (1.0 - light) * 0.7);
  #endif

  #ifndef SHADOW
  vec4 c = vec4((light * ltdInv) + ltd, 1.0 - (0.5 * ltd), (light * ltd) + ltdInv, 1.0);
  #endif

  return c;
}

/**
 * Calculate the height fraction for elevating shadow ratios.
 */
float elevationHeightFraction(in float elevation, in float wallHeight) {
  float canvasElevation = uElevationRes.x;
  if ( elevation <= canvasElevation ) return 0.0;

  wallHeight = max(wallHeight - canvasElevation, 0.0);
  if ( wallHeight == 0.0 ) return 0.0;

  float elevationChange = elevation - canvasElevation;
  return elevationChange / wallHeight;
}

/**
 * Elevate given shadow ratios
 * Use a stored height fraction to avoid repetitive calcs.
 */
float elevateShadowRatio(in float ratio, in float wallRatio, in float heightFraction) {
  return ratio + (heightFraction * (wallRatio - ratio));
}

/**
 * Elevate the near ratios.
 * @returns {vec2[2]}
 */
vec2[2] elevateNearFarRatios() {

  vec2 farRatios = vec2(fFarRatios);
  vec2 nearRatios = vec2(fNearRatios);

  bool hasFar = any(notEqual(fFarRatios, vec2(-1.0)));
  bool hasNear = any(notEqual(fNearRatios, vec2(-1.0)));
  if ( hasFar || hasNear ) {
    farRatios = vec2(0.0);
    nearRatios = vec2(1.0);
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
        if ( fNearRatios[UMBRA] != -1.0 ) nearRatios[UMBRA] = elevateShadowRatio(nearRatios[UMBRA], fWallRatio, nearF);
        if ( fNearRatios[PENUMBRA] != -1.0 ) nearRatios[PENUMBRA] = elevateShadowRatio(nearRatios[PENUMBRA], fWallRatio, nearF);
      }
    }
  }
  vec2[2] res;
  res[NEAR] = nearRatios;
  res[FAR] = farRatios;
  return res;
}

/**
 * Is the fragment location in front of the wall?
 */
bool inFrontOfWall() { return vEdgeDist < 0.0; }

/**
 * Does a threshold apply?
 */
bool thresholdApplies() {
  #ifdef EV_DIRECTIONAL_LIGHT
  return false;
  #endif
  #ifndef EV_DIRECTIONAL_LIGHT
  return fThresholdRadius2 != 0.0
    && distanceSquared(vVertexPosition, uLightPosition.xy) < fThresholdRadius2;
  #endif
}
