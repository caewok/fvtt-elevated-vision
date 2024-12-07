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
flat out float fWallRatio;
flat out float fFarRatio;
flat out float fNearRatio;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec3 uLightPosition;
uniform vec4 uSceneDims;
uniform vec4 uElevationRes; // min, step, maxpixel, multiplier

${defineFunction("normalizedDirection")}

${PENUMBRA_VERTEX_FUNCTIONS}

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
  Ray2d[2] lightRays = Ray2d[2](
    Ray2d(uLightPosition.xy, normalizedDirection(uLightPosition.xy, wall.top[0].xy)),
    Ray2d(uLightPosition.xy, normalizedDirection(uLightPosition.xy, wall.top[1].xy))
  );
  vec2 wallDir2d = normalizedDirection(wall.top[0].xy, wall.top[1].xy);

  // TODO: If ramp, could be infinite only from one endpoint.
  int closerIdx = 0;
  Ray2d r1;
  if ( isInfiniteShadow(lightRays[0].direction) ) {
    Ray2d canvasRay = infiniteShadowCanvasRay(lightRays); // @type Ray2d.

    // Go from closest endpoint to further endpoint.
    closerIdx = distanceSquared(wall.top[0].xy, uLightPosition.xy) < distanceSquared(wall.top[1].xy, uLightPosition.xy)
      ? 0 : 1;
    lineLineIntersection(
      canvasRay,
      Ray2d(uLightPosition.xy, normalizedDirection(uLightPosition.xy, wall.top[closerIdx].xy)),
      B);

  } else {
    // Use the canvas intersection.
    vec3 canvasIx;
    intersectRayPlane(lightRays[0], this.canvasPlane, canvasIx);
    // Could do r1 = lightRays[1].to2d() which would do Ray2d(r1.origin, r1.direction.xy.normalize());
    // or could retrieve closest endpoint every time. Maybe even when defining the wall.

    r1 = Ray2d(uLightPosition.xy, normalizedDirection(uLightPosition.xy, wall.top[1].xy));
    B = canvasIx.xy;
  }

  Ray2d canvasWallRay = Ray2d(B, wallDir2d);
  r1 = Ray2d(uLightPosition, normalizedDirection(uLightPosition.xy, wall.top[1 - closerIdx].xy));
  lineLineIntersection(canvasWallRay, r1, C);
  return vec2[3](A, B, C);
}


/**
 * Define flat variables.
 * Calculate the flat variables, including near/far ratios.
 * @param {vec2[3]} penumbraTri
 * @param {Wall} wall
 */
void defineFlats(in vec2[3] penumbraTri, in Wall wall) {
  // @type {vec2} fWallHeights
  fWallHeights = vec2();
  fWallHeights[TOP] = wall.top[0].z;
  fWallHeights[BOTTOM] = wall.bottom[0].z;

  // @type {float} fWallRatio
  fWallRatio = baryForPoint(wall.top[0].xy, penumbraTri).x;

  // @type {float} fFarRatio. -1 if none.
  fFarRatio = uLightPosition.z > wall.top[0].z ? 0.0 : -1.0;

  // @type {float} fNearRatio. -1 if none.
  fNearRatio = -1.0;
  if ( wallIsFloating() ) {
    Plane canvasPlane = constructCanvasPlane();
    vec3 wallBottomMid = (wall.bottom[0] + wall.bottom[1]) * 0.5;
    vec3 canvasIx;
    intersectRayPlane(Ray(uLightPosition, normalizedDirection(uLightPosition, wallBottomMid)), canvasPlane, canvasIx);
    Ray2d wallRay = Ray2d(wall.top[0].xy, normalizedDirection(wall.top[0].xy, wall.top[1].xy));
    Ray2d penumbra0Ray = Ray2d(penumbraTri[0], normalizedDirection(penumbraTri[0], penumbraTri[1]));
    vec2 ix;
    lineLineIntersection(wallRay, penumbra0Ray, ix);
    fNearRatio = baryForPoint(ix, penumbraTri).x;
  }
}

void main() {
  ${PENUMBRA_VERTEX_CALCULATIONS}

  if ( vertexNum == 2 ) defineFlats(penumbraTri, wall);
}