#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Unsized Vertex ----- */

#define UNSIZED_SOURCE   true

in vec4 aWallCorner0;
in vec4 aWallCorner1;
in float aWallSenseType;
in float aThresholdRadius2;

out vec2 vVertexPosition;
out vec2 vTerrainTexCoord;
out float vEdgeDist;

flat out float fWallSenseType;
flat out float fThresholdRadius2;
flat out vec2 fWallHeights;
flat out vec2 fNearDistances;
flat out vec2 fFarDistances;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec3 uLightPosition;
uniform vec4 uSceneDims;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier

${defineStruct("Plane")}
${defineFunction("normalizedDirection")}
${defineFunction("intersectRayPlane")}
${defineFunction("distanceSquared")}
${defineFunction("distanceToLine")}

/* ----- NOTE: Functions used by Penumbra Vertex Functions ----- */

/**
 * Determine the closer and further endpoints.
 * @param {vec2[2]} pts
 * @returns {int} Index for the closer endpoint.
 */
int closerEndpoint(vec2[2] pts) {
  // Closer endpoint can be determined with relation to the light center.
  float d0 = distanceSquared(pts[0], uLightPosition.xy);
  float d1 = distanceSquared(pts[1], uLightPosition.xy);
  return int(d1 < d0);
}

${PENUMBRA_VERTEX_FUNCTIONS}

/* ----- NOTE: Functions dependent on by Penumbra Vertex Functions ----- */

/**
 * Define the triangle for the unsized source.
 * Defined as the lines from the source through each endpoint.
 * Either intersecting the canvas or infinite, which is set off at the canvas edge.
 * @param {Wall} wall
 * @returns {vec2[3]}
 */
vec2[3] definePenumbraTriangle(in Wall wall) {
  // return vec2[3](uLightPosition.xy, aWallCorner0.xy, aWallCorner0.xy);

  return shadowTriangle(uLightPosition, wall);
}

/**
 * Define additional varyings specific to this shader.
 * @param {Wall} wall
 * @param {vec2[3]} penumbraTri
 */
void defineVaryings(in Wall wall, in vec2[3] penumbraTri) {}

/**
 * Define additional flats specific to this shader.
 * @param {Wall} wall
 * @param {vec2[3]} penumbraTri
 */
void defineFlats(in Wall wall, in vec2[3] penumbraTri) {
  // @type {vec2} fFarDistances, fNearDistances, using UMBRA, PENUMBRA.
  // Distance from wall to the far penumbra/umbra and near penumbra/umbra.
  // 0.0 indicates no shadow.
  fFarDistances = vec2(0.0);
  fNearDistances = vec2(0.0);

  // The far penumbra shadow by definition is at the far penumbraTri edge.
  if ( !isInfiniteTopShadow(uLightPosition) ) {
    fFarDistances[PENUMBRA] = distanceToLine(penumbraTri[2], wall.top[0].xy, wall.direction);
  }

  // The near penumbra shadow depends on wall floating
  if ( wallIsFloating() && !isInfiniteBottomShadow(uLightPosition) ) {
    // Use closest wall point for the near shadow.
    vec3 ixP;
    furthestShadowPoint(uLightPosition, wall.bottom[0], ixP);
    fFarDistances[PENUMBRA] = distanceToLine(ixP.xy, wall.top[0].xy, wall.direction);
  }
  // For unsized light, no umbra shadow.
}

void main() {
  ${PENUMBRA_VERTEX_CALCULATIONS}
}