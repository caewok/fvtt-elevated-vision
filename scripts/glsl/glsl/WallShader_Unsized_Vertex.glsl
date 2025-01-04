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

${defineFunction("normalizedDirection")}

${PENUMBRA_VERTEX_FUNCTIONS}

/**
 * @returns {Wall}
 */
Wall calculateWallPositions() {
  vec2[2] endpointsXY = vec2[2](aWallCorner0.xy, aWallCorner1.xy);
  // int closerIdx = closerEndpoint(endpointsXY);
  int closerIdx = 0;
  vec2 xyCloser = endpointsXY[closerIdx];
  vec2 xyFurther = endpointsXY[1 - closerIdx];
  vec2 direction = normalizedDirection(xyCloser, xyFurther);
  float topZ = aWallCorner0.z;
  float bottomZ = aWallCorner1.z;
  return Wall(
    vec3[2](vec3(xyCloser, topZ), vec3(xyFurther, topZ)),
    vec3[2](vec3(xyCloser, bottomZ), vec3(xyFurther, bottomZ)),
    (xyCloser + xyFurther) * 0.5,
    direction
  );
}

/**
 * Define the triangle for the unsized source.
 * Defined as the lines from the source through each endpoint.
 * Either intersecting the canvas or infinite, which is set off at the canvas edge.
 * @param {Wall} wall
 * @returns {vec2[3]}
 */
vec2[3] definePenumbraTriangle(in Wall wall) {
  vec2 A = uLightPosition.xy;
  vec2 B;
  vec2 C;
  Ray lightRay = Ray(uLightPosition, normalizedDirection(uLightPosition, wall.top[0]));

  // TODO: If ramp, could be infinite only from one endpoint.
  int closerIdx = 0;
  Ray2d r1;
  if ( isInfiniteShadow(lightRay.direction) ) {
    Ray2d[2] lightRays2d = Ray2d[2](
      Ray2d(uLightPosition.xy, normalizedDirection(uLightPosition.xy, wall.top[0].xy)),
      Ray2d(uLightPosition.xy, normalizedDirection(uLightPosition.xy, wall.top[1].xy))
    );
    Ray2d canvasRay = infiniteShadowCanvasRay(lightRays2d); // @type Ray2d.

    // Go from closest endpoint to further endpoint.
    closerIdx = distanceSquared(wall.top[0].xy, uLightPosition.xy) < distanceSquared(wall.top[1].xy, uLightPosition.xy)
      ? 0 : 1;
    lineLineIntersection(
      canvasRay,
      Ray2d(uLightPosition.xy, normalizedDirection(uLightPosition.xy, wall.top[closerIdx].xy)),
      B);

  } else {
    // Use the canvas intersection.
    Plane canvasPlane = constructCanvasPlane();
    vec3 canvasIx;
    intersectRayPlane(lightRay, canvasPlane, canvasIx);
    // Could do r1 = lightRays[1].to2d() which would do Ray2d(r1.origin, r1.direction.xy.normalize());
    // or could retrieve closest endpoint every time. Maybe even when defining the wall.

    r1 = Ray2d(uLightPosition.xy, normalizedDirection(uLightPosition.xy, wall.top[1].xy));
    B = canvasIx.xy;
  }

  Ray2d canvasWallRay = Ray2d(B, wall.direction);
  int furtherIdx = 1 - closerIdx;
  r1 = Ray2d(uLightPosition.xy, normalizedDirection(uLightPosition.xy, wall.top[furtherIdx].xy));
  lineLineIntersection(canvasWallRay, r1, C);
  return vec2[3](A, B, C);
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