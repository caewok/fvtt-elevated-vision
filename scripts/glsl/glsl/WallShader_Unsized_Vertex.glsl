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
out float vWallRatio;

flat out float fWallSenseType;
flat out float fThresholdRadius2;
flat out vec2 fWallHeights;
flat out float fWallRatio;
flat out vec2 fNearRatios;
flat out vec2 fFarRatios;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec3 uLightPosition;
uniform vec4 uSceneDims;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier

${defineStruct("Plane")}
${defineFunction("normalizedDirection")}
${defineFunction("intersectRayPlane")}
${defineFunction("distanceSquared")}

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
  return vec2[3](uLightPosition.xy, aWallCorner0.xy, aWallCorner0.xy);

  // return shadowTriangle(uLightPosition, wall);
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
  vec3 dirFar = wall.top[0] - uLightPosition;
  vec3 dirNear = wall.bottom[0] - uLightPosition;

  // Near/far ratios are same for PENUMBRA and UMBRA for unsized.
  if ( !isInfiniteShadow(dirFar) ) fFarRatios = vec2(0.0);
  if ( wallIsFloating() && !isInfiniteShadow(dirNear) ) {
    // Determine canvas intersection of the light ray running through wall midpoint.
    // See varyingWallRatio
    // The closer vertex to the wall gets assigned 0.0.
    float dist01 = distanceSquared(penumbraTri[0], penumbraTri[1]);
    float dist02 = distanceSquared(penumbraTri[0], penumbraTri[2]);
    int closerIdx = dist02 < dist01 ? 2 : 1;
    Ray2d lightRay2d = Ray2d(penumbraTri[0], normalizedDirection(penumbraTri[0], wall.mid));
    vec2 closerIx;
    lineLineIntersection(lightRay2d, Ray2d(penumbraTri[closerIdx], wall.direction), closerIx);

    vec3 wallBottomMid = vec3(wall.mid, wall.bottom[0].z);
    Ray lightRay = Ray(uLightPosition, normalizedDirection(uLightPosition, wallBottomMid));
    vec3 canvasIx;
    Plane canvasPlane = constructCanvasPlane();
    intersectRayPlane(lightRay, canvasPlane, canvasIx);

    // Could use distance(closerIx, canvasIx.xy) / distance(closerIx, penumbraTri[0]).
    // That has a square root but is simpler. Might need negative distance though.
    Ray2d wallRatioRay = Ray2d(closerIx, penumbraTri[0] - closerIx);
    float furtherT;
    lineLineIntersection(wallRatioRay, Ray2d(canvasIx.xy, wall.direction), furtherT);
    fNearRatios = vec2(furtherT);
  }
}

void main() {
  ${PENUMBRA_VERTEX_CALCULATIONS}
}