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

  // Limited wall: ltd = 1, ltdInv = 0; vec4(1.0, 0.5, light, 1.0)
  // Normal wall: ltd = 0, ltdInv = 1;  vec4(light, 1.0, 1.0, 1.0)

  return c;
}

/**
 * Elevation where the border between shadow and not shadow lies for this fragment.
 * @param {float} d               Distance to the wall for the furthest shadow point at canvas elevation
 * @param {int} wallHeightType    Relevant wall height (TOP or BOTTOM)
 * @returns {float}
 */
float _nearFarElevation(in float d, in int wallHeightType) {
  // Calculate using similar triangles.
  // - Elevation <--> wall height.
  // - Distance to max penumbra point <--> max penumbra point to wall.
  if ( d <= 0.0 ) return uElevationRes.x - 1.0; // canvasElevation
  float y = d - vEdgeDist;
  float wallH = fWallHeights[wallHeightType];
  return (wallH * y) / d;
}

/**
 * What is the elevation needed for this fragment to be out of the far shadow?
 * @returns {float}
 */
float farPenumbraElevation() { return _nearFarElevation(fFarDistances[PENUMBRA], TOP); }

/**
 * What is the elevation needed for this fragment to be in the far umbra shadow?
 * @returns {float}
 */
float farUmbraElevation() { return _nearFarElevation(fFarDistances[UMBRA], TOP); }

/**
 * What is the elevation needed for this fragment to be out of the far shadow?
 * @returns {float}
 */
float nearPenumbraElevation() { return _nearFarElevation(fNearDistances[PENUMBRA], BOTTOM); }

/**
 * What is the elevation needed for this fragment to be in the far umbra shadow?
 * @returns {float}
 */
float nearUmbraElevation() { return _nearFarElevation(fNearDistances[UMBRA], BOTTOM); }

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
