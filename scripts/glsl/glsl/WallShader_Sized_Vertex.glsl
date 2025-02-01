#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Sized Vertex ----- */

in vec4 aWallCorner0;
in vec4 aWallCorner1;
in float aWallSenseType;
in float aThresholdRadius2;

out vec2 vVertexPosition;
out vec2 vTerrainTexCoord;
out vec3 vPenumbra;
out vec3 vSidePenumbra0;
out vec3 vSidePenumbra1;
out vec3 vUmbra;
out float vEdgeDist;
out float vLREdgeDist;

flat out float fWallSenseType;
flat out float fThresholdRadius2;
flat out vec2 fWallHeights; // r: topZ to canvas bottom; g: bottomZ to canvas bottom
flat out vec2 fAmbient;
flat out vec2 fNearDistances;
flat out vec2 fFarDistances;
flat out vec2 fFarRLPenumbraDistances;
flat out vec2 fFarRLUmbraDistances;
flat out vec2 fNearRLPenumbraDistances;
flat out vec2 fNearRLUmbraDistances;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec4 uElevationRes;
uniform vec3 uLightPosition;
uniform float uLightSize;
uniform vec4 uSceneDims;

${defineStruct("Plane")}
${defineFunction("intersectRayPlane")}
${defineFunction("normalizedDirection")}
${defineStruct("Circle")}
${defineFunction("tangentPoints")}
${defineFunction("sameSide")}
${defineFunction("closest2dPointToSegment")}
${defineFunction("circleContainsPoint")}
${defineFunction("quadraticIntersection")}
${defineFunction("distanceSquared")}
${defineFunction("projectRayDistanceSquared")}
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

/**
 * Shrink wall to avoid overlap with light.
 * If a wall endpoint is within the light and the light center is not between the
 * endpoints, shrink the wall so it is just outside the light.
 * This avoids the light failing to display if overlapping the wall to the right/left.
 * If between the endpoints, calculateSideShadowRays will move the light accordingly.
 * @param {inout Wall} wall
 */
void shrinkOverlappingWall(inout Wall wall) {
  vec2[2] ixs;
  int numIxs = quadraticIntersection(wall.top[0].xy, wall.top[1].xy, uLightPosition.xy, uLightSize, 1.0e-06, ixs);
  if ( numIxs == 1 ) {
    // Determine where the intersection is on the wall. By definition, it is the closer endpoint.
    // const containedIdx = circleContainsPoint(uLightPosition.xy, uLightSize, endpointsXY[0]) ? 0 : 1;

    // Move pixel away to be outside the circle.
    vec2 newIx = projectRay(rayFromDirection(ixs[0], normalizedDirection(ixs[0], wall.top[1].xy)), 1.0);

    // Update wall data.
    wall.top[0].xy = newIx.xy;
    wall.bottom[0].xy = newIx.xy;
    wall.mid = (wall.top[0].xy + wall.top[1].xy) * 0.5;
    wall.direction = normalizedDirection(wall.top[0].xy, wall.top[1].xy);
  }
}

/**
 * Calculate the vertical tangents for the light sphere from a given point.
 * @param {vec3} pt
 * @param {out vec3[2]} tangents
 * @returns {bool} true if tangents
 */
bool verticalTangents(in vec3 pt, out vec3[2] tangents) {
  return verticalTangentPoints(pt, uLightPosition, uLightSize, tangents);
}


/**
 * Offset the circle center from the wall by some distance.
 * If collinear with the wall, move in the direction of the wall but keep collinearity.
 * If non-collinear with the wall, move away from wall.
 * @param {Light} light
 * @param {Wall} wall
 * @param {float} d
 * @returns {vec2} New circle center
 */
vec2 offsetLightFromWall(in Wall wall, in float d) {
  return projectRay(rayFromDirection(uLightPosition.xy, vec2(wall.direction.y, -wall.direction.x)), d);
}

/**
 * Calculate the horizontal tangents for the light sphere from a given point.
 * @param {vec2} pt
 * @param {out vec3[2]} tangents
 * @returns {bool} true if tangents
 */
bool horizontalTangents(in Wall wall, in vec2 pt, out vec2[2] tangents) {
  Circle lightCir = Circle(
    uLightPosition.xy,  // Center
    uLightSize          // Radius
  );

  // If the light overlaps the wall, the penumbra shoot straight out along the wall.
  // Shrinking the light to be just smaller than distance to wall.
  float distToWall = distanceToSegment(uLightPosition.xy, wall.top[0].xy, wall.top[1].xy);
  if ( distToWall <= uLightSize ) {
    lightCir.radius = max(distToWall - 1.0, 0.0);
    if ( almostEqual(distToWall, 0.0, 1.0e-06) ) lightCir.center = offsetLightFromWall(wall, 0.5);
  }
  return tangentPoints(lightCir, pt, tangents);
}

/**
 * Given ∆ABC, make it isoceles by extending the shorter edge of AB or AC.
 * @param {vec2[3]} tri
 * @returns {vec2[3]} tri
 */
vec2[3] makeIsoceles(in vec2[3] tri) {
  vec2 a = tri[0];
  vec2 b = tri[1];
  vec2 c = tri[2];
  float dist2AB = distanceSquared(a, b);
  float dist2AC = distanceSquared(a, c);
  if ( almostEqual(dist2AB, dist2AC, 1.0e-08) ) return tri;
  if ( dist2AB > dist2AC ) {
    Ray2d r = rayFromDirection(a, normalizedDirection(a, c));
    return vec2[3](
      a,
      b,
      projectRayDistanceSquared(r, dist2AB)
    );
  } else { // BC distance is larger.
    Ray2d r = rayFromDirection(a, normalizedDirection(a, b));
    return vec2[3](
      a,
      projectRayDistanceSquared(r, dist2AC),
      c
    );
  }
}

/**
 * Direction from light --> wall endpoint. Origin at the wall endpoint.
 * @param {Wall} wall
 * @returns {ShadowRays2d} Rays from the endpoint away from the light for umbra, mid, and penumbra.
 */
ShadowRays2d calculateSideShadowRays(in Wall wall) {
  vec2 W0 = wall.top[0].xy;
  vec2 W1 = wall.top[1].xy;

  // 4 tangent points: 2 from each wall endpoint.
  vec2[2] tangents0 = vec2[2](uLightPosition.xy, uLightPosition.xy);
  vec2[2] tangents1 = vec2[2](uLightPosition.xy, uLightPosition.xy);
  horizontalTangents(wall, W0, tangents0);
  horizontalTangents(wall, W1, tangents1);

  // Each tangent point -> wall endpoint creates one of the 4 side shadow rays.
  // t00: tangent --> W0; t01: tangent --> W0
  // t10: tangent --> W1; t11: tangent --> W1
  // t00 x t01 at W0 by definition.
  // t10 x t11 at W1 by definition.
  Ray2d[2] r0 = Ray2d[2](
    rayFromDirection(W0, normalizedDirection(tangents0[0], W0)),
    rayFromDirection(W0, normalizedDirection(tangents0[1], W0))
  );
  Ray2d[2] r1 = Ray2d[2](
    rayFromDirection(W1, normalizedDirection(tangents1[0], W1)),
    rayFromDirection(W1, normalizedDirection(tangents1[1], W1))
  );

  // If near-collinear:
  // t00 and t01 are on opposite sides of the wall line.
  // t10 and t11 are on opposite sides of the wall line.

  // If not near-collinear
  // t00 and t01 are on same sides of the wall line.
  // t00 and t01 are on same sides of the wall line.
  vec2 p00 = projectRay(r0[0], 100.0);
  vec2 p01 = projectRay(r0[1], 100.0);
  vec2 p10 = projectRay(r1[0], 100.0);
  vec2 p11 = projectRay(r1[1], 100.0);

  float o00 = orient(W1, W0, p00);
  float o01 = orient(W1, W0, p01);
  float o10 = orient(W0, W1, p10);
  float o11 = orient(W0, W1, p11);
  bool isCollinear = OPP_SIDE(o00, o01) || OPP_SIDE(o10, o11); // Either could be 0.0.
  Ray2d[2] penumbra;
  Ray2d[2] umbra;
  if ( isCollinear ) {
    // W0 intersection is penumbra; W1 intersection is umbra.
    penumbra = r0;
    umbra = r1;
  } else {
    // Umbra for W0 is on same side as W1 for light center --> W0.
    float oW1 = orient(uLightPosition.xy, W0, W1);
    float ol00 = orient(uLightPosition.xy, W0, p00);
    float ol01 = orient(uLightPosition.xy, W0, p01);
    int pIdx0 = int(SAME_SIDE(ol01, oW1) || OPP_SIDE(ol00, oW1));
    umbra[0] = r0[pIdx0];
    penumbra[0] = r0[1 - pIdx0];

    // Umbra for W1 is on same side as W0 for light center --> W1.
    float oW0 = orient(uLightPosition.xy, W1, W0);
    float ol10 = orient(uLightPosition.xy, W1, p10);
    float ol11 = orient(uLightPosition.xy, W1, p11);
    int pIdx1 = int(SAME_SIDE(ol11, oW0) || OPP_SIDE(ol10, oW0));
    umbra[1] = r1[pIdx1];
    penumbra[1] = r1[1 - pIdx1];
  }

  // If light center is on the wall, offset.
  // TODO: Do this for umbra and penumbra?
  /*
  float distToWall = distanceToSegment(uLightPosition.xy, W0, W1);
  vec3 lightCenter = almostEqual(distToWall, 0.0, 1.0e-06)
    ? vec3(offsetLightFromWall(wall, 0.5), uLightPosition.z) : uLightPosition;
  Ray2d[2] midpenumbra = Ray2d[2](
    rayFromDirection(W0, normalizedDirection(lightCenter.xy, W0)),
    rayFromDirection(W1, normalizedDirection(lightCenter.xy, W1))
  );
  */

  // If a linked wall is present, use its direction for the penumbra and umbra.
  // If in-between mid and penumbra, change umbra and mid.
  const int UNBLOCKED = int(EV_ENDPOINT_LINKED_UNBLOCKED);
  const int BLOCKED = int(EV_ENDPOINT_LINKED_BLOCKED);
  const int BETWEEN_UP = 1;
  for ( int i = 0; i < 2; i += 1 ) {
    vec2 W = wall.top[i].xy;
    vec2 WO = wall.top[1 - i].xy;
    int linkStatus = int(wall.linkValues[i]);
    if ( linkStatus != UNBLOCKED ) {
      vec2 linkPt = fromAngle(W, wall.linkValues[i], 1.0);
      vec2 umbraPt = projectRay(umbra[i], 1.0);
      float oLight = orient(W, WO, uLightPosition.xy);
      float oLinked = orient(W, WO, linkPt);
      float oUmbra = orient(W, umbraPt, linkPt);

      if ( SAME_SIDE(oLight, oLinked) ) {
        // Negative penumbra and negative umbra are the points on the light side of the wall.
        // Wall <--> negative penumbra <--> negative umbra <--> wall line on other side of W0.
        // If between negative umbra and other side of W0, the linked wall blocks completely.
        // If between negative penumbra and negative umbra, linked wall is collinear and partially blocks.
        //   - Should set fAmbient for this situation, but probably doesn't matter much.
        if ( SAME_SIDE(oLinked, -oUmbra) ) linkStatus = BLOCKED;
        else linkStatus = UNBLOCKED;
      } else {
        // Wall <--> umbra <--> mid <--> penumbra <--> wall line on other side of W0.
        vec2 penumbraPt = projectRay(penumbra[i], 1.0);
        float oPenumbra = orient(W, penumbraPt, linkPt);
        if ( SAME_SIDE(oLinked, oPenumbra) ) linkStatus = BLOCKED;
        else if ( SAME_SIDE(oLinked, oUmbra) ) linkStatus = BETWEEN_UP;
        else linkStatus = UNBLOCKED;
      }

      switch ( linkStatus ) {
        case BLOCKED: {
          umbra[i] = penumbra[i];
          break;
        }
        case BETWEEN_UP: {
          umbra[i] = rayFromDirection(W, normalizedDirection(W, linkPt));
          break;
        }
      }
    }
  }

  return ShadowRays2d(
    umbra,
    penumbra
  );
}

/**
 * For infinite shadow, construct the different points of the triangle.
 * @param {ShadowRays2d} sideShadowRays
 * @param {ShadowDirections} farShadowDirs
 * @param {Wall} wall
 * @param {out vec2} A...I, W0, W1
 * @returns {bool} True if nearly collinear wall to the light.
 */
bool shadowPoints(in Wall wall, in ShadowRays2d sideShadowRays, in vec2[3] farPenumbraTri,
  out vec2 A,
  out vec2 B,
  out vec2 C,
  out vec2 D,
  out vec2 E,
  out vec2 F,
  out vec2 G,
  out vec2 H,
  out vec2 I) {

  vec2 a;
  // Unneeded
  // vec2 b;
  // vec2 c;
  vec2 d;
  vec2 e;
  vec2 f;
  vec2 g;
  vec2 h;
  vec2 i;

  // Already set the closer endpoint when constructing wall properties.
  vec2 W0 = wall.top[0].xy;
  vec2 W1 = wall.top[1].xy;

  // A found by intersecting the two side penumbra lines.
  lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.penumbra[1], a);

  // If W0 == A, then the wall is nearly collinear with the light (line from wall intersects light circle).
  bool nearCollinear = almostEqual(W0, a, 1.0e-08);

  // D and G are set by the intersection of their respective penumbra/umbra lines.
  // Most of the matching work done in sideShadowRays.
  // If no intersection, D and G should be set to W0 (happens if side shadow rays are parallel):
  // - when wall is near-collinear and wall line is tangent to source circle.
  // TODO: Is setting D and G in advance sufficient?
  d = W0;
  g = W0;
  if ( nearCollinear ) {
    bool hasIx0 = lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.umbra[0], d);
    bool hasIx1 = lineLineIntersection(sideShadowRays.penumbra[1], sideShadowRays.umbra[1], g);
    if ( !hasIx0 ) d = W0;
    if ( !hasIx1 ) g = W0;
  } else {
    bool hasIx0 = lineLineIntersection(sideShadowRays.penumbra[0], sideShadowRays.umbra[1], d);
    bool hasIx1 = lineLineIntersection(sideShadowRays.penumbra[1], sideShadowRays.umbra[0], g);
    if ( !hasIx0 ) d = W0;
    if ( !hasIx1 ) g = W0;
  }

  // ∆DEF and ∆GHI represent the furtherest extent of the shadow because D and G are
  // near-tangent points.
  vec2[3] DEF = shadowTriangle(vec3(d, uLightPosition.z), wall, true); // Z axis not used for this.
  vec2[3] GHI = shadowTriangle(vec3(g, uLightPosition.z), wall, true); // Z axis not used for this.
  e = DEF[1]; // Penumbra line
  f = DEF[2]; // Umbra line

  int collinearIdx = int(nearCollinear);
  h = GHI[2 - collinearIdx]; // Penumbra line 2 - 1; 2 - 0
  i = GHI[1 + collinearIdx]; // Umbra line    1 + 1; 1 + 0

  // Determine B and C by connecting to the penumbra sideShadowRays.
  // Use whichever is greater distance from wall: I, H, farPenumbraTri[1]
  Ray2d rEdgeWall = frontBackBisector(wall, nearCollinear);
  float dist2F = distanceSquaredToLine(f, rEdgeWall.origin, rEdgeWall.direction);
  float dist2I = distanceSquaredToLine(i, rEdgeWall.origin, rEdgeWall.direction);
  float dist2P = distanceSquaredToLine(farPenumbraTri[2], rEdgeWall.origin, rEdgeWall.direction);
  vec2 furthestPoint = (dist2F > dist2I && dist2F > dist2P) ? f
    : (dist2I > dist2P) ? i : farPenumbraTri[2];

  // Direction to run the ray connect the two penumbra sides.
  vec2 rabDir = wall.direction;
  if ( nearCollinear ) {
    // Perpendicular to the mean ray between the two penumbra sides.
    vec2 meanDir = (sideShadowRays.penumbra[0].direction + sideShadowRays.penumbra[1].direction) * 0.5;
    rabDir = vec2(-meanDir.y, meanDir.x);
  }
  Ray2d rab = rayFromDirection(furthestPoint, rabDir);
  lineLineIntersection(sideShadowRays.penumbra[0], rab, B);
  lineLineIntersection(sideShadowRays.penumbra[1], rab, C);

  A = a;
  D = d;
  E = e;
  F = f;
  G = g;
  H = h;
  I = i;

  // For debugging, test side shadows
  /*
  Ray2d r0 = sideShadowRays.umbra[0];
  Ray2d r1 = sideShadowRays.umbra[1];
  lineLineIntersection(r0, r1, A);
  B = projectRay(r0, 2000.0);
  C = projectRay(r1, 2000.0);
  */
  /*
  A = D;
  B = E;
  C = F;
  */

  /* Debugging
  B = projectRay(rayFromDirection(A, normalize(B - A)), 2000.0);
  C = projectRay(rayFromDirection(A, normalize(C - A)), 2000.0);
  */

  return nearCollinear;
}

/**
 * For a line that intersects a circle, determine the percent area of the circle
 * on each side of the line.
 * @param {vec2} a
 * @param {vec2} b
 * @param {vec2} center
 * @param {float} radius
 * @returns {vec2} The percentage CCW(0) and CW (1), oriented a --> b.
 */
vec2 circleBisectorPercentArea(in vec2 a, in vec2 b, in vec2 center, in float radius) {
  // Use a line perpendicular to AB that goes through center.
  vec2 dir = normalizedDirection(a, b);
  vec2 perpDir = vec2(dir.y, -dir.x); // Moves CCW to a --> b
  Ray2d perpRay = rayFromDirection(center, perpDir);
  vec2 edgeCCW = projectRay(perpRay, radius);
  vec2 edgeCW = projectRay(perpRay, -radius);
  vec2 ix;
  lineLineIntersection(perpRay, rayFromDirection(a, normalizedDirection(a, b)), ix);
  float totalDist = radius * 2.0;
  float ccwDist = distance(ix, edgeCCW);
  float cwDist = distance(ix, edgeCW);
  if ( ccwDist < totalDist
    && cwDist < totalDist ) return vec2(ccwDist, cwDist) * (1.0 / totalDist);
  if ( ccwDist > cwDist ) return vec2(1.0, 0.0);
  return vec2(0.0, 1.0);
}

/**
 * Calculate the ambient light used when the wall is collinear.
 * @param {vec2} w0   Closest wall endpoint to the light
 * @param {vec2} w1   Other wall endpoint
 * @returns {vec2}
 */
vec2 ambientLight(vec2 w0, vec2 w1) {
  float distToWall = distanceToSegment(uLightPosition.xy, w0, w1);
  if ( distToWall <= uLightSize ) return vec2(1.0, 0.0);
  return circleBisectorPercentArea(w0, w1, uLightPosition.xy, uLightSize);
}

/**
 * Define varyings for this shader.
 */
void defineVaryings(in Wall wall, in vec2[3] penumbraTri, in vec2 F, in vec2 I, in bool hasSide0, in bool hasSide1) {
  int vertexNum = gl_VertexID % 3;

  // Presets for varyings.
  vPenumbra = vec3(0.0);
  vUmbra = vec3(-1.0);
  vSidePenumbra0 = vec3(-1.0);
  vSidePenumbra1 = vec3(-1.0);

  // @type {vec3} vPenumbra
  vPenumbra[vertexNum] = 1.0;

  // Define the umbraTri.
  // Define the sideTri used for gradient shading.
  // Use function to mimic setting out values for the triangles.
  vec2 W0 = wall.top[0].xy;
  vec2 W1 = wall.top[1].xy;
  vec2 A = penumbraTri[0];
  vec2 B = penumbraTri[1];
  vec2 C = penumbraTri[2];
  bool nearCollinear = almostEqual(W0, A, 1.0e-08);

  vec2[3] umbraTri; // Non-collinear.
  vec2[3] sideTri0;
  vec2[3] sideTri1;
  if ( nearCollinear ) {
    sideTri0 = vec2[3](W0, B, W1);
    sideTri1 = vec2[3](W0, C, W1);
    umbraTri = vec2[3](W1, I, F);

    // Used to shade the portion unblocked by the wall, after the endpoints.
    // Lightest along the line of the wall. To replicate, connect the umbra triangle using
    // edge perpendicular to the wall.
    vec2 perpDir = vec2(wall.direction.y, -wall.direction.x);
    if ( distanceSquared(W1, I) < distanceSquared(W1, F) ) {
      lineLineIntersection(rayFromDirection(W1, normalizedDirection(W1, F)), rayFromDirection(I, perpDir), umbraTri[2]); // New F.
    } else {
      lineLineIntersection(rayFromDirection(W1, normalizedDirection(W1, I)), rayFromDirection(F, perpDir), umbraTri[1]); // New I.
    }
  } else {
    vec2 ixI;
    vec2 ixF;
    lineLineIntersection(B, C, W0, I, ixI);
    lineLineIntersection(B, C, W1, F, ixF);
    sideTri0 = vec2[3](W0, B, ixI);
    sideTri1 = vec2[3](W1, C, ixF);
  }

  // @type {vec3} vUmbra
  if ( nearCollinear ) vUmbra = baryForPoint(vVertexPosition, umbraTri);

  // @type {vec3} vSidePenumbra0, vSidePenumbra1
  // Define side triangles in relation to the penumbra triangle.
  // If no real side penumbra, set values to -1 to avoid inclusion.
  // Change the side triangles to isoceles so gradient shading works.
  if ( hasSide0 && abs(orient(sideTri0[0], sideTri0[1], sideTri0[2])) > 1.0 ) vSidePenumbra0 = baryForPoint(vVertexPosition, makeIsoceles(sideTri0));
  if ( hasSide1 && abs(orient(sideTri1[0], sideTri1[1], sideTri1[2])) > 1.0 ) vSidePenumbra1 = baryForPoint(vVertexPosition, makeIsoceles(sideTri1));
}

/**
 * Calculate the flat variables, including near/far ratios.
 * @param {Wall} wall
 * @param {vec2} W0
 * @param {vec2} W1
 * @param {vec2[3]} sideTri0
 * @param {vec2[3]} nearFarTri0
 * @param {vec2[3]} nearFarTri1
 * @param {ShadowRays[2]} sideShadowRays
 */
void defineFlats(in Wall wall,
  in vec2[3] penumbraTri,
  in vec2[3] farPenumbraTri,
  in vec2[3] DEF,
  in vec2[3] GHI,
  vec3 lowerTangent,
  vec3 upperTangent) {

  // @type {vec2} fAmbient
  vec2 W0 = wall.top[0].xy; // Nearer wall endpoint to source.
  vec2 W1 = wall.top[1].xy; // Further wall endpoint from source.
  fAmbient = vec2(1.0) - ambientLight(W0, W1);
  if ( CLOCKWISE(orient(W0, W1, penumbraTri[1])) ) fAmbient = fAmbient.yx; // CW

  bool nearCollinear = almostEqual(W0, penumbraTri[0], 1.0e-08);

  // Orient the left and right tri
  Ray2d rRLWall = leftRightBisector(wall, nearCollinear);
  vec2 projRLPt = projectRay(rRLWall, 1.0);
  if ( !nearCollinear ) {
    // Ray rRLWall could point either way; turn it so it points away from the light.
    if ( SAME_SIDE(orient(W0, W1, projRLPt),
      orient(W0, W1, uLightPosition.xy)) ) rRLWall.direction *= vec2(-1.0);
    projRLPt = projectRay(rRLWall, 1.0);
  }

  vec2[3] rightFarTri;
  vec2[3] leftFarTri;
  if ( CLOCKWISE(orient(rRLWall.origin, projRLPt, GHI[1])) ) {
    rightFarTri = GHI;
    leftFarTri = DEF;
  } else {
    rightFarTri = DEF;
    leftFarTri = GHI;
  }

  vec2[3] leftNearTri = shadowTriangle(vec3(leftFarTri[0], uLightPosition.z), wall, false);
  vec2[3] rightNearTri = shadowTriangle(vec3(rightFarTri[0], uLightPosition.z), wall, false);

  vec2[3] farUmbraTri = shadowTriangle(upperTangent, wall, true);
  vec2[3] nearPenumbraTri = shadowTriangle(upperTangent, wall, false);
  vec2[3] nearUmbraTri = shadowTriangle(lowerTangent, wall, false);

  bool hasFarP = !isInfiniteTopShadow(lowerTangent);
  bool hasFarU = !isInfiniteTopShadow(upperTangent);
  bool hasNearP = wallIsFloating() && !isInfiniteBottomShadow(upperTangent);
  bool hasNearU = wallIsFloating() && !isInfiniteBottomShadow(lowerTangent);

  fFarDistances = vec2(0.0);
  fNearDistances = vec2(0.0);
  Ray2d rEdgeWall = frontBackBisector(wall, nearCollinear);

  if ( hasFarP || hasFarU ) {
    float distFarH0 = distanceSquaredToLine(leftFarTri[1], rEdgeWall.origin, rEdgeWall.direction);
    float distFarH1 = distanceSquaredToLine(rightFarTri[1], rEdgeWall.origin, rEdgeWall.direction);

    // Penumbra line.
    // Set by either the lower tangent or the horizontal tangents.
    if ( hasFarP ) {
      float distFarP = distanceSquaredToLine(farPenumbraTri[1], rEdgeWall.origin, rEdgeWall.direction);
      fFarDistances[PENUMBRA] = sqrt(max(max(distFarH0, distFarH1), distFarP));
    }

    // Umbra line.
    // Set by either the upper tangent or the horizontal tangents.
    if ( hasFarU ) {
      float distFarU = distanceSquaredToLine(farUmbraTri[1], rEdgeWall.origin, rEdgeWall.direction);
      fFarDistances[UMBRA] = sqrt(min(min(distFarH0, distFarH1), distFarU));
    }
  }

  if ( hasNearP || hasNearU ) {
    float distNearH0 = distanceSquaredToLine(leftNearTri[1], rEdgeWall.origin, rEdgeWall.direction);
    float distNearH1 = distanceSquaredToLine(rightNearTri[1], rEdgeWall.origin, rEdgeWall.direction);

    // Penumbra line.
    // Set by either the upper tangent or the horizontal tangents.
    if ( hasNearP ) {
      float distNearP = distanceSquaredToLine(nearPenumbraTri[1], rEdgeWall.origin, rEdgeWall.direction);
      fNearDistances[PENUMBRA] = sqrt(min(min(distNearH0, distNearH1), distNearP));
    }
    // Umbra line.
    // Set by either the lower tangent or the horizontal tangents.
    if ( hasNearU ) {
      float distNearU = distanceSquaredToLine(nearUmbraTri[1], rEdgeWall.origin, rEdgeWall.direction);
      fNearDistances[UMBRA] = sqrt(max(max(distNearH0, distNearH1), distNearU));
    }
  }

  // Left-right distances for non-collinear scenario
  fFarRLPenumbraDistances = vec2(0.0);
  fFarRLUmbraDistances = vec2(0.0);
  fNearRLPenumbraDistances = vec2(0.0);
  fNearRLUmbraDistances = vec2(0.0);

  // Assume infinite distances, set by the penumbra points.
  // Umbra distances are 0 by default.
  /*
  idx = Number(CLOCKWISE(orient(rRLWall.origin, ptLRWall, penumbraTri[2]))); // Right: 1, left 0
  const rPIdx = idx + 1; // If [2] is right: 1 + 1 = 2; otherwise 0 + 1 = 1.
  const lPIdx = 2 - idx; // If [2] is right: 2 - 1 = 1; otherwise 2 - 0 = 2.
  const maxRPt = penumbraTri[rPIdx];
  const maxLPt = penumbraTri[lPIdx];
  const maxRDist = distanceToLine(maxRPt, rRLWall.origin, rRLWall.direction);
  const maxLDist = distanceToLine(maxLPt, rRLWall.origin, rRLWall.direction);
  this.fFarRLPenumbraDistances[RIGHT] = maxRDist;
  this.fFarRLPenumbraDistances[LEFT] = maxLDist;
  this.fNearRLPenumbraDistances[RIGHT] = maxRDist;
  this.fNearRLPenumbraDistances[RIGHT] = maxLDist;
  */

  if ( !nearCollinear && (hasFarP || hasFarU) ) {
    float farLDist = distanceSquaredToLine(leftFarTri[1], rRLWall.origin, rRLWall.direction);
    float farRDist = distanceSquaredToLine(rightFarTri[1], rRLWall.origin, rRLWall.direction);
    if ( hasFarP ) {
      int idx = int(CLOCKWISE(orient(rRLWall.origin, projRLPt, farPenumbraTri[2]))); // 2 is right: idx 1; 2 is left: idx 0
      int lIdx = 2 - idx; // 2 is right: 2 - 1 = 1; 2 is left: 2 - 0 = 2
      int rIdx = idx + 1; // 2 is right: 1 + 1 = 2; 2 is left: 0 + 1 = 1

      float farPDistL = distanceSquaredToLine(farPenumbraTri[lIdx], rRLWall.origin, rRLWall.direction);
      float farPDistR = distanceSquaredToLine(farPenumbraTri[rIdx], rRLWall.origin, rRLWall.direction);
      fFarRLPenumbraDistances[RIGHT] = sqrt(max(farRDist, farPDistR));
      fFarRLPenumbraDistances[LEFT] = sqrt(max(farLDist, farPDistL));
    }
    if ( hasFarU ) {
      int idx = int(COUNTERCLOCKWISE(orient(rRLWall.origin, projRLPt, farUmbraTri[2]))); // 2 is right: idx 1; 2 is left: idx 0
      int lIdx = 2 - idx; // 2 is right: 2 - 1 = 1; 2 is left: 2 - 0 = 2
      int rIdx = idx + 1; // 2 is right: 1 + 1 = 2; 2 is left: 0 + 1 = 1

      float wallDist = distanceSquared(W0, rRLWall.origin);
      float farUDistL = distanceSquaredToLine(farUmbraTri[lIdx], rRLWall.origin, rRLWall.direction);
      float farUDistR = distanceSquaredToLine(farUmbraTri[rIdx], rRLWall.origin, rRLWall.direction);
      fFarRLUmbraDistances[RIGHT] = sqrt(min(min(wallDist, farRDist), farUDistR));
      fFarRLUmbraDistances[LEFT] = sqrt(min(min(wallDist, farLDist), farUDistL));
    }
  }

  if ( !nearCollinear && (hasNearP || hasNearU) ) {
    float nearLDist = distanceSquaredToLine(leftNearTri[1], rRLWall.origin, rRLWall.direction);
    float nearRDist = distanceSquaredToLine(rightNearTri[1], rRLWall.origin, rRLWall.direction);
    if ( hasNearP ) {
      int idx = int(CLOCKWISE(orient(rRLWall.origin, projRLPt, nearPenumbraTri[2]))); // 2 is right: idx 1; 2 is left: idx 0
      int lIdx = 2 - idx; // 2 is right: 2 - 1 = 1; 2 is left: 2 - 0 = 2
      int rIdx = idx + 1; // 2 is right: 1 + 1 = 2; 2 is left: 0 + 1 = 1

      float nearPDistL = distanceSquaredToLine(nearPenumbraTri[lIdx], rRLWall.origin, rRLWall.direction);
      float nearPDistR = distanceSquaredToLine(nearPenumbraTri[rIdx], rRLWall.origin, rRLWall.direction);
      fNearRLPenumbraDistances[RIGHT] = sqrt(max(nearRDist, nearPDistR));
      fNearRLPenumbraDistances[LEFT] = sqrt(max(nearLDist, nearPDistL));
    }
    if ( hasNearU ) {
      int idx = int(COUNTERCLOCKWISE(orient(rRLWall.origin, projRLPt, nearUmbraTri[2]))); // 2 is right: idx 1; 2 is left: idx 0
      int lIdx = 2 - idx; // 2 is right: 2 - 1 = 1; 2 is left: 2 - 0 = 2
      int rIdx = idx + 1; // 2 is right: 1 + 1 = 2; 2 is left: 0 + 1 = 1

      float wallDist = distanceSquared(W0, rRLWall.origin);
      float nearUDistL = distanceSquaredToLine(nearUmbraTri[lIdx], rRLWall.origin, rRLWall.direction);
      float nearUDistR = distanceSquaredToLine(nearUmbraTri[rIdx], rRLWall.origin, rRLWall.direction);
      fNearRLUmbraDistances[RIGHT] = sqrt(min(min(wallDist, nearRDist), nearUDistR));
      fNearRLUmbraDistances[LEFT] = sqrt(min(min(wallDist, nearLDist), nearUDistL));
    }
  }

  // Left-right distances for collinear scenario
  // The left/right triangles define the penumbra left/right distance.
  // For the side with the umbra triangle, it defines the umbra left/right distance.
  // Assume the other side has umbra 0.
  // If farPenumbraTri is collinear with the wall, 0 umbra for both sides.
  float oFarP = orient(W0, W1, farPenumbraTri[1]);
  if ( nearCollinear ) {
    if ( hasFarP ) {
      fFarRLPenumbraDistances[RIGHT] = distanceToLine(rightFarTri[1], rRLWall.origin, rRLWall.direction);
      fFarRLPenumbraDistances[LEFT] = distanceToLine(leftFarTri[1], rRLWall.origin, rRLWall.direction);
    }
    if ( hasFarU && !COLLINEAR(oFarP) ) {
      int side = CLOCKWISE(oFarP) ? RIGHT : LEFT;
      fFarRLUmbraDistances[side] = distanceToLine(farUmbraTri[1], rRLWall.origin, rRLWall.direction);
      // Otherwise collinear and umbra is 0 for both sides.
    }

    if ( hasNearP ) {
      fNearRLPenumbraDistances[RIGHT] = distanceToLine(rightNearTri[1], rRLWall.origin, rRLWall.direction);
      fNearRLPenumbraDistances[LEFT] = distanceToLine(leftNearTri[1], rRLWall.origin, rRLWall.direction);
    }
    if ( hasNearU && !COLLINEAR(oFarP) ) {
      int side = CLOCKWISE(oFarP) ? RIGHT : LEFT;
      fNearRLUmbraDistances[side] = distanceToLine(nearUmbraTri[1], rRLWall.origin, rRLWall.direction);
      // Otherwise collinear and umbra is 0 for both sides.
    }
  }
}

void main() {
  // Defined constants.
  int vertexNum = gl_VertexID % 3;
  Wall wall = calculateWallPositions();
  shrinkOverlappingWall(wall);

  // Side shadows.
  ShadowRays2d sideShadowRays = calculateSideShadowRays(wall);

  // Lowest and highest point of the sphere that forms a tangent with the wall.
  vec3 wallMid3d = vec3(wall.mid, wall.top[0].z);
  vec3[2] vTangents;
  verticalTangents(wallMid3d, vTangents);

  // Shadow triangle for the lower tangent, representing the furthest distance.
  int idx = int(vTangents[0].z > vTangents[1].z); // Pick the lower in z direction.
  vec3 lowerTangent = vTangents[idx];
  vec3 upperTangent = vTangents[idx - 1];
  vec2[3] farPenumbraTri = shadowTriangle(lowerTangent, wall, true);

  // Triangles defining parts of the shadow.
  vec2[3] penumbraTri;
  vec2[3] DEF;
  vec2[3] GHI;
  bool nearCollinear = shadowPoints(wall, sideShadowRays, farPenumbraTri,
    penumbraTri[0], penumbraTri[1], penumbraTri[2], DEF[0], DEF[1], DEF[2], GHI[0], GHI[1], GHI[2]);

  // If a linked wall is fully blocking, don't use a side shadow.
  bool hasSide0 = true;
  bool hasSide1 = true;
  if ( !nearCollinear ) {
    hasSide0 = !almostEqual(sideShadowRays.umbra[0].direction, sideShadowRays.penumbra[0].direction, 1.0e-06);
    hasSide1 = !almostEqual(sideShadowRays.umbra[1].direction, sideShadowRays.penumbra[1].direction, 1.0e-06);
  }

  // Debugging.
  // hasSide0 = true;
  // hasSide1 = true;

  // Varyings
  defineSharedVaryings(wall, penumbraTri);
  defineVaryings(wall, penumbraTri, DEF[2], GHI[2], hasSide0, hasSide1);

  // Flats
  if ( vertexNum == 2) {
    defineSharedFlats(wall, penumbraTri);
    defineFlats(wall, penumbraTri, farPenumbraTri, DEF, GHI, lowerTangent, upperTangent);
  }
}