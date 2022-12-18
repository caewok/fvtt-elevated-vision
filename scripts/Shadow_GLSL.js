/* globals
PIXI,
canvas
*/
"use strict";

// GLSL code for creating shadows for lights and vision
// Mostly string variables that can be imported and used elsewhere.

/*
https://ptb.discord.com/channels/732325252788387980/734082399453052938/1006958083320336534

- aVertexPosition are the vertices of the polygon normalized; origin is (0,0), radius 1
- vUvs is aVertexPosition transformed such that the center is (0.5,0.5) and the radius 0.5,
  such that it's in the range [0,1]x[0,1]. Therefore the * 2.0 is required to calculate dist,
  otherwise dist wouldn't be in the range [0,1]
- aDepthValue/vDepth is the edge falloff: the distance to the boundary of the polygon normalized
- vSamplerUvs are the texture coordinates used for sampling from a screen-sized texture

Screen-space to local coords:
https://ptb.discord.com/channels/732325252788387980/734082399453052938/1010914586532261909
shader.uniforms.EV_canvasMatrix ??= new PIXI.Matrix();
shader.uniforms.EV_canvasMatrix
  .copyFrom(canvas.stage.worldTransform)
  .invert()
  .append(mesh.transform.worldTransform);
*/


// In GLSL 2, cannot use dynamic arrays. So set a maximum number of walls for a given light.
export const MAX_NUM_WALL_ENDPOINTS = 200;

export const GLSL = {
  UNIFORMS: [],
  FUNCTIONS: []
};

// MARK: GLSL UNIFORMS ----- //
// Number of walls passed to the shader
// This will be all non-infinite-height walls + all terrain walls w/in los.
GLSL.UNIFORMS.push({
  name: "EV_numWalls",
  type: "int",
  initial: 0,
  array: ""
});

// Number of terrain walls passed to the shader
// All terrain walls w/in los.
GLSL.UNIFORMS.push({
  name: "EV_numTerrainWalls",
  type: "int",
  initial: 0,
  array: ""
});

// Top left and bottom right 3d wall coordinates
GLSL.UNIFORMS.push({
  name: "EV_wallCoords",
  type: `vec3`,
  initial: new Float32Array(MAX_NUM_WALL_ENDPOINTS*6),
  array: `[${MAX_NUM_WALL_ENDPOINTS}]` // To avoid first-class array not supported errors
});

// Location of the light/vision source in 3d
GLSL.UNIFORMS.push({
  name: "EV_sourceLocation",
  type: "vec3",
  initial: [0.5, 0.5, 0.5],
  array: ""
});

// Whether this is a vision source
GLSL.UNIFORMS.push({
  name: "EV_isVision",
  type: "bool",
  initial: false,
  array: ""
});

// Texture of elevation values, set on the red channel
GLSL.UNIFORMS.push({
  name: "EV_elevationSampler",
  type: "sampler2D",
  initial: PIXI.Texture.EMPTY,
  array: ""
});

// Transform from global to light space
GLSL.UNIFORMS.push({
  name: "EV_transform",
  type: "vec4",
  initial: [1, 1, 1, 1],
  array: ""
});

// Parameters to transform elevation pixel values to an elevation
GLSL.UNIFORMS.push({
  name: "EV_elevationResolution",
  type: "vec4",
  initial: [0, 1, 255, 1],
  array: ""
});

// Whether an elevation sampler is present
GLSL.UNIFORMS.push({
  name: "EV_hasElevationSampler",
  type: "bool",
  initial: false,
  array: ""
});

// MARK: GLSL FUNCTIONS ---- //

// NOTE: Functions must be in order of dependency

// Build function call given a function body and parameters
function buildGLSLFunction(definition) {
  const { name, body, returnType, params } = definition;

  const parens = [];
  for (const param of params) parens.push(`${param.qualifier} ${param.type} ${param.name}`);

  return `
${returnType} ${name}(${parens.join(", ")}) {
  ${body}
}
`;
}

let fn;

// MARK: orient2d
/**
 * GLSL
 * Determine the relative orientation of three points in two-dimensional space.
 * The result is also an approximation of twice the signed area of the triangle defined by the three points.
 * This method is fast - but not robust against issues of floating point precision. Best used with integer coordinates.
 * Same as Foundry utils version
 * @in {vec2} a An endpoint of segment AB, relative to which point C is tested
 * @in {vec2} b An endpoint of segment AB, relative to which point C is tested
 * @in {vec2} c A point that is tested relative to segment AB
 * @out {float} The relative orientation of points A, B, and C
 *                  A positive value if the points are in counter-clockwise order (C lies to the left of AB)
 *                  A negative value if the points are in clockwise order (C lies to the right of AB)
 *                  Zero if the points A, B, and C are collinear.
 */


fn = {};
GLSL.FUNCTIONS.push(fn);

fn.body = `
return (a.y - c.y) * (b.x - c.x) - (a.x - c.x) * (b.y - c.y);
`;

fn.definition = {
  name: "orient2d",
  body: fn.body,
  returnType: "float",
  params: [
    { qualifier: "in", type: "vec2", name: "a" },
    { qualifier: "in", type: "vec2", name: "b" },
    { qualifier: "in", type: "vec2", name: "c" }
  ]
};

fn.string = buildGLSLFunction(fn.definition);

// MARK: line segment intersects
/**
 * GLSL
 * Does segment AB intersect the segment CD?
 * @in {vec2} a
 * @in {vec2} b
 * @in {vec2} c
 * @in {vec2} d
 * @returns {boolean}
 */
fn = {};
GLSL.FUNCTIONS.push(fn);

fn.body = `
  float xa = orient2d(a, b, c);
  float xb = orient2d(a, b, d);
  if ( xa == 0.0 && xb == 0.0 ) return false;

  bool xab = (xa * xb) <= 0.0;
  bool xcd = (orient2d(c, d, a) * orient2d(c, d, b)) <= 0.0;
  return xab && xcd;
`;

fn.definition = {
  name: "lineSegmentIntersects",
  body: fn.body,
  returnType: "bool",
  params: [
    { qualifier: "in", type: "vec2", name: "a" },
    { qualifier: "in", type: "vec2", name: "b" },
    { qualifier: "in", type: "vec2", name: "c" },
    { qualifier: "in", type: "vec2", name: "d" }
  ]
};

fn.string = buildGLSLFunction(fn.definition);

// MARK: perpendicular point
/**
 * GLSL
 * Point on line AB that forms perpendicular point to C
 * @in {vec2} a
 * @in {vec2} b
 * @in {vec2} c
 * @returns {vec2}
 */
fn = {};
GLSL.FUNCTIONS.push(fn);

fn.body = `
  vec2 deltaBA = b - a;

  // dab might be 0 but only if a and b are equal
  float dab = pow(deltaBA.x, 2.0) + pow(deltaBA.y, 2.0);
  vec2 deltaCA = c - a;

  float u = ((deltaCA.x * deltaBA.x) + (deltaCA.y * deltaBA.y)) / dab;
  return vec2(a.x + (u * deltaBA.x), a.y + (u * deltaBA.y));
`;

fn.definition = {
  name: "perpendicularPoint",
  body: fn.body,
  returnType: "vec2",
  params: [
    { qualifier: "in", type: "vec2", name: "a" },
    { qualifier: "in", type: "vec2", name: "b" },
    { qualifier: "in", type: "vec2", name: "c" }
  ]
};

fn.string = buildGLSLFunction(fn.definition);

// MARK: orient3d
/**
 * GLSL
 * Adapted from https://github.com/mourner/robust-predicates/blob/main/src/orient3d.js
 * @in {vec3} a   Point in the plane
 * @in {vec3} b   Point in the plane
 * @in {vec3} c   Point in the plane
 * @in {vec3} d   Point to test
 * @out {float}
 *   - Returns a positive value if the point d lies above the plane passing through a, b, and c,
 *     meaning that a, b, and c appear in counterclockwise order when viewed from d.
 *   - Returns a negative value if d lies below the plane.
 *   - Returns zero if the points are coplanar.
 */
fn = {};
GLSL.FUNCTIONS.push(fn);

fn.body = `
  vec3 ad = a - d;
  vec3 bd = b - d;
  vec3 cd = c - d;

  return (ad.x * ((bd.y * cd.z) - (bd.z * cd.y)))
    + (bd.x * ((cd.y * ad.z) - (cd.z * ad.y)))
    + (cd.x * ((ad.y * bd.z) - (ad.z * bd.y)));
`;

fn.definition = {
  name: "orient3d",
  body: fn.body,
  returnType: "float",
  params: [
    { qualifier: "in", type: "vec3", name: "a" },
    { qualifier: "in", type: "vec3", name: "b" },
    { qualifier: "in", type: "vec3", name: "c" },
    { qualifier: "in", type: "vec3", name: "d" }
  ]
};

fn.string = buildGLSLFunction(fn.definition);

// MARK: Line segment-plane intersects
/**
 * GLSL
 * Quickly test whether the line segment AB intersects with a plane.
 * This method does not determine the point of intersection, for that use lineLineIntersection.
 * Each Point3d should have {x, y, z} coordinates.
 *
 * @in {vec3} a   The first point defining the plane
 * @in {vec3} b   The second point defining the plane
 * @in {vec3} c   The third point defining the plane.
 * @in {vec3} sA  The first endpoint of segment AB
 * @in {vec3} sB  The second endpoint of segment AB
 *
 * @out {bool} Does the line segment intersect the plane?
 * Note that if the segment is part of the plane, this returns false.
 */
fn = {};
GLSL.FUNCTIONS.push(fn);

fn.body = `
  float xA = orient3d(sA, a, b, c);
  float xB = orient3d(sB, a, b, c);
  return (xA * xB) <= 0.0;
`;

fn.definition = {
  name: "planeLineSegmentIntersects",
  body: fn.body,
  returnType: "bool",
  params: [
    { qualifier: "in", type: "vec3", name: "a" },
    { qualifier: "in", type: "vec3", name: "b" },
    { qualifier: "in", type: "vec3", name: "c" },
    { qualifier: "in", type: "vec3", name: "sA" },
    { qualifier: "in", type: "vec3", name: "sB" }
  ]
};

fn.string = buildGLSLFunction(fn.definition);

// MARK: Line-plane intersection
/**
 * GLSL
 * Line-plane intersection
 * @in {vec3} a  First point on plane
 * @in {vec3} b  Second point on plane
 * @in {vec3} c  Third point on plane
 * @in {vec3} sA   First endpoint of line segment
 * @in {vec3} sB   Second endpoint of line segment
 * @inout {bool} intersects  Does the line intersect the plane?
 * @out {vec3}
 */
fn = {};
GLSL.FUNCTIONS.push(fn);

fn.body = `
  vec3 vAB = b - a;
  vec3 vAC = c - a;
  vec3 n = normalize(cross(vAB, vAC));
  vec3 vLine = sB - sA;

  float dotNL = dot(n, vLine);
  if ( dotNL == 0.0 ) {
    intersects = false;
    return vec3(0.0);
  }

  intersects = true;

  vec3 w = sA - a;
  float fac = dot(-n, w) / dotNL;
  vec3 u = vLine * fac;
  return sA + u;
`;

fn.definition = {
  name: "planeLineIntersection",
  body: fn.body,
  returnType: "vec3",
  params: [
    { qualifier: "in", type: "vec3", name: "a" },
    { qualifier: "in", type: "vec3", name: "b" },
    { qualifier: "in", type: "vec3", name: "c" },
    { qualifier: "in", type: "vec3", name: "sA" },
    { qualifier: "in", type: "vec3", name: "sB" },
    { qualifier: "inout", type: "bool", name: "intersects" }
  ]
};

fn.string = buildGLSLFunction(fn.definition);

// MARK: Canvas elevation from pixel
/**
 * GLSL
 * Calculate the canvas elevation given a pixel value
 * Maps 0–1 to elevation in canvas coordinates.
 * @in {float} pixel
 * @in {vec4} EV_elevationResolution
 * @out {float}
 *
 * EV_elevationResolution:
 * - r: elevation min; g: elevation step; b: max pixel value (likely 255); a: canvas size / distance
 * - u.EV_elevationResolution = [elevationMin, elevationStep, maximumPixelValue, elevationMult];
 */

fn = {};
GLSL.FUNCTIONS.push(fn);

fn.body = `
  return (EV_elevationResolution.r + (pixel * EV_elevationResolution.b * EV_elevationResolution.g)) * EV_elevationResolution.a;
`;

fn.definition = {
  name: "canvasElevationFromPixel",
  body: fn.body,
  returnType: "float",
  params: [
    { qualifier: "in", type: "float", name: "pixel" },
    { qualifier: "in", type: "vec4", name: "EV_elevationResolution" }
  ]
};

fn.string = buildGLSLFunction(fn.definition);


// MARK: Location in wall shadow
/**
 * GLSL
 * Determine if a given location from a wall is in shadow or not.
 * Assumes the wall is a vertical rectangle in 3d space
 * @in {vec3} wallTL          Top-left corner of the wall
 * @in {vec3} wallBR          Bottom-right corner of the wall
 * @in {vec3} sourceLocation  Location of the source/viewer
 * @in {vec3} pixelLocation   Location of the pixel at issue.
 * @out {boolean} True if location is in shadow of this wall
 */

/* Methodology:
A point is in shadow if the line between it and the source intersects:
- Any wall or
- 2 terrain walls.

Note: Must ensure that the intersection point lies between the source and the point.

Moving from the point toward the source, the first wall (or 2nd terrain wall) is "blocking."
The distance from the blocking wall to the point is the distance from the wall.
The furthest shadow point is the part of the shadow furthest from the wall.
Percent distance is how far a given point is from the wall, divided by the maximum distance
it could be if it were at the edge of the shadow.
*/
fn = {};
GLSL.FUNCTIONS.push(fn);

fn.body = `
  // If the wall is higher than the light, skip. Should not occur.
  if ( sourceLocation.z <= wallBR.z ) return false;

  // If the pixel is above the wall, skip.
  if ( pixelLocation.z >= wallTL.z ) return false;

  vec3 Atop = wallTL;
  vec3 Abottom = vec3(wallTL.xy, wallBR.z);
  vec3 Btop = vec3(wallBR.xy, wallTL.z);
  vec3 Bbottom = wallBR;

  // If point and source on same side of plane, then no intersection
  if ( !planeLineSegmentIntersects(Atop, Abottom, Btop, sourceLocation, pixelLocation) ) {
    return false;
  }

  // Locate the intersection point with this wall.
  bool ixIntersects = false;
  vec3 ix = planeLineIntersection(Atop, Abottom, Btop, sourceLocation, pixelLocation, ixIntersects);
  if ( !ixIntersects ) return false; // Just in case

  // Confirm the intersection is within the wall bounds.
  // Because walls are vertical rectangles, first do an easy check that ix is within height
  if ( ix.z < Bbottom.z || ix.z > Btop.z ) return false;

  // check that ix.xy is within the line segment XY of the wall
  // See https://lucidar.me/en/mathematics/check-if-a-point-belongs-on-a-line-segment
  vec2 vAB = Btop.xy - Atop.xy;
  vec2 vAC = ix.xy - Atop.xy;

  float dotABAC = dot(vAB, vAC);
  float dotABAB = dot(vAB, vAB);
  if ( dotABAC < 0.0 || dotABAC > dotABAB ) return false;

  return true;
`;

fn.definition = {
  name: "locationInWallShadow",
  body: fn.body,
  returnType: "bool",
  params: [
    { qualifier: "in", type: "vec3", name: "wallTL" },
    { qualifier: "in", type: "vec3", name: "wallBR" },
    { qualifier: "in", type: "vec3", name: "sourceLocation" },
    { qualifier: "in", type: "vec3", name: "pixelLocation" }
  ]
};

fn.string = buildGLSLFunction(fn.definition);

// MARK: pixelInShadow
/**
 * GLSL
 * Is a given pixel location in shadow?
 * @in {vec3} pixelLocation
 * @in {vec3} sourceLocation
 * @in {vec3[MAX_NUM_WALL_ENDPOINTS]} wallCoords
 * @in {int} numWalls
 * @in {int} numTerrainWalls
 * @out {bool}
 */
fn = {};
GLSL.FUNCTIONS.push(fn);

fn.body = `
//   if ( pixelLocation.z > sourceLocation.z ) return false;
    // If elevation at this point is above the light, then light cannot hit this pixel.
//     depth = 0.0;
//     numWallEndpoints = 0;
//     inShadow = EV_isVision;
//   }

  int numWallEndpoints = numWalls * 2;
  int numHeightWallEndpoints = (numWalls - numTerrainWalls) * 2;

  for ( int i = 0; i < ${MAX_NUM_WALL_ENDPOINTS}; i += 2 ) {
    if ( i >= numWallEndpoints ) break;

    vec3 wallTL = wallCoords[i];
    vec3 wallBR = wallCoords[i + 1];

    bool thisWallShadows = locationInWallShadow(
      wallTL,
      wallBR,
      sourceLocation,
      pixelLocation
    );

    if ( !thisWallShadows ) continue;

    bool isTerrainWall = i >= numHeightWallEndpoints;

    if ( isTerrainWall ) {
      // Check each terrain wall for a shadow.
      // We can ignore the height walls, b/c shadows from height wall --> terrain wall --> pt
      // are covered by the height wall.
      thisWallShadows = false; // Assume none shadow until proven otherwise

      for ( int j = 0; j < ${MAX_NUM_WALL_ENDPOINTS}; j += 2 ) {
        if ( j >= numWallEndpoints ) break;
        if ( j < numHeightWallEndpoints ) continue;
        vec3 terrainTL = wallCoords[j];
        vec3 terrainBR = wallCoords[j + 1];

        if ( terrainTL == wallTL && terrainBR == wallBR ) continue;

        bool thisSecondaryWallShadows = locationInWallShadow(
          terrainTL,
          terrainBR,
          sourceLocation,
          pixelLocation
        );

        if ( thisSecondaryWallShadows ) return true;
      }
    }

    if ( thisWallShadows ) return true;
  }

  return false;
`;

fn.definition = {
  name: "pixelInShadow",
  body: fn.body,
  returnType: "bool",
  params: [
    { qualifier: "in", type: "vec3", name: "pixelLocation" },
    { qualifier: "in", type: "vec3", name: "sourceLocation" },
    { qualifier: "in", type: `vec3[${MAX_NUM_WALL_ENDPOINTS}]`, name: "wallCoords" },
    { qualifier: "in", type: "int", name: "numWalls" },
    { qualifier: "in", type: "int", name: "numTerrainWalls" }
  ]
};

fn.string = buildGLSLFunction(fn.definition);

// MARK: HELPER FUNCTIONS

/**
 * Helper function to add uniforms for a source shader
 * Add:
 * - elevation of the source
 * - number of walls that are in the LOS and below the light source elevation
 * - of the walls, how many are terrain walls.
 * For each terrain wall or limited-height wall that is below the light source, add
 *   (in the coordinate system used in the shader):
 * - wall coordinates (top-left and bottom-right, with elevations)
 * - Organized limited-height walls first
 * @param {object} u            Uniforms object
 * @param {PointSource} source  Point source (light/vision). Must have los initialized
 * @param {object} [options]
 * @param {boolean} [useRadius] Whether the source has a set radius (e.g., lights) or not.
 */
export function updateUniformsForSource(u, source, { useRadius = true } = {}) {
  if ( !source.los ) return u;

  const { x, y, elevationZ } = source;
  const center = {x, y};
  const { width, height } = canvas.dimensions;

  // To avoid a bug in PolygonMesher and because ShadowShader assumes normalized geometry
  // based on radius, set radius to 1 if radius is 0.
  const radius = source.radius || 1;
  const r_inv = 1 / radius;

  if ( canvas.elevation ) {
    /*
    Elevation of a given pixel from the texture value:
    texture value in the shader is between 0 and 1. Represents value / maximumPixelValue where
    maximumPixelValue is currently 255.

    To get to elevation in the light vUvs space:
    elevationCanvasUnits = (((value * maximumPixelValue * elevationStep) - elevationMin) * size) / distance;
    elevationLightUnits = elevationCanvasUnits * 0.5 * r_inv;
    = (((value * maximumPixelValue * elevationStep) - elevationMin) * size) * inv_distance * 0.5 * r_inv;
    */
    const { elevationMin, elevationStep, maximumPixelValue, _elevationTexture} = canvas.elevation;
    const { distance, size } = canvas.scene.grid;
    const elevationMult = useRadius ? size * (1 / distance) * 0.5 * r_inv : size * (1 / distance);
    u.EV_elevationResolution = [elevationMin, elevationStep, maximumPixelValue, elevationMult];
    u.EV_elevationSampler = _elevationTexture ?? PIXI.Texture.EMPTY;
    u.EV_hasElevationSampler = true;
  } else {
    u.EV_hasElevationSampler = false;
  }

  const terrainWallPointsArr = source.los._elevatedvision?.terrainWallPointsArr ?? [];
  const heightWallPointsArr = source.los._elevatedvision?.heightWallPointsArr ?? [];

  let wallCoords = [];

  const coordTransformFn = useRadius ? pointCircleCoord : function(pt) { return pt; };

  // Important: height walls go first!
  // (b/c the shader may never need to test terrain walls for some points)
  const wallPointsArr = [...heightWallPointsArr, ...terrainWallPointsArr];
  for ( const wallPoints of wallPointsArr ) {
    // Because walls are rectangular, we can pass the top-left and bottom-right corners
    const tl = coordTransformFn(wallPoints.A.top, radius, center, r_inv);
    const br = coordTransformFn(wallPoints.B.bottom, radius, center, r_inv);

    wallCoords.push(
      tl.x, tl.y, tl.z,
      br.x, br.y, br.z
    );
  }

  u.EV_numWalls = wallPointsArr.length;
  u.EV_numTerrainWalls = terrainWallPointsArr.length;

  if ( !wallCoords.length ) wallCoords = new Float32Array(MAX_NUM_WALL_ENDPOINTS*6);

  u.EV_wallCoords = wallCoords;
  u.EV_elevationSampler = canvas.elevation?._elevationTexture;

  // Screen-space to local coords:
  // https://ptb.discord.com/channels/732325252788387980/734082399453052938/1010914586532261909
  // shader.uniforms.EV_canvasMatrix ??= new PIXI.Matrix();
  // shader.uniforms.EV_canvasMatrix
  //   .copyFrom(canvas.stage.worldTransform)
  //   .invert()
  //   .append(mesh.transform.worldTransform);

  // Alternative version using vUvs, given that light source mesh have no rotation
  // https://ptb.discord.com/channels/732325252788387980/734082399453052938/1010999752030171136
  if ( useRadius ) {
    // Radius is .5 in the shader coordinates; adjust elevation accordingly
    u.EV_sourceLocation = [0.5, 0.5, elevationZ * 0.5 * r_inv];

    u.EV_transform = [
      radius * 2 / width,
      radius * 2 / height,
      (x - radius) / width,
      (y - radius) / height];

  } else {
    u.EV_sourceLocation = [center.x, center.y, elevationZ];

    // Same as default: u.EV_transform = [1, 1, 1, 1]
  }

}

/**
 * Transform a point coordinate to be in relation to a circle center and radius.
 * Between 0 and 1 where [0.5, 0.5] is the center
 * [0, .5] is at the edge in the westerly direction.
 * [1, .5] is the edge in the easterly direction
 * @param {Point} point
 * @param {Point} center
 * @param {number} r      Radius
 * @param {number} r_inv  Inverse of the radius. Optional; for repeated calcs.
 * @returns {Point}
 */
function pointCircleCoord(point, r, center = {}, r_inv = 1 / r) {

  return {
    x: circleCoord(point.x, r, center.x, r_inv),
    y: circleCoord(point.y, r, center.y, r_inv),
    z: point.z * 0.5 * r_inv
  };
}

/**
 * Transform a coordinate to be in relation to a circle center and radius.
 * Between 0 and 1 where [0.5, 0.5] is the center.
 * @param {number} a    Coordinate value
 * @param {number} c    Center value, along the axis of interest
 * @param {number} r    Light circle radius
 * @param {number} r_inv  Inverse of the radius. Optional; for repeated calcs.
 * @returns {number}
 */
function circleCoord(a, r, c = 0, r_inv = 1 / r) {
  return ((a - c) * r_inv * 0.5) + 0.5;
}

/**
 * Inverse of circleCoord.
 * @param {number} p    Coordinate value, in the shader coordinate system between 0 and 1.
 * @param {number} c    Center value, along the axis of interest
 * @param {number} r    Radius
 * @returns {number}
 */
function revCircleCoord(p, r, c = 0) { // eslint-disable-line no-unused-vars
  // Calc:
  // ((a - c) / 2r) + 0.5 = p
  //  ((a - c) / 2r) = p +  0.5
  //  a - c = (p + 0.5) * 2r
  //  a = (p + 0.5) * 2r + c
  return ((p + 0.5) * 2 * r) + c;
}
