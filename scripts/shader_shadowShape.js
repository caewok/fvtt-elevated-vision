/* globals
foundry,
PIXI,
Wall
*/
"use strict";

import { MODULE_ID } from "./const.js";


// NOTE: Color channel choices
/*
To avoid weirdness with alpha channel blending, avoid using it to set shadow amount.
So that shadows can be multiplied together correctly, values actually represent light amount.
Channels used:
- red: Light amount, where 1 is full light. (1 - red ==> shadow amount)
- green: Terrain/limited wall. 1 is normal wall. .5 means one terrain wall; anything less is 2+ walls.
- blue: Terrain/limited wall light portion. Otherwise 1.0.
- alpha: 1.0. Unused, but can be temporarily enabled for testing.
--> vec4(1.0) would be full light.
--> vec4(vec3(1.0), 0.0) would be ignoring this fragment.

Use BLEND Multiply for combining pixels (i.e., light portions).
- For red and blue, this means that setting channel to 0 will mean full shadow no matter what.
- For green, values chosen to work with multiplication.
  - Setting 1 for a normal wall shadow fragment: does nothing to the terrain wall count.
  - Setting 0.5 for a terrain wall fragment: If set twice, multiplied to 0.25, or less for more.

We want unpremultiplied alpha in most cases to avoid changing the data values.
*/

// NOTE: Terrain and elevation
/*
Elevation inputs:
- Lights have a given elevation (plus a lightSize that makes them a sphere)
- Walls are quads spanning a vertical elevation.
- Tiles are quads at a given elevation.
- Canvas elevation or min elevation is the default elevation for rendering shadows.
- TODO: Terrain elevation is a texture that provides an elevation above the minimum.
  Fragments at higher terrain elevation have their shadow re-calculated.
- TODO: Tile objects (textures?) indicate areas of higher terrain.
  (Or are these incorporated into the terrain elevation?)
*/

// NOTE: Shadow map output
/*
Goal is a shadow map texture for a given light/sound/vision source.
- Describes the current shadows (light values?) for a given source and terrain,
  as view from a defined elevation.

Sources above the defined elevation contribute to the light/sound (/vision?)
Viewing top-down, so shadows mark obscured areas from that elevation.
Shadow map texture used in light/sound sources to block light at that fragment. (And vision?)

So if on the "first floor" at elevation 10', a light at 19' would get a texture.
So would a light at 5', which may or may not be seen depending on tiles making up the "floor."

Elevation texture is the terrain plus any tile at or below target elevation.
So if at elevation 10':
- tile at 20' does not count.
- tile at 10' creates elevation at 10', excepting transparent areas.
- tile at 5' creates elevation at 5', excepting transparent areas.

For given fragment with minElevation assumed here to be 0':
- If terrain elevation equals or exceeds the light elevation, ignore. TODO: Ignore, or make full shadow?
- If terrain elevation is above minimum elevation, recalculate by shooting ray to light center.s
- If fragment not in shadow, let full light through.
- If fragment in full shadow and not within penumbra area: full shadow.
- If within penumbra area: Shoot ray to light position, adjusted by wall direction and light size,
  to determine amount of penumbra, if any.
*/


// Draw trapezoidal shape of shadow directly on the canvas.
// Take a vertex, light position, and canvas elevation.
// Project the vertex onto the flat 2d canvas.

let MODULE_ID = "elevatedvision";

function smoothstep(edge0, edge1, x) {
  const t = Math.clamped((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - (2.0 * t));
}

function linearConversion(x, oldMin, oldMax, newMin, newMax) {
  return (((x - oldMin) * (newMax - newMin)) / (oldMax - oldMin)) + newMin;
}

function mix(x, y, a) {
  return (x * (1 - a)) + (y * a);
}

// For point p and triangle abc, return the barycentric uvw as a Point3d.
// See https://ceng2.ktu.edu.tr/~cakir/files/grafikler/Texture_Mapping.pdf
function barycentric(p, a, b, c) {
  const v0 = b.subtract(a);
  const v1 = c.subtract(a);
  const v2 = p.subtract(a);

  const d00 = v0.dot(v0);
  const d01 = v0.dot(v1);
  const d11 = v1.dot(v1);
  const d20 = v2.dot(v0);
  const d21 = v2.dot(v1);

  const denom = d00 * d11 - d01 * d01;
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1 - v - w;

  return new Point3d(u, v, w);
}

// Set up geometry
// TODO: Could use triangle fan
// https://www.html5gamedevs.com/topic/44378-pixidraw_modespoints-doesnt-work/
// https://api.pixijs.io/@pixi/constants/PIXI/DRAW_MODES.html
// Use the map to build the geometry
let PLACEABLE_TYPES = {
  WALL: 0,
  TERRAIN_WALL: 1,
  TILE: 2,
  TRANSPARENT_TILE: 3
};

function renderableWall(map, wallObj, lightBounds) {
  const orientWall = foundry.utils.orient2dFast(wallObj.A, wallObj.B, map.lightPosition);
  if ( orientWall.almostEqual(0) ) return false; // Wall is collinear to the light.

  const topZ = Math.min(wallObj.topZ, map.lightPosition.z - 1);
  const bottomZ = Math.max(wallObj.bottomZ, map.minElevation);
  if ( topZ <= bottomZ ) return false; // Wall is above or below the viewing box.

  // Point source lights are limited to a max radius; drop walls outside the radius
  if ( !map.directional
    && !lightBounds.lineSegmentIntersects(wallObj.A, wallObj.B, { inside: true })) return false;

  return true;
}

function renderableTile(map, tileObj, lightBounds) {
  const elevationZ = tileObj.elevationZ;
  if ( map.lightPosition.z <= elevationZ ) return false; // Tile is collinear to or above the light.
  if ( elevationZ < map.minElevation ) return false; // Tile is below the minimum elevation.

  // Drop walls outside the point source light radius.
  // Use the bounds for the tile points.
  const xMinMax = Math.minMax(tileObj.TL.x, tileObj.TR.x, tileObj.BR.x, tileObj.BL.x);
  const yMinMax = Math.minMax(tileObj.TL.y, tileObj.TR.y, tileObj.BR.y, tileObj.BL.y);
  const tileBounds = new PIXI.Rectangle(xMinMax.min, yMinMax.y, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
  if ( !map.directional && !lightBounds._overlapsRectangle(tileBounds) ) return false;

  return true;
}

function getLightBounds(map) {
  if ( map.directional ) return undefined;
  const { lightPosition, lightRadius } = map;
  const lightBounds = new PIXI.Rectangle(
    lightPosition.x - lightRadius,
    lightPosition.y - lightRadius,
    lightRadius * 2,
    lightRadius * 2);
  return lightBounds;
}

// TODO: Simplified wall geometry that does not calculate penumbra.
// Possible faster performance setting.
// Can repeat the light vertex.

function constructWallGeometry(map) {
  const coords = map.placeablesCoordinatesData.coordinates;
  const nObjs = coords.length;

  // Need to cut off walls at the top/bottom bounds of the scene, otherwise they
  // will be given incorrect depth values b/c there is no floor or ceiling.
  // Point source lights have bounds
  const lightBounds = getLightBounds(map);
  const { lightPosition } = map;

  // TODO: Try Uint or other buffers instead of Array.
  const indices = [];
  const aVertexPosition = [];
  const aWallCorner1 = [];
  const aWallCorner2 = [];
  const aTerrain = [];

  let triNumber = 0;
  for ( let i = 0; i < nObjs; i += 1 ) {
    const obj = coords[i];
    const isWall = obj.object instanceof Wall;
    if ( !isWall ) continue;
    if ( !renderableWall(map, obj, lightBounds) ) continue;

    // First vertex is the light source.
    aVertexPosition.push(lightPosition.x, lightPosition.y, lightPosition.z);

    // A --> B --> light CCW
    // Only draw the triangles that are above minimum elevation and thus cast shadow.
    const topZ = Math.min(obj.topZ, map.lightPosition.z - 1);
    const bottomZ = Math.max(obj.bottomZ, map.minElevation);
    const orientWall = foundry.utils.orient2dFast(obj.A, obj.B, this.lightPosition);
    const [A, B] = orientWall > 0 ? [obj.A, obj.B] : [obj.B, obj.A];

    aVertexPosition.push(A.x, A.y, topZ, B.x, B.y, topZ);


    // Use the same terrain for each vertex.
    aTerrain.push(obj.isTerrain, obj.isTerrain, obj.isTerrain);

    // Give each vertex the wall coordinates.
    // Used to calculate shadow penumbra.
    aWallCorner1.push(
      A.x, A.y, topZ,
      A.x, A.y, topZ,
      A.x, A.y, topZ
    );

    aWallCorner2.push(
      B.x, B.y, bottomZ,
      B.x, B.y, bottomZ,
      B.x, B.y, bottomZ
    );

    // Two vertices per wall edge, plus light center (0).
    const v = triNumber * 2;
    indices.push(v, v + 1, v + 2);
    triNumber += 1;
  }

  // TODO: set interleave to true?
  const geometry = new PIXI.Geometry();
  geometry.addIndex(indices);
  geometry.addAttribute("aVertexPosition", aVertexPosition, 3, false);
  geometry.addAttribute("aWallCorner1", aWallCorner1, 3, false);
  geometry.addAttribute("aWallCorner2", aWallCorner2, 3, false);
  geometry.addAttribute("aTerrain", aTerrain, 1, false);
  return geometry;
}

/**
 * Construct geometry for all opaque overhead tiles in the scene.
 */
function constructOpaqueTileGeometry(map) {

}

/**
 * Construct geometry for a given (transparent) tile in the scene.
 */
function constructTileGeometry(map, tileNum) {
  const tileObj = map.placeablesCoordinatesData.tileCoordinates[tileNum];

  // Need to cut off walls at the top/bottom bounds of the scene, otherwise they
  // will be given incorrect depth values b/c there is no floor or ceiling.
  // Point source lights have bounds
  const lightBounds = getLightBounds(map);
  const { lightPosition } = map;
  if ( !renderableTile(map, tileObj, lightBounds) ) return null;

  const indices = [
    0, 1, 2,
    0, 2, 3
  ];

  // Vertices should match texCoord.
  const { BL, BR, TR, TL, elevationZ } = tileObj;
  const aVertexPosition = [
    BL.x, BL.y, elevationZ,
    BR.x, BR.y, elevationZ,
    TR.x, TR.y, elevationZ,
    TL.x, TL.y, elevationZ
  ];

  const aTexCoord = [
    0, 1,  // BL
    1, 1, // BR
    1, 0, // TR
    0, 0 // TL
  ];

  const geometry = new PIXI.Geometry();
  geometry.addIndex(indices);
  geometry.addAttribute("aVertexPosition", aVertexPosition, 3, false);
  geometry.addAttribute("aTexCoord", aTexCoord, 2, false);
  return geometry;
}


let GLSLFunctions = {};

// Calculate the canvas elevation given a pixel value
// Maps 0–1 to elevation in canvas coordinates.
// elevationRes:
// r: elevation min; g: elevation step; b: max pixel value (likely 255); a: canvas size / distance
// u.EV_elevationResolution = [elevationMin, elevationStep, maximumPixelValue, elevationMult];
GLSLFunctions.canvasElevationFromPixel =
`
float canvasElevationFromPixel(in float pixel, in vec4 elevationRes) {
  return (elevationRes.r + (pixel * elevationRes.b * elevationRes.g)) * elevationRes.a;
}
`;

// Orientation just like foundry.utils.orient2dFast
GLSLFunctions.orient2d =
`
float orient2d(in vec2 a, in vec2 b, in vec2 c) {
  return (a.y - c.y) * (b.x - c.x) - (a.x - c.x) * (b.y - c.y);
}
`;

// Calculate barycentric position within a given triangle
GLSLFunctions.barycentric3d =
`
vec3 barycentric3d(in vec3 p, in vec3 a, in vec3 b, in vec3 c) {
  vec3 v0 = b - a; // Fixed for given triangle
  vec3 v1 = c - a; // Fixed for given triangle
  vec3 v2 = p - a;

  float d00 = dot(v0, v0); // Fixed for given triangle
  float d01 = dot(v0, v1); // Fixed for given triangle
  float d11 = dot(v1, v1); // Fixed for given triangle
  float d20 = dot(v2, v0);
  float d21 = dot(v2, v1);

  float denomInv = 1.0 / ((d00 * d11) - (d01 * d01)); // Fixed for given triangle
  float v = ((d11 * d20) - (d01 * d21)) * denomInv;
  float w = ((d00 * d21) - (d01 * d20)) * denomInv;
  float u = 1.0 - v - w;

  return vec3(u, v, w);
}
`;

GLSLFunctions.barycentric2d =
`
vec3 barycentric2d(in vec2 p, in vec2 a, in vec2 b, in vec2 c) {
  vec2 v0 = b - a;
  vec2 v1 = c - a;
  vec2 v2 = p - a;

  float d00 = dot(v0, v0); // Fixed for given triangle
  float d01 = dot(v0, v1); // Fixed for given triangle
  float d11 = dot(v1, v1); // Fixed for given triangle
  float d20 = dot(v2, v0);
  float d21 = dot(v2, v1);

  float denomInv = 1.0 / ((d00 * d11) - (d01 * d01)); // Fixed for given triangle
  float v = ((d11 * d20) - (d01 * d21)) * denomInv;
  float w = ((d00 * d21) - (d01 * d20)) * denomInv;
  float u = 1.0 - v - w;

  return vec3(u, v, w);
}
`;


// Identify closest point on a 2d line to another point, just like foundry.utils.closestPointToSegment.
// Note: will fail if passed a 0-length ab segment.
GLSLFunctions.closest2dPointToLine =
`
vec2 closest2dPointToLine(in vec2 c, in vec2 a, in vec2 dir, out float u) {
  float denom = dot(dir, dir);
  if ( denom == 0.0 ) return a;

  vec2 deltaCA = c - a;
  u = dot(deltaCA, dir) / denom;
  return a + (u * dir);
}
`;

GLSLFunctions.closest2dPointToSegment =
`
${GLSLFunctions.closest2dPointToLine}
vec2 closest2dPointToSegment(in vec2 c, in vec2 a, in vec2 b) {
  float u;
  vec2 out = closest2dPointToLine(c, a, b - a, u);

  if ( u < 0.0 ) return a;
  if ( u > 1.0 ) return b;
  return out;
}
`;

GLSLFunctions.lineLineIntersection2d =
`
bool lineLineIntersection2d(in vec2 a, in vec2 dirA, in vec2 b, in vec2 dirB, out vec2 ix) {
  float denom = (dirB.y * dirA.x) - (dirB.x * dirA.y);

  // If lines are parallel, no intersection.
  if ( abs(denom) < 0.0001 ) return false;

  vec2 diff = a - b;
  float t = ((dirB.x * diff.y) - (dirB.y * diff.x)) / denom;
  ix = a + (dirA * t);
  return true;
}
`

// For debugging.
GLSLFunctions.stepColor =
`
// 0: Black
// Red is near 0; blue is near 1.
// 0.5: purple
vec3 stepColor(in float ratio) {
  if ( ratio < 0.2 ) return vec3(smoothstep(0.0, 0.2, ratio), 0.0, 0.0);
  if ( ratio < 0.4 ) return vec3(smoothstep(0.2, 0.4, ratio), smoothstep(0.2, 0.4, ratio), 0.0);
  if ( ratio == 0.5 ) return vec3(0.5, 0.0, 0.5);
  if ( ratio < 0.6 ) return vec3(0.0, smoothstep(0.4, 0.6, ratio), 0.0);
  if ( ratio < 0.8 ) return vec3(0.0, smoothstep(0.6, 0.8, ratio), smoothstep(0.6, 0.8, ratio));
  return vec3(0.0, 0.0, smoothstep(0.8, 1.0, ratio));
}`;

GLSLFunctions.intersectRayPlane =
`
// Note: lineDirection and planeNormal should be normalized.
bool intersectRayPlane(vec3 linePoint, vec3 lineDirection, vec3 planePoint, vec3 planeNormal, out vec3 ix) {
  float denom = dot(planeNormal, lineDirection);

  // Check if line is parallel to the plane; no intersection
  if (abs(denom) < 0.0001) return false;

  float t = dot(planeNormal, planePoint - linePoint) / denom;
  ix = linePoint + lineDirection * t;
  return true;
}`;

GLSLFunctions.intersectRayQuad =
`
${GLSLFunctions.intersectRayPlane}

// Note: lineDirection and planeNormal should be normalized.
bool intersectRayQuad(vec3 linePoint, vec3 lineDirection, vec3 v0, vec3 v1, vec3 v2, vec3 v3, out vec3 ix) {
  vec3 planePoint = v0;
  vec3 diff01 = v1 - v0;
  vec3 diff02 = v2 - v0;
  vec3 planeNormal = cross(diff01, diff02);
  if ( !intersectRayPlane(linePoint, lineDirection, planePoint, planeNormal, ix) ) return false;

  // Check if the intersection point is within the bounds of the quad.
  vec3 quadMin = min(v0, min(v1, min(v2, v3)));
  vec3 quadMax = max(v0, max(v1, max(v2, v3)));
  return all(greaterThan(ix, quadMin)) && all(lessThan(ix, quadMax));
}`;


let shadowTransparentTileShaderGLSL = {};
shadowTransparentTileShaderGLSL.vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform float uCanvasElevation;
uniform vec3 uLightPosition;
uniform float uLightSize;
uniform float uOffsetPercentage;

in vec3 aVertexPosition;
in vec2 aTexCoord;

out vec3 vertexPosition;
out vec2 vTexCoord;


${GLSLFunctions.intersectRayPlane}

void main() {
  vTexCoord = aTexCoord;
  vertexPosition = aVertexPosition;

  // Intersect the canvas plane: Light --> vertex --> plane.
  vec3 planeNormal = vec3(0.0, 0.0, 1.0);
  vec3 planePoint = vec3(0.0);
  vec3 lineDirection = normalize(aVertexPosition - uLightPosition);
  vec3 ix;
  bool ixFound = intersectRayPlane(uLightPosition, lineDirection, planePoint, planeNormal, ix);
  if ( !ixFound ) {
    // Shouldn't happen, but...
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition.xy, 1.0)).xy, 0.0, 1.0);
    return;
  }

  // TODO: Make this a define/ifdef
  // Offset by some percentage of the penumbra radius.
  if ( uOffsetPercentage > 0.0 ) {
    float ixDist = distance(uLightPosition, ix);
    float vertexDist = distance(uLightPosition, aVertexPosition);
    float penumbraProjectionRatio = vertexDist / (ixDist - vertexDist);
    float lightSizeProjected = uLightSize * penumbraProjectionRatio;
    vec3 dir = normalize(aVertexPosition - uLightPosition);
    float offsetAmount = lightSizeProjected * uOffsetPercentage;
    ix = uLightPosition + dir * (ixDist + offsetAmount);
  }

  vertexPosition = ix;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(ix.xy, 1.0)).xy, 0.0, 1.0);
}
`;

shadowTransparentTileShaderGLSL.fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;

#define ALPHA_THRESHOLD ${CONFIG[MODULE_ID].alphaThreshold.toFixed(1)}

uniform sampler2D uTileTexture;
uniform float uShadowPercentage;

in vec3 vertexPosition;
in vec2 vTexCoord;

out vec4 fragColor;

void main() {
  vec4 texColor = texture(uTileTexture, vTexCoord);
  float shadow = texColor.a < ALPHA_THRESHOLD ? 0.0 : uShadowPercentage;
  fragColor = vec4(1.0 - shadow, vec3(1.0));
}`;


let wallShadowShaderGLSL = {};
wallShadowShaderGLSL.vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform float uCanvasElevation;
uniform vec3 uLightPosition;
uniform float uLightSize;
uniform float uMaxR;

in vec3 aVertexPosition;
in vec3 aWallCorner1;
in vec3 aWallCorner2;
in float aTerrain;

out vec3 vBary;
out vec3 vSidePenumbra1;
out vec3 vSidePenumbra2;
out float vTerrain; // TODO: Would this be faster as flat or varying?
out vec3 vVertexPosition; // For setting terrain elevation

flat out vec3 nearRatios;
flat out vec3 farRatios;

// Debugging
flat out vec3 testPoint1;
flat out vec3 testPoint2;
flat out vec3 testPoint3;

${GLSLFunctions.intersectRayPlane}
${GLSLFunctions.barycentric2d}
${GLSLFunctions.barycentric3d}

void main() {
  // Shadow is constituted of an outer and inner penumbra.
  // Outer penumbra: Fragment can see the light center without occlusion by the wall but
  //   cannot see the full light.
  // Inner penumbra: Fragment cannot see the light center but can see a portion of the light.
  // Full shadow (Umbra): Fragment cannot see the light due to occlusion by the wall.

  // Construct triangles and set different barycentric coordinates for each to test in fragment shader.
  // 1. Outer triangle ABC
  //    A: light center
  //    B: outer penumbra corner 1
  //    C: outer penumbra corner 2
  // 2. Side penumbra p1ABC
  //    p1A: corner 1 (A)
  //    p1B: inner penumbra corner 1
  //    p1C: outer penumbra corner 1 (B)
  // 3. Side penumbra p2ABC. Same as (3) but for corner 2.

  // Also determine flat values to test against 1.x coordinates:
  // 1. wall location -- test if a fragment is between the wall and the light.
  // 2. far mid penumbra
  // 3. far umbra
  // 4. near penumbra (if wall bottom is above the minimum elevation)
  // 5. near mid penumbra
  // 6. near umbra -- this is equivalent to (1)

  // Pass the wall type.
  vTerrain = aTerrain;

  // Plane describing the canvas at elevation.
  vec3 planeNormal = vec3(0.0, 0.0, 1.0);
  vec3 planePoint = vec3(0.0, 0.0, uCanvasElevation);

  // Points for the light in the z direction
  vec3 lightTop = uLightPosition + vec3(0.0, 0.0, uLightSize);
  vec3 lightCenter = uLightPosition;
  vec3 lightBottom = uLightPosition + vec3(0.0, 0.0, -uLightSize);
  lightBottom.z = max(lightBottom.z, uCanvasElevation);

  // Wall coordinates
  float wallTopZ = aWallCorner1.z;
  float wallBottomZ = aWallCorner2.z;
  vec3 wallTop1 = aWallCorner1;
  vec3 wallTop2 = vec3(aWallCorner2.xy, aWallCorner1.z);
  vec3 wallBottom1 = vec3(aWallCorner1.xy, aWallCorner2.z);
  vec3 wallBottom2 = aWallCorner2;

  // 1. Outer triangle ABC
  // Intersect the canvas plane: Light --> vertex --> plane.
  // If the light is below or equal to the vertex in elevation, the shadow has infinite length, represented here by uMaxR.
  vec3 maxShadowVertex = lightCenter + (normalize(aWallCorner1 - lightCenter) * uMaxR);
  vec3 ixFarPenumbra1 = maxShadowVertex;       // End of penumbra parallel to wall at far end.
  vec3 ixFarPenumbra2 = maxShadowVertex;       // End of penumbra parallel to wall at far end.
  if ( lightBottom.z > wallTopZ ) {
    intersectRayPlane(lightBottom, normalize(wallTop1 - lightBottom), planePoint, planeNormal, ixFarPenumbra1);
    intersectRayPlane(lightBottom, normalize(wallTop2 - lightBottom), planePoint, planeNormal, ixFarPenumbra2);
  }

  // Use similar triangles to calculate the length of the side penumbra at the end of the trapezoid.
  // Two similar triangles formed:
  // 1. E-R-L: wall endpoint -- light radius point -- light
  // 2. E-C-D: wall endpoint -- penumbra top -- penumbra bottom
  /*
  Trapezoid
           . C
  L.      /|
   | \ E/  |
   |  /º\  |
   |/     \|
  Rº       º D
  */
  // In diagram above, C and D represent the edge of the inner penumbra.
  // Add lightSizeProjected to CD to get the outer penumbra.

  // Determine the lightSize circle projected at this vertex.
  // Pass the ratio of lightSize projected / length of shadow to fragment to draw the inner side penumbra.
  // Ratio of two triangles is k. Use inverse so we can multiply to get lightSizeProjected.
  // NOTE: Distances must be 2d in order to obtain the correct ratios.
  float distWallTop1 = distance(lightCenter.xy, wallTop1.xy);
  float distShadow = distance(lightCenter.xy, ixFarPenumbra1.xy);
  float invK = (distShadow - distWallTop1) / distWallTop1;
  float lightSizeProjected = uLightSize * invK;

  // Shift the penumbra by the projected light size.
  vec3 dir = normalize(wallTop1 - wallTop2);
  vec3 dirSized = dir * lightSizeProjected;
  vec3 outerPenumbra1 = ixFarPenumbra1 + dirSized;
  vec3 outerPenumbra2 = ixFarPenumbra2 - dirSized;
  vec3 innerPenumbra1 = ixFarPenumbra1 - dirSized;
  vec3 innerPenumbra2 = ixFarPenumbra2 + dirSized;

  // Set far and near ratios:
  // x: penumbra; y: mid-penumbra; z: umbra
  float wallRatio = 1.0 - (distWallTop1 / distShadow); // mid-penumbra
  nearRatios = vec3(wallRatio);
  farRatios = vec3(0.0); // 0.0 is the penumbra value (0 at shadow end)

  if ( lightCenter.z > wallTopZ ) {
    vec3 ixFarMidPenumbra1 = maxShadowVertex;
    intersectRayPlane(lightCenter, normalize(wallTop1 - lightCenter), planePoint, planeNormal, ixFarMidPenumbra1);
    farRatios.y = 1.0 - (distance(lightCenter.xy, ixFarMidPenumbra1.xy) / distShadow);
  }

  if ( lightTop.z > wallTopZ ) {
    vec3 ixFarUmbra1 = maxShadowVertex;
    intersectRayPlane(lightTop, normalize(wallTop1 - lightTop), planePoint, planeNormal, ixFarUmbra1);
    farRatios.z = 1.0 - (distance(lightCenter.xy, ixFarUmbra1.xy) / distShadow);
  }

  if ( wallBottomZ > uCanvasElevation ) {
    if ( lightTop.z > wallBottomZ ) {
      vec3 ixNearPenumbra1;
      intersectRayPlane(lightTop, normalize(wallBottom1 - lightTop), planePoint, planeNormal, ixNearPenumbra1);
      nearRatios.x = 1.0 - (distance(lightCenter.xy, ixNearPenumbra1.xy) / distShadow);
    }

    if ( lightBottom.z > wallBottomZ) {
      vec3 ixNearUmbra1;
      intersectRayPlane(lightBottom, normalize(wallBottom1 - lightBottom), planePoint, planeNormal, ixNearUmbra1);
      nearRatios.z = 1.0 - (distance(lightCenter.xy, ixNearUmbra1.xy) / distShadow);
    }
  }

  // Big triangle ABC is the bounds of the potential shadow.
  // Set by the newVertex varying to the vertices.
  //   A = lightCenter;
  //   B = outerPenumbra1;
  //   C = outerPenumbra2;

  vec3 newVertex;
  switch ( gl_VertexID % 3 ) {
    case 0:
      vBary = vec3(1, 0, 0);
      newVertex = lightCenter;
      break;

    case 1:
      vBary = vec3(0, 1, 0);
      newVertex = outerPenumbra1;
      break;

    case 2:
      vBary = vec3(0, 0, 1);
      newVertex = outerPenumbra2;
  }
  vVertexPosition = newVertex;

  // Penumbra1 triangle
  vec2 p1A = wallTop1.xy;
  vec2 p1B = outerPenumbra1.xy;
  vec2 p1C = innerPenumbra1.xy;

  // Penumbra2 triangle
  vec2 p2A = wallTop2.xy;
  vec2 p2C = innerPenumbra2.xy;
  vec2 p2B = outerPenumbra2.xy;

  vSidePenumbra1 = barycentric2d(newVertex.xy, p1A, p1B, p1C);
  vSidePenumbra2 = barycentric2d(newVertex.xy, p2A, p2B, p2C);

  testPoint1 = lightCenter;
  testPoint2 = outerPenumbra1;
  testPoint3 = outerPenumbra2;

  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(newVertex.xy, 1.0)).xy, 0.0, 1.0);
}`;

wallShadowShaderGLSL.fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

uniform sampler2D uElevationMap;
uniform vec4 uElevationResolution; // min, step, maxpixel, multiplier
uniform float uCanvasElevation;
uniform vec4 uSceneDims;
uniform vec3 uLightPosition;
uniform float uLightSize;

in vec3 vBary;
in vec3 vSidePenumbra1;
in vec3 vSidePenumbra2;
in float vTerrain;
in vec3 vVertexPosition;

flat in vec3 nearRatios;
flat in vec3 farRatios;

// Debugging
flat in vec3 testPoint1;
flat in vec3 testPoint2;
flat in vec3 testPoint3;

out vec4 fragColor;

${GLSLFunctions.intersectRayQuad}
${GLSLFunctions.canvasElevationFromPixel}
${GLSLFunctions.stepColor}
${GLSLFunctions.orient2d}
${GLSLFunctions.closest2dPointToLine}
${GLSLFunctions.lineLineIntersection2d}
${GLSLFunctions.barycentric2d}
${GLSLFunctions.barycentric3d}

// Linear conversion from one range to another.
float linearConversion(in float x, in float oldMin, in float oldMax, in float newMin, in float newMax) {
  return (((x - oldMin) * (newMax - newMin)) / (oldMax - oldMin)) + newMin;
}

// For debugging
// Split 0–1 into a set of distinct values.
float stepRatio(in float ratio, in float numDistinct) {
  if ( ratio < 0.0 ) return 0.0;
  if ( ratio > 1.0 ) return 1.0;
  float breaks = 1.0 / numDistinct;
  while ( true ) {
    if ( ratio < breaks ) return breaks;
    breaks += breaks;
  }
}

vec4 lightColor(in float light) {
  float terrain = float(vTerrain > 0.5);
  float tMinus = 1.0 - terrain;

  // nonTerrainLight, wallType, terrainLight, alpha=1
  // e.g.
  // light = .8
  // terrain = 0: 0.8, 1.0, 1.0
  // terrain = 1: 1.0, 0.5, 0.8

  // r: (.8 * (1. - terrain)) + terrain
  // g: 1.0 - (0.5 * terrain)
  // b: (.8 * terrain) + (1 - terrain)

  return vec4((light * tMinus) + terrain, 1.0 - (0.5 * terrain), (light * terrain) + tMinus, 1.0);
}

// For debugging
bool colorAtPoint(in vec3 targetPoint, in vec3 testPoint, in float tol) {
  float dist = distance(targetPoint.xy, testPoint.xy);
  return dist < tol;
}

void main() {

  // vBary.x is the distance from the light, where 1 = at light; 0 = at edge.
  // vBary.y is distance from A endpoint (transposed), where 1 = at A.
  // vBary.z is distance from B endpoint (transposed), where 1 = at B.

  // vSidePenumbra1.x is 1 where the wall line would meet the light center --> corner 1 (a endpoint transposed);

//   fragColor = vec4(stepColor(vBary.x), 0.3);
//   return;

//   fragColor = vec4(vec3(lessThan(vec3(vBary.x), nearRatios)), 1.0);
//   return;


//   if ( colorAtPoint(testPoint1, vVertexPosition, 20.0) ) {
//     fragColor = vec4(1.0, 0.0, 0.0, 0.8);
//   } else if ( colorAtPoint(testPoint2, vVertexPosition, 20.0) ) {
//     fragColor = vec4(0.0, 1.0, 0.0, 0.8);
//   } else if ( colorAtPoint(testPoint3, vVertexPosition, 20.0) ) {
//     fragColor = vec4(0.0, 0.0, 1.0, 0.8);
//   } else {
//     fragColor = vec4(vec3(0.0), 0.1);
//   }

//     if ( colorAtPoint(testPoint1, vBary, 0.1) ) {
//       fragColor = vec4(1.0, 0.0, 0.0, 0.8);
//     } else if ( colorAtPoint(testPoint2, vBary, 0.1) ) {
//       fragColor = vec4(0.0, 1.0, 0.0, 0.8);
//     } else if ( colorAtPoint(testPoint3, vVertexPosition, 20.0) ) {
//       fragColor = vec4(0.0, 0.0, 1.0, 0.8);
//     } else {
//       fragColor = vec4(vec3(0.0), 0.1);
//     }


//   if ( all(greaterThanEqual(vSidePenumbra2, vec3(0.0))) ) fragColor = vec4(vSidePenumbra2, 0.3);
//   // else if ( all(greaterThanEqual(vSidePenumbra2, vec3(0.0))) ) fragColor = vec4(vSidePenumbra2, 0.3);
//   else if ( vSidePenumbra2.x > 0.0 && vSidePenumbra2.y < 0.0 && vSidePenumbra2.z > 0.0 ) fragColor = vec4(1.0, 0.0, 0.0, 1.0);
//   else if ( vSidePenumbra2.x > 0.0 && vSidePenumbra2.y > 0.0 && vSidePenumbra2.z < 0.0 ) fragColor = vec4(0.0, 1.0, 0.0, 1.0);
//   else if ( vSidePenumbra2.x < 0.0 && vSidePenumbra2.y > 0.0 && vSidePenumbra2.z > 0.0 ) fragColor = vec4(0.0, 0.0, 1.0, 1.0);
//   else fragColor = vec4(vec3(0.0), 0.1);


// Sames for vSidePenumbra2
//   vSidePenumbra1.xz > 0, vSidePenumbra1.y < 0: In full shadow or outside shadow to the left, incl. some in front of wall
//   vSidePenumbra1.xy > 0, vSidePenumbra1.z < 0: Outside the penumbra incl. some in front of wall
//   vSidePenumbra1.yz > 0, vSidePenumbra1.x < 0: Does not occur within the vertex shape (likely past the far shadow line)

  if ( vBary.x > nearRatios.x ) {
    // Fragment is in front of wall.
    fragColor = vec4(0.0);
    // fragColor = vec4(vec3(1.0), 0.0);
    return;
  }

  if ( vSidePenumbra2.x > 0.0 && vSidePenumbra2.y > 0.0 && vSidePenumbra2.z < 0.0 ) {
    // Fragment is outside the side penumbras
    fragColor = vec4(0.0);
    // fragColor = vec4(vec3(1.0), 0.0);
    return;
  }

  if ( vSidePenumbra1.x > 0.0 && vSidePenumbra1.y > 0.0 && vSidePenumbra1.z < 0.0 ) {
    // Fragment is outside the side penumbras
    fragColor = vec4(0.0);
    // fragColor = vec4(vec3(1.0), 0.0);
    return;
  }

  bool inSidePenumbra1 = all(greaterThanEqual(vSidePenumbra1, vec3(0.0)));
  bool inSidePenumbra2 = all(greaterThanEqual(vSidePenumbra2, vec3(0.0)));

  // Near/far penumbra
  // x: penumbra; y: mid-penumbra; z: umbra
  bool inFarPenumbra = vBary.x < farRatios.z; // And vBary.x > 0.0.
  bool inNearPenumbra = vBary.x > nearRatios.z; // And vBary.x <= nearRatios.x; handled by in front of wall test.

//   if ( inFarPenumbra ) {
//     fragColor = vec4(0.5, 0, 0.5, 0.5);
//   } else if ( inNearPenumbra ) {
//     fragColor = vec4(1.0, 0.0, 1.0, 0.5);
//   } else if ( inSidePenumbra1 ) {
//     fragColor = vec4(1.0, 0.0, 0.0, 0.7);
//   } else if ( inSidePenumbra2 ) {
//     fragColor = vec4(0.0, 0.0, 1.0, 0.7);
//   } else  {
//     fragColor = vec4(vec3(1.0), 0.7);
//   }

//   if ( inSidePenumbra1 ) {
//     fragColor = vec4(stepColor(vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z)), 0.7);
//   } else if ( inSidePenumbra2 ) {
//     fragColor = vec4(stepColor(vSidePenumbra2.z / (vSidePenumbra2.y + vSidePenumbra2.z)), 0.7);
//   }

  float percentShadow = 1.0;
  if ( inFarPenumbra ) {
    bool inLighterPenumbra = vBary.x < farRatios.y;
    float penumbraPercentShadow = inLighterPenumbra
      ? linearConversion(vBary.x, 0.0, farRatios.y, 0.0, 0.5)
      : linearConversion(vBary.x, farRatios.y, farRatios.z, 0.5, 1.0);

    percentShadow = min(percentShadow, penumbraPercentShadow);
    //fragColor = vec4(vec3(0.0), penumbraPercentShadow);
  }

  // TODO: inNearPenumbra

  if ( inSidePenumbra1 ) {
    float penumbraPercentShadow = vSidePenumbra1.z / (vSidePenumbra1.y + vSidePenumbra1.z);
    percentShadow = min(percentShadow, penumbraPercentShadow);
    //fragColor = vec4(vec3(0.0), penumbraPercentShadow);
  }

  if ( inSidePenumbra2 ) {
    float penumbraPercentShadow = vSidePenumbra2.z / (vSidePenumbra2.y + vSidePenumbra2.z);
    percentShadow = min(percentShadow, penumbraPercentShadow);
    //fragColor = vec4(vec3(0.0), penumbraPercentShadow);
  }
  fragColor = vec4(vec3(0.0), percentShadow);






  // Options:
  // - in front of wall---dismiss early
  // - elevation anywhere: shoot ray at light center
  // - within the l/r border: shoot ray at outer or inner light radius and check for wall intersection.
  // - within the t/b border: same
  // - otherwise can assume full shadow.
  // If within border, transparency based on ratio.

  // Check if fragment is in front of the wall.
//   if ( vWallRatio < wallRatio ) {
//     fragColor = vec4(1.0, 1.0, 0.0, 0.3);
//     //fragColor = vec4(vec3(1.0), 0.0);
//     return;
//   }
//
//   // What is the terrain elevation of this fragment?
//   float elevation = uCanvasElevation;
//   bool highElevation = false;
//   vec2 evTexCoord = (vVertexPosition.xy - uSceneDims.xy) / uSceneDims.zw;
//
//   if ( any(lessThan(evTexCoord, vec2(0.0)))
//     || any(greaterThan(evTexCoord, vec2(1.0))) ) {
//     // Outside the scene bounds.
//     fragColor = vec4(1.0, 0.0, 1.0, 0.7); // debugging
//     return;
//   }
//
//   if ( all(lessThan(evTexCoord, vec2(1.0)))
//     && all(greaterThan(evTexCoord, vec2(0.0))) ) {
//     // Inside the scene bounds. Check elevation texture.
//     vec4 evTexel = texture(uElevationMap, evTexCoord);
//     elevation = canvasElevationFromPixel(evTexel.r, uElevationResolution);
//     highElevation = elevation > uCanvasElevation;
//   }
//
//   // Input variables that may be adjusted later.
//   float localSidePenumbraRatio = sidePenumbraRatio;
//   float localNearFarPenumbraRatio = nearFarPenumbraRatio;
//   vec3 localBary = vBary;
//
//   // If the terrain of this fragment is above the minimum, adjust calculations accordingly.
//   // 1. Adjust the perceived intersection of the light --> vertex with the canvas.
//   // 2. Adjust sidePenumbraRatio
//   // 3. Adjust nearFarPenumbraRatio
//   // 4. Adjust barymetric x value (near/far from light)
//   // 5. Determine if still in shadow
//
//   if ( highElevation ) {
//      // Intersect the canvas plane: Light --> wall endpoint --> plane
//      vec3 planeNormal = vec3(0.0, 0.0, 1.0);
//      vec3 planePoint = vec3(0.0, 0.0, elevation);
//      vec3 lineDirection = normalize(corner1 - uLightPosition);
//      vec3 ix;
//      bool ixFound = intersectRayPlane(uLightPosition, lineDirection, planePoint, planeNormal, ix);
//      if ( !ixFound ) {
//        // Shouldn't happen, but...
//        fragColor = vec4(vec3(1.0), 0.0);
//      }
//
//      float vertexDist = distance(uLightPosition.xy, corner1.xy);
//      float ixDist = distance(uLightPosition.xy, ix.xy);
//
//      float invK = (ixDist - vertexDist) / vertexDist;
//      float lightSizeProjected = uLightSize * invK;
//
//      float abDist = distance(corner1.xy, corner2.xy);
//      float ABDist = abDist * (ixDist / vertexDist);
//      localSidePenumbraRatio = lightSizeProjected / ABDist;
//      localNearFarPenumbraRatio = lightSizeProjected / ixDist;
//
//      // Barymetric.x, where 0 is edge, will change.
//      float origIxDist = vertexDist / wallRatio;
//      float newZeroRatio = 1.0 - (ixDist / origIxDist);
//      localBary.x = linearConversion(localBary.x, newZeroRatio, 1.0, 0.0, 1.0);
//      if ( localBary.z < 0.0 ) {
//        // No longer within the shadow.
//        fragColor = vec4(1.0, 1.0, 0.0, 0.3);
//        //fragColor = vec4(vec3(1.0), 0.0);
//      }
//   }
//
//   // Are we possibly within the l/r penumbra border?
//   // (Could be within both if the light size is large or wall is small.)
//   // This border is overly inclusive and so location must be confirmed with additional tests.
//   float lrRatio = localBary.z / (localBary.y + localBary.z);
//   bool withinL = lrRatio < localSidePenumbraRatio;
//   bool withinR = (1.0 - lrRatio) < localSidePenumbraRatio;
//
//   // Are we possibly within the far penumbra border?
//   bool withinFar = localBary.x < localNearFarPenumbraRatio;
//
//   // If not high terrain and not in penumbra, in full shadow.
//   if ( !withinFar && !withinL && !withinR && !highElevation ) {
//     fragColor = vec4(vec3(0.0), 0.7);
//     //fragColor = lightColor(0.0);
//     return;
//   } else if ( withinL ) {
//     fragColor = vec4(1.0, 0.0, 0.0, 0.7);
//   } else if ( withinR ) {
//     fragColor = vec4(0.0, 0.0, 1.0, 0.7);
//   } else if ( withinFar ) {
//     fragColor = vec4(0.5, 0.0, 0.5, 0.7);
//   } else if ( highElevation ) {
//     fragColor = vec4(0.0, 1.0, 0.0, 0.7);
//   }
//   return;
//
//   // If the fragment is not between the two outer penumbra, it is in full light.
//   // (Note: angle of the shadow from the light is always less than 180º, so this holds.)
//   float oOuterPenumbra1 = orient2d(corner1.xy, outerPenumbra1, vVertexPosition.xy);
//   float oOuterPenumbra2 = orient2d(corner2.xy, outerPenumbra2, vVertexPosition.xy);
//   if ( sign(oOuterPenumbra1) != sign(-oOuterPenumbra2) ) {
//     fragColor = vec4(1.0, 1.0, 0.0, 0.3);
//     //fragColor = vec4(vec3(1.0), 0.0);
//     return;
//   }
//
//   // If the fragment is between the two inner penumbra, it is in full shadow unless near trapezoid end.
//   float oInnerPenumbra1 = orient2d(corner1.xy, innerPenumbra1, vVertexPosition.xy);
//   float oInnerPenumbra2 = orient2d(corner2.xy, innerPenumbra2, vVertexPosition.xy);
//   bool withinUmbra = sign(oInnerPenumbra1) == sign(-oInnerPenumbra2);
//   if ( withinUmbra && !withinFar ) {
//     fragColor = vec4(vec3(0.0), 0.7);
//     //fragColor = lightColor(0.0);
//     return;
//   }
//
//   // Fragment within 1 or both penumbra or at the far end of the trapezoid.
//   bool withinPenumbra1 = sign(oInnerPenumbra1) == sign(-oOuterPenumbra1);
//   bool withinPenumbra2 = sign(oInnerPenumbra2) == sign(-oOuterPenumbra2);
//
// //   if ( withinPenumbra1 ) {
// //     fragColor = vec4(1.0, 0.0, 0.0, 0.7);
// //   } else if ( withinPenumbra2 ) {
// //     fragColor = vec4(0.0, 0.0, 1.0, 0.7);
// //   } else if ( withinFar ) {
// //     fragColor = vec4(0.5, 0.0, 0.5, 0.7);
// //   } else if ( highElevation ) {
// //     fragColor = vec4(0.0, 1.0, 0.0, 0.7);
// //   }
// //   return;
//
//   // Use the lines at either edge of the penumbra to calculate a percent shadow for left/right penumbra.
//   // Take the distance to the light edge divided by the total distance.
//   // Possible for the fragment to be within all three options...
//   float shadow1Percent = 1.0;
//   float shadow2Percent = 1.0;
//   float shadowFarPercent = 1.0;
//   if ( withinPenumbra1 ) {
//     vec2 outerIx;
//     vec2 innerIx;
//     vec2 dir12 = corner1.xy - corner2.xy;
//     lineLineIntersection2d(corner1.xy, corner1.xy - outerPenumbra1, vVertexPosition.xy, dir12, outerIx);
//     lineLineIntersection2d(corner1.xy, corner1.xy - innerPenumbra1, vVertexPosition.xy, dir12, outerIx);
//     shadow1Percent = distance(vVertexPosition.xy, outerIx) / distance(outerIx, innerIx);
//   }
//
//   if ( withinPenumbra2 ) {
//     vec2 outerIx;
//     vec2 innerIx;
//     vec2 dir12 = corner1.xy - corner2.xy;
//     lineLineIntersection2d(corner2.xy, corner2.xy - outerPenumbra1, vVertexPosition.xy, dir12, outerIx);
//     lineLineIntersection2d(corner2.xy, corner2.xy - innerPenumbra1, vVertexPosition.xy, dir12, outerIx);
//     shadow2Percent = distance(vVertexPosition.xy, outerIx) / distance(outerIx, innerIx);
//   }
//
//   if ( withinFar ) shadowFarPercent = localBary.x / localNearFarPenumbraRatio;
//
//   float penumbraShadowPercent = min(shadowFarPercent, min(shadow1Percent, shadow2Percent));
//
//   fragColor = vec4(0.0, 0.0, 1.0 - penumbraShadowPercent, 0.7);
  // fragColor = lightColor(1.0 - penumbraShadowPercent);
}`;

let terrainShadowShaderGLSL = {};
terrainShadowShaderGLSL.vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
in vec3 aVertexPosition;
in vec2 aTexCoord;

out vec2 vTexCoord;

void main() {
  vTexCoord = aTexCoord;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition.xy, 1.0)).xy, 0.0, 1.0);
}`;

terrainShadowShaderGLSL.fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;

uniform sampler2D shadowMap;
in vec2 vTexCoord;
out vec4 fragColor;

void main() {
  // Pull the texel to check for terrain flag.
  vec4 texel = texture(shadowMap, vTexCoord);
  float lightAmount = texel.r;

  // If more than 1 terrain wall at this point, add to the shadow.
  // If a single terrain wall, ignore.
  if ( texel.g < 0.3 ) lightAmount *= texel.b;
  fragColor = vec4(lightAmount, vec3(1.0));
}`;


/**
 * Primarily for debugging.
 * Given a shadow map, render the shadow as black area, fading to transparent where only a
 * partial shadow exists.
 * This does not handle terrain walls. (See terrainShadowShaderGLSL.)
 */
renderShadowShaderGLSL = {};
renderShadowShaderGLSL.vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
in vec3 aVertexPosition;
in vec2 aTexCoord;

out vec2 vTexCoord;

void main() {
  vTexCoord = aTexCoord;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition.xy, 1.0)).xy, 0.0, 1.0);
}`;

renderShadowShaderGLSL.fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;

uniform sampler2D shadowMap;
in vec2 vTexCoord;
out vec4 fragColor;

void main() {
  vec4 texel = texture(shadowMap, vTexCoord);

  // If all 1s, then this is simply a light area that we can ignore.
  if ( all(equal(texel, vec4(1.0))) ) {
    fragColor = vec4(vec3(1.0), 0.0);
    return;
  }

  float lightAmount = texel.r;
  // If more than 1 terrain wall at this point, add to the shadow.
  // If a single terrain wall, ignore.
  if ( texel.g < 0.3 ) lightAmount *= texel.b;
  fragColor = vec4(vec3(0.0), 1.0 - lightAmount);
}`;

renderElevationTestGLSL = {};
renderElevationTestGLSL.vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
in vec3 aVertexPosition;
out vec3 vVertexPosition;

void main() {
  vVertexPosition = aVertexPosition;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition.xy, 1.0)).xy, 0.0, 1.0);
}`;

renderElevationTestGLSL.fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;

uniform sampler2D uElevationMap;
uniform vec4 uElevationResolution;
uniform vec4 uSceneDims;
in vec3 vVertexPosition;
out vec4 fragColor;

${GLSLFunctions.canvasElevationFromPixel}
${GLSLFunctions.stepColor}

void main () {
  // Elevation map spans the scene rectangle. Offset from canvas coordinate accordingly.
  vec2 evTexCoord = (vVertexPosition.xy - uSceneDims.xy) / uSceneDims.zw;

  if ( any(lessThan(evTexCoord, vec2(0.0)))
    || any(greaterThan(evTexCoord, vec2(1.0))) ) {
    fragColor = vec4(vec3(0.0), 0.2);
    return;
  }

  vec4 evTexel = texture(uElevationMap, evTexCoord);
  float elevation = canvasElevationFromPixel(evTexel.r, uElevationResolution);

  if ( elevation == 30.0 * uElevationResolution.a ) {
    fragColor = vec4(0.0, 0.0, 1.0, 0.7);
  } else if ( elevation == 10.0 * uElevationResolution.a ) {
    fragColor = vec4(0.0, 1.0, 0.0, 0.7);
  } else if ( elevation > 0.0 ) {
    fragColor = vec4(1.0, 0.0, 0.0, 0.7);
  } else {
    fragColor = vec4(vec3(0.0), 0.2);
  }

  // For testing, simply color the fragment using a ratio of elevation.
//   float elevationMin = uElevationResolution.r;
//   if ( elevation <= elevationMin ) {
//     fragColor = vec4(vec3(0.0), 0.2);
//   } else {
//     fragColor = vec4(stepColor(elevation / 1000.0), 0.7);
//   }
}`;

renderElevationTest2GLSL = {};
renderElevationTest2GLSL.vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
in vec3 aVertexPosition;
in vec2 aElevationCoord;
out vec2 vElevationCoord;

void main() {
  vElevationCoord = aElevationCoord;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition.xy, 1.0)).xy, 0.0, 1.0);
}`;

renderElevationTest2GLSL.fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;

uniform sampler2D uElevationMap;
uniform vec4 uElevationResolution;
in vec2 vElevationCoord;
out vec4 fragColor;

${GLSLFunctions.canvasElevationFromPixel}
${GLSLFunctions.stepColor}

void main () {
  if ( any(lessThan(vElevationCoord, vec2(0.0)))
    || any(greaterThan(vElevationCoord, vec2(1.0))) ) {
    fragColor = vec4(vec3(0.0), 0.2);
    return;
  }

  vec4 evTexel = texture(uElevationMap, vElevationCoord);
  float elevation = canvasElevationFromPixel(evTexel.r, uElevationResolution);

  // For testing, simply color the fragment using a ratio of elevation.
  float elevationMin = uElevationResolution.r;

  if ( elevation == 30.0 * uElevationResolution.a ) {
    fragColor = vec4(0.0, 0.0, 1.0, 0.7);
  } else if ( elevation == 10.0 * uElevationResolution.a ) {
    fragColor = vec4(0.0, 1.0, 0.0, 0.7);
  } else if ( elevation > 0.0 ) {
    fragColor = vec4(1.0, 0.0, 0.0, 0.7);
  } else {
    fragColor = vec4(vec3(0.0), 0.2);
  }


//   if ( elevation <= elevationMin ) {
//     fragColor = vec4(0.2);
//   } else {
//     fragColor = vec4(stepColor(elevation / 100.0), 0.7);
//   }
}`;


function buildShadowMesh(shadowMap, map) {
  geometryQuad = new PIXI.Geometry();

  // Render at the shadowMap dimensions and then resize / position
  const { width, height } = shadowMap;
  geometryQuad.addAttribute("aVertexPosition", [
    0, 0, 0,          // TL
    width, 0, 0,      // TR
    width, height, 0, // BR
    0, height, 0      // BL
  ], 3);

  // Texture coordinates:
  // BL: 0,0; BR: 1,0; TL: 0,1; TR: 1,1
  geometryQuad.addAttribute("aTexCoord", [
    0, 0, // TL
    1, 0, // TR
    1, 1, // BR
    0, 1 // BL
  ], 2);
  geometryQuad.addIndex([0, 1, 2, 0, 2, 3]);

  uniforms = { shadowMap };
  let { vertexShader, fragmentShader } = renderShadowShaderGLSL;
  shader = PIXI.Shader.from(vertexShader, fragmentShader, uniforms);
  mesh = new PIXI.Mesh(geometryQuad, shader);
  return mesh;
}

function renderShadowMesh(mesh, map) {
  const MAX_WIDTH = 4096;
  const MAX_HEIGHT = 4096;
  const { sceneWidth, sceneHeight } = canvas.dimensions;
  const width = Math.min(MAX_WIDTH, map.directional ? sceneWidth : map.lightRadius * 2);
  const height = Math.min(MAX_HEIGHT, map.directional ? sceneHeight : map.lightRadius * 2);

  const renderTexture = new PIXI.RenderTexture.create({
    width,
    height,
    scaleMode: PIXI.SCALE_MODES.NEAREST
  });
  renderTexture.baseTexture.clearColor = [1, 1, 1, 1];
  renderTexture.baseTexture.alphaMode = PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA;
  canvas.app.renderer.render(mesh, { renderTexture });
  return renderTexture;
}

function renderShadowShader(mesh, map) {
  const MAX_WIDTH = 4096;
  const MAX_HEIGHT = 4096;
  const { sceneWidth, sceneHeight } = canvas.dimensions;
  const width = Math.min(MAX_WIDTH, map.directional ? sceneWidth : map.lightRadius * 2);
  const height = Math.min(MAX_HEIGHT, map.directional ? sceneHeight : map.lightRadius * 2);

  const renderTexture = new PIXI.RenderTexture.create({
    width,
    height,
    scaleMode: PIXI.SCALE_MODES.NEAREST
  });
  renderTexture.baseTexture.clearColor = [0, 0, 0, 0];
  renderTexture.baseTexture.alphaMode = PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA;
  canvas.app.renderer.render(mesh, { renderTexture });
  return renderTexture;
}



/*
// NOTE: Testing
api = game.modules.get("elevatedvision").api
Draw = CONFIG.GeometryLib.Draw;
Draw.clearDrawings()
SourceDepthShadowMap = api.SourceDepthShadowMap
Point3d = CONFIG.GeometryLib.threeD.Point3d
Matrix = CONFIG.GeometryLib.Matrix
Plane = CONFIG.GeometryLib.threeD.Plane;
extractPixels = api.extract.extractPixels
filterPixelsByChannel = function(pixels, channel = 0, numChannels = 4) {
  if ( numChannels === 1 ) return;
  if ( channel < 0 || numChannels < 0 ) {
    console.error("channels and numChannels must be greater than 0.");
  }
  if ( channel >= numChannels ) {
    console.error("channel must be less than numChannels. (First channel is 0.)");
  }

  const numPixels = pixels.length;
  const filteredPixels = new Array(Math.floor(numPixels / numChannels));
  for ( let i = channel, j = 0; i < numPixels; i += numChannels, j += 1 ) {
    filteredPixels[j] = pixels[i];
  }
  return filteredPixels;
}


pixelRange = function(pixels) {
  const out = {
    min: pixels.reduce((acc, curr) => Math.min(curr, acc), Number.POSITIVE_INFINITY),
    max: pixels.reduce((acc, curr) => Math.max(curr, acc), Number.NEGATIVE_INFINITY)
  };

  out.nextMin = pixels.reduce((acc, curr) => curr > out.min ? Math.min(curr, acc) : acc, Number.POSITIVE_INFINITY);
  out.nextMax = pixels.reduce((acc, curr) => curr < out.max ? Math.max(curr, acc) : acc, Number.NEGATIVE_INFINITY);
  return out;
}
uniquePixels = function(pixels) {
  s = new Set();
  pixels.forEach(px => s.add(px))
  return s;
}

countPixels = function(pixels, value) {
  let sum = 0;
  pixels.forEach(px => sum += px === value);
  return sum;
}


// Perspective light
let [l] = canvas.lighting.placeables;
source = l.source;
lightPosition = new Point3d(source.x, source.y, source.elevationZ);
directional = false;
lightRadius = source.radius;
lightSize = 100;

Draw.clearDrawings()
Draw.point(lightPosition, { color: Draw.COLORS.yellow });
cir = new PIXI.Circle(lightPosition.x, lightPosition.y, lightRadius)
Draw.shape(cir, { color: Draw.COLORS.yellow })

// Draw the light size
cir = new PIXI.Circle(lightPosition.x, lightPosition.y, lightSize);
Draw.shape(cir, { color: Draw.COLORS.yellow, fill: Draw.COLORS.yellow, fillAlpha: 0.5 })

Draw.shape(l.bounds, { color: Draw.COLORS.lightblue})

map = new SourceDepthShadowMap(lightPosition, { directional, lightRadius, lightSize });
map.clearPlaceablesCoordinatesData()
if ( !directional ) Draw.shape(
  new PIXI.Circle(map.lightPosition.x, map.lightPosition.y, map.lightRadiusAtMinElevation),
  { color: Draw.COLORS.lightyellow})

geometry = constructWallGeometry(map)

let { elevationMin, elevationStep, maximumPixelValue } = canvas.elevation;
let { size, distance } = canvas.dimensions;
elevationMult = size * (1 / distance);
let { sceneX, sceneY, sceneWidth, sceneHeight } = canvas.dimensions;
uniforms = {
  uLightPosition: [lightPosition.x, lightPosition.y, lightPosition.z],
  uCanvasElevation: 0,
  uLightSize: lightSize,
  uElevationResolution: [elevationMin, elevationStep, maximumPixelValue, elevationMult],
  uSceneDims: [sceneX, sceneY, sceneWidth, sceneHeight],
  uElevationMap: canvas.elevation._elevationTexture,
  uMaxR: canvas.dimensions.maxR
}

let { vertexShader, fragmentShader } = wallShadowShaderGLSL;
shader = PIXI.Shader.from(vertexShader, fragmentShader, uniforms);
mesh = new PIXI.Mesh(geometry, shader);
mesh.blendMode = PIXI.BLEND_MODES.MULTIPLY;

// canvas.stage.addChild(mesh);
// canvas.stage.removeChild(mesh);

shadowTex = renderShadowMesh(mesh, map)

s = new PIXI.Sprite(shadowTex);
canvas.stage.addChild(s);
canvas.stage.removeChild(s);

shadowMesh = buildShadowMesh(shadowTex.baseTexture, map)
renderTex = renderShadowShader(shadowMesh, map)

s = new PIXI.Sprite(renderTex);
canvas.stage.addChild(s);
canvas.stage.removeChild(s);

let { pixels } = extractPixels(canvas.app.renderer, shadowTex);
channels = [0, 1, 2, 3];
channels = channels.map(c => filterPixelsByChannel(pixels, c, 4));
channels.map(c => pixelRange(c));
channels.map(c => uniquePixels(c));

*/

/*
// NOTE: Test terrain walls
api = game.modules.get("elevatedvision").api
Draw = CONFIG.GeometryLib.Draw;
Draw.clearDrawings()
SourceDepthShadowMap = api.SourceDepthShadowMap
Point3d = CONFIG.GeometryLib.threeD.Point3d
Matrix = CONFIG.GeometryLib.Matrix
Plane = CONFIG.GeometryLib.threeD.Plane;


// Perspective light
let [l] = canvas.lighting.placeables;
source = l.source;
lightPosition = new Point3d(source.x, source.y, source.elevationZ);
directional = false;
lightRadius = source.radius;
lightSize = 100;

Draw.clearDrawings()
Draw.point(lightPosition, { color: Draw.COLORS.yellow });
cir = new PIXI.Circle(lightPosition.x, lightPosition.y, lightRadius)
Draw.shape(cir, { color: Draw.COLORS.yellow })

// Draw the light size
cir = new PIXI.Circle(lightPosition.x, lightPosition.y, lightSize);
Draw.shape(cir, { color: Draw.COLORS.yellow, fill: Draw.COLORS.yellow, fillAlpha: 0.5 })

Draw.shape(l.bounds, { color: Draw.COLORS.lightblue})

map = new SourceDepthShadowMap(lightPosition, { directional, lightRadius, lightSize });
map.clearPlaceablesCoordinatesData()
if ( !directional ) Draw.shape(
  new PIXI.Circle(map.lightPosition.x, map.lightPosition.y, map.lightRadiusAtMinElevation),
  { color: Draw.COLORS.lightyellow})
uniforms = {
  uLightPosition: [lightPosition.x, lightPosition.y, lightPosition.z],
  uCanvasElevation: 0,
  uLightSize: lightSize
}

geometry = constructWallGeometry(map)

let { vertexShader, fragmentShader } = wallShadowShaderGLSL;
shader = PIXI.Shader.from(vertexShader, fragmentShader, uniforms);
mesh = new PIXI.Mesh(geometry, shader);
//mesh.blendMode = PIXI.BLEND_MODES.ADD

canvas.stage.addChild(mesh);
canvas.stage.removeChild(mesh)

MAX_WIDTH = 4096;
MAX_HEIGHT = 4096;
let { sceneWidth, sceneHeight } = canvas.dimensions;
width = Math.min(MAX_WIDTH, map.directional ? sceneWidth : map.lightRadius * 2);
height = Math.min(MAX_HEIGHT, map.directional ? sceneHeight : map.lightRadius * 2);

width = map.directional ? sceneWidth : map.lightRadius * 2;
height = map.directional ? sceneHeight : map.lightRadius * 2;

terrainTexture = new PIXI.RenderTexture.create({
  width,
  height,
  scaleMode: PIXI.SCALE_MODES.NEAREST
});
terrainTexture.baseTexture.alphaMode = PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA;
canvas.app.renderer.render(mesh, { renderTexture: terrainTexture });

let { pixels } = extractPixels(canvas.app.renderer, terrainTexture);
rChannel = filterPixelsByChannel(pixels, 0, 4);
gChannel = filterPixelsByChannel(pixels, 1, 4);
bChannel = filterPixelsByChannel(pixels, 2, 4);
aChannel = filterPixelsByChannel(pixels, 3, 4);

pixelRange(rChannel, 0)
pixelRange(gChannel, 1)
pixelRange(bChannel, 2)
pixelRange(aChannel, 3)
uniquePixels(rChannel, 0)
uniquePixels(gChannel, 1)
uniquePixels(bChannel, 2)
uniquePixels(aChannel, 3)

s = new PIXI.Sprite(terrainTexture)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)

// Construct a quad for the scene.
geometryQuad = new PIXI.Geometry();
minElevation = map.minElevation;
if ( map.directional ) {
  let { left, right, top, bottom, center } = canvas.dimensions.sceneRect;
  // Cover the entire scene
  geometryQuad.addAttribute("aVertexPosition", [
    left, top, minElevation,      // TL
    right, top, minElevation,   // TR
    right, bottom, minElevation, // BR
    left, bottom, minElevation  // BL
  ], 3);
} else {
  // Cover the light radius
  let { lightRadius, lightPosition } = map;
  geometryQuad.addAttribute("aVertexPosition", [
    lightPosition.x - lightRadius, lightPosition.y - lightRadius, minElevation, // TL
    lightPosition.x + lightRadius, lightPosition.y - lightRadius, minElevation, // TR
    lightPosition.x + lightRadius, lightPosition.y + lightRadius, minElevation, // BR
    lightPosition.x - lightRadius, lightPosition.y + lightRadius, minElevation  // BL
  ], 3);
}

// Texture coordinates:
// BL: 0,0; BR: 1,0; TL: 0,1; TR: 1,1
geometryQuad.addAttribute("aTexCoord", [
  0, 0, // TL
  1, 0, // TR
  1, 1, // BR
  0, 1 // BL
], 2);
geometryQuad.addIndex([0, 1, 2, 0, 2, 3]);




uniforms = {
  shadowMap: terrainTexture.baseTexture
}
let { vertexShader, fragmentShader } = terrainShadowShaderGLSL;
terrainShader = PIXI.Shader.from(vertexShader, fragmentShader, uniforms);
terrainMesh = new PIXI.Mesh(geometryQuad, terrainShader);
terrainMesh.blendMode = PIXI.BLEND_MODES.ADD

// TODO: WTF is this? Also, need to fix scaling.
terrainMesh.x = canvas.dimensions.sceneX + canvas.dimensions.size * 0.5;
terrainMesh.y = canvas.dimensions.sceneY - canvas.dimensions.size * 0.5;

canvas.stage.addChild(terrainMesh)
canvas.stage.removeChild(terrainMesh)

shadowTexture = new PIXI.RenderTexture.create({
  width,
  height,
  scaleMode: PIXI.SCALE_MODES.NEAREST
});
shadowTexture.baseTexture.alphaMode = PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA;
canvas.app.renderer.render(terrainMesh, { renderTexture: shadowTexture });





*/


/*
for ( v = 0, i < )

*

/*
// Test geometry

dat = geometry.getBuffer("aVertexPosition").data;
console.log(`${dat.length} elements for ${dat.length / 3} coordinates and ${dat.length / 3 / 5} quads.`);

currentIndex = 0;
while ( currentIndex < dat.length ) {
  let currentQuad = Math.floor(currentIndex / 15);
  for ( let v = 0; v < 5; v += 1 ) {
    let i = currentIndex + (v * 3);
    let vertex = new Point3d(dat[i], dat[i + 1], dat[i + 2]);
    Draw.point(vertex);
    console.table(vertex);
  }
  currentIndex += 5 * 3;
}

index = geometry.getIndex().data
for ( let i = 0; i < index.length; i += 3 ) {
  const j0 = index[i] * 3;
  const v0 = new Point3d(dat[j0], dat[j0 + 1], dat[j0 + 2]);
  Draw.point(v0);

  const j1 = index[i + 1] * 3;
  const v1 = new Point3d(dat[j1], dat[j1 + 1], dat[j1 + 2]);
  Draw.point(v1);

  const j2 = index[i + 2] * 3;
  const v2 = new Point3d(dat[j2], dat[j2 + 1], dat[j2 + 2]);
  Draw.point(v2);

  Draw.segment({ A: v0, B: v1 });
  Draw.segment({ A: v1, B: v2 });
  Draw.segment({ A: v2, B: v0 });
}

currentIndex = 0;
while ( currentIndex < dat.length ) {

  for ( let v = 0; v < 5; v += 1 ) {
    let i = currentIndex + (v * 3);
    let vertex = new Point3d(dat[i], dat[i + 1], dat[i + 2]);
    Draw.point(vertex);
    console.table(vertex);
  }
  currentIndex += 5 * 3;
}
*/


/*

Manual calculation of penumbra radius and ratio

let [w] = canvas.walls.controlled;
canvasPlane = new Plane();
A = new Point3d(w.A.x, w.A.y, w.topZ);
B = new Point3d(w.B.x, w.B.y, w.topZ);
vVertexPosition = _token.center;
uCanvasElevation = uniforms.uCanvasElevation
uLightSize = uniforms.uLightSize
uMaxR = uniforms.uMaxR

// Shoot ray from light to vertex and intersect the plane
function intersectRayPlane(linePoint, lineDirection, planePoint, planeNormal) {
  denom = planeNormal.dot(lineDirection);
  if ( Math.abs(denom) < 0.0001 ) return false;
  t = planeNormal.dot(planePoint.subtract(linePoint))  / denom;
  return linePoint.add(lineDirection.multiplyScalar(t));
}

function lineLineIntersection2d(a, dirA, b, dirB) {
  const denom = (dirB.y * dirA.x) - (dirB.x * dirA.y);
  if ( Math.abs(denom) < 0.0001 ) return false;

  const diff = a.subtract(b);
  const t = ((dirB.x * diff.y) - (dirB.y * diff.x)) / denom;
  const ix = a.add(dirA.multiplyScalar(t));
  return ix;
}

orient2d = foundry.utils.orient2dFast;

Draw.clearDrawings()
Draw.point(lightPosition, { color: Draw.COLORS.yellow });
cir = new PIXI.Circle(lightPosition.x, lightPosition.y, lightSize);
Draw.shape(cir, { color: Draw.COLORS.yellow, fill: Draw.COLORS.yellow, fillAlpha: 0.5 })


// At vertex 0
aVertexPosition = lightPosition;

// At vertex 1
aVertexPosition = A;

// At vertex 2
aVertexPosition = B;

// All vertices
aWallCorner1 = A
aWallCorner2 = B

// Calculate values provided by the vertex shader
// Points for the light in the z direction
lightTop = lightPosition.add(new Point3d(0, 0, uLightSize))
lightCenter = lightPosition
lightBottom = lightPosition.add(new Point3d(0, 0, -uLightSize))
lightBottom.z = Math.max(lightBottom.z, uCanvasElevation)

// Wall coordinates
wallTopZ = aWallCorner1.z;
wallBottomZ = aWallCorner2.z;
wallTop1 = aWallCorner1;
wallTop2 = new Point3d(aWallCorner2.x, aWallCorner2.y, aWallCorner1.z);
wallBottom1 = new Point3d(aWallCorner1.x, aWallCorner1.y, aWallCorner2.z);
wallBottom2 = aWallCorner2;

// 1. Outer triangle ABC
maxShadowVertex = lightCenter.add(aWallCorner1.subtract(lightCenter).normalize().multiplyScalar(uMaxR));
ixFarPenumbra1 = maxShadowVertex;       // End of penumbra parallel to wall at far end.
ixFarPenumbra2 = maxShadowVertex;       // End of penumbra parallel to wall at far end.
if ( lightBottom.z > wallTopZ ) {
  ixFarPenumbra1 = intersectRayPlane(lightBottom, wallTop1.subtract(lightBottom).normalize(), canvasPlane.point, canvasPlane.normal);
  ixFarPenumbra2 = intersectRayPlane(lightBottom, wallTop2.subtract(lightBottom).normalize(), canvasPlane.point, canvasPlane.normal);
}

// Determine the lightSize circle projected at this vertex.
distWallTop1 = PIXI.Point.distanceBetween(lightCenter, wallTop1);
distShadow = PIXI.Point.distanceBetween(lightCenter, ixFarPenumbra1);
invK = (distShadow - distWallTop1) / distWallTop1;
lightSizeProjected = uLightSize * invK;

// Shift the penumbra by the projected light size.
dir = wallTop1.subtract(wallTop2).normalize();
dirSized = dir.multiplyScalar(lightSizeProjected);
outerPenumbra1 = ixFarPenumbra1.add(dirSized);
outerPenumbra2 = ixFarPenumbra2.subtract(dirSized);
innerPenumbra1 = ixFarPenumbra1.subtract(dirSized);
innerPenumbra2 = ixFarPenumbra2.add(dirSized);

Draw.point(outerPenumbra1, { color: Draw.COLORS.red })
Draw.point(innerPenumbra1, { color: Draw.COLORS.red })
Draw.point(outerPenumbra2, { color: Draw.COLORS.blue })
Draw.point(innerPenumbra2, { color: Draw.COLORS.blue })

// Penumbra1 triangle
p1A = wallTop1.to2d();
p1B = outerPenumbra1.to2d();
p1C = innerPenumbra1.to2d();

// Penumbra2 triangle
p2A = wallTop2.to2d();
p2B = innerPenumbra2.to2d();
p2C = outerPenumbra2.to2d();

Draw.shape(new PIXI.Polygon(p1A, p1B, p1C), { color: Draw.COLORS.red, fill: Draw.COLORS.red, fillAlpha: 0.1 })
Draw.shape(new PIXI.Polygon(p2A, p2B, p2C), { color: Draw.COLORS.blue, fill: Draw.COLORS.blue, fillAlpha: 0.1 })

// Varyings
vBary_0 = new Point3d(1, 0, 0)
newVertex_0 = lightCenter
vSidePenumbra1_0 = barycentric(newVertex_0, p1A, p1B, p1C);
vSidePenumbra2_0 = barycentric(newVertex_0, p2A, p2B, p2C);

vBary_1 = new Point3d(0, 1, 0)
newVertex_1 = outerPenumbra1
vSidePenumbra1_1 = barycentric(newVertex_1, p1A, p1B, p1C);
vSidePenumbra2_1 = barycentric(newVertex_1, p2A, p2B, p2C);

vBary_2 = new Point3d(0, 0, 1)
newVertex_2 = outerPenumbra2
vSidePenumbra1_2 = barycentric(newVertex_2, p1A, p1B, p1C);
vSidePenumbra2_2 = barycentric(newVertex_2, p2A, p2B, p2C);




// Calculate values provided by the vertex shader
// out float vWallRatio;
// out vec3 vBary;
// out vec3 vVertexPosition;
// flat out float wallRatio;
// flat out float sidePenumbraRatio;
// flat out float nearFarPenumbraRatio;
// flat out float isTerrain;
// flat out vec3 corner1;
// flat out vec3 corner2;

// At vertex 1
aVertexPosition = A;
aOtherCorner = B;

ix = intersectRayPlane(lightPosition, aVertexPosition.subtract(lightPosition).normalize(), canvasPlane.point, canvasPlane.normal)
Draw.point(ix, { color: Draw.COLORS.orange });
Draw.segment({ A: lightPosition, B: ix}, { color: Draw.COLORS.orange })

// Extend the vertices by the projected light size.
vertexDist = PIXI.Point.distanceBetween(lightPosition, aVertexPosition);
ixDist = PIXI.Point.distanceBetween(lightPosition, ix);
invK = (ixDist - vertexDist) / vertexDist
lightSizeProjected = lightSize * invK
dir = aVertexPosition.subtract(aOtherCorner).to2d().normalize()
dirSized = dir.multiplyScalar(lightSizeProjected)
newEndpoint = ix.to2d().add(dirSized)

lineDirection = aOtherCorner.subtract(lightPosition).normalize()
ixOther = intersectRayPlane(lightPosition, lineDirection, canvasPlane.point, canvasPlane.normal);

Draw.point(newEndpoint, { color: Draw.COLORS.orange });
Draw.segment({ A: lightPosition, B: newEndpoint}, { color: Draw.COLORS.orange })

// Flat variables (set by vertex 2)
corner1 = aOtherCorner;
corner2 = aVertexPosition;
outerPenumbra2 = newEndpoint
outerPenumbra1 = ixOther.to2d().subtract(dirSized);
innerPenumbra2 = ix.to2d().subtract(dirSized);
innerPenumbra1 = ixOther.to2d().add(dirSized);

// At vertex 2
aVertexPosition = B;
aOtherCorner = A;

Draw.point(outerPenumbra1, { color: Draw.COLORS.yellow })
Draw.point(innerPenumbra1, { color: Draw.COLORS.gray })
Draw.point(outerPenumbra2, { color: Draw.COLORS.yellow })
Draw.point(innerPenumbra2, { color: Draw.COLORS.gray })

// At fragment represented by token center
vVertexPosition2d = new PIXI.Point(vVertexPosition.x, vVertexPosition.y)
Draw.point(vVertexPosition2d, { color: Draw.COLORS.orange })


// If the fragment is not between the two outer penumbra, it is in full light.
oOuterPenumbra1 = orient2d(corner1, outerPenumbra1, vVertexPosition2d);
oOuterPenumbra2 = orient2d(corner2, outerPenumbra2, vVertexPosition2d);
if ( Math.sign(oOuterPenumbra1) != Math.sign(-oOuterPenumbra2) ) {
  console.log("In full light!")
}

// If the fragment is between the two inner penumbra, it is in full shadow unless near trapezoid end.
oInnerPenumbra1 = orient2d(corner1, innerPenumbra1, vVertexPosition2d);
oInnerPenumbra2 = orient2d(corner2, innerPenumbra2, vVertexPosition2d);
withinUmbra = Math.sign(oInnerPenumbra1) == Math.sign(-oInnerPenumbra2);
withinFar = false
if ( withinUmbra && !withinFar ) {
  console.log("In full shadow!")
}

withinPenumbra1 = Math.sign(oInnerPenumbra1) == Math.sign(-oOuterPenumbra1);
withinPenumbra2 = Math.sign(oInnerPenumbra2) == Math.sign(-oOuterPenumbra2);
console.log(`Fragment is ${withinPenumbra1 ? "" : "not"} within penumbra 1.`)
console.log(`Fragment is ${withinPenumbra2 ? "" : "not"} within penumbra 2.`)


// Barycentric exploration
triA = lightPosition.to2d()
triB = outerPenumbra1
triC = outerPenumbra2

barycentric(triA, triA, triB, triC); // 1, 0, 0
barycentric(triB, triA, triB, triC); // 0, 1, 0
barycentric(triC, triA, triB, triC); // 0, 0, 1

// At wall coordinates
// Note x is same as expected. y and z are interesting.
barycentric(A.to2d(), triA, triB, triC); {x: 0.6249999999999993, y: 0.3120784040674867, z: 0.06292159593251404}
barycentric(B.to2d(), triA, triB, triC); {x: 0.6249999999999998, y: 0.06292159593251287, z: 0.31207840406748727}

ixEdge = foundry.utils.lineLineIntersection(triA, triB, A, B);
ixEdge = new PIXI.Point(ixEdge.x, ixEdge.y)
barycentric(ixEdge, triA, triB, triC); // {x: 0.6249999999999996, y: 0.37500000000000044, z: 0}

// Halfway between endpoint A and triB (outerPenumbra)
dist = PIXI.Point.distanceBetween(A, triB);
pt = triB.towardsPoint(A, 0.5 * dist)
barycentric(pt, triA, triB, triC);

dist = PIXI.Point.distanceBetween(triA, triB);
pt = triB.towardsPoint(triA, 0.25 * dist)
barycentric(pt, triA, triB, triC);

// 
0: {x: 0, y: 1, z: 0}
.25: {x: 0.15624999999999958, y: 0.8280196010168713, z: 0.015730398983129095}
0.5: {x: 0.3124999999999991, y: 0.6560392020337416, z: 0.031460797966259356}
0.75: {x: 0.4687499999999991, y: 0.4840588030506147, z: 0.047191196949386116}
1: {x: 0.6249999999999993, y: 0.3120784040674867, z: 0.06292159593251404}

a + bx = y

a + bx = y
a = 1
1 + b*.6249999999999993 = 0.3120784040674867
b = (0.3120784040674867 - 1) / .6249999999999993

function edgeTest(x, endpointBary) {
  const a = 1;
  const b = (endpointBary.y - 1) / endpointBary.x;
  return a + b * x;
}
endpointBary = barycentric(A.to2d(), triA, triB, triC)

edgeTest(0, endpointBary)
edgeTest(0.3124999999999991, endpointBary)
edgeTest(.5, endpointBary)
edgeTest(.6249999999999993, endpointBary)
edgeTest(.7, endpointBary)
edgeTest(-1, endpointBary)

// Project from the big triangle to the penumbra triangle.
corner1 = aOtherCorner;
corner2 = aVertexPosition;
outerPenumbra2 = newEndpoint
outerPenumbra1 = ixOther.to2d().subtract(dirSized);
innerPenumbra2 = ix.to2d().subtract(dirSized);
innerPenumbra1 = ixOther.to2d().add(dirSized);

triA = lightPosition.to2d()
triB = outerPenumbra1
triC = outerPenumbra2

barycentric(triA, corner1, innerPenumbra1, outerPenumbra1)
barycentric(triB, corner1, innerPenumbra1, outerPenumbra1)
barycentric(triC, corner1, innerPenumbra1, outerPenumbra1)


// Intersection with light --> wall endpoint
dir1 = corner1.subtract(corner2).to2d().normalize();
dir2 = dir1.multiplyScalar(-1)
dirL1 = corner1.subtract(lightPosition).to2d().normalize();
dirL2 = corner2.subtract(lightPosition).to2d().normalize();

ixL1 = foundry.utils.lineLineIntersection(vVertexPosition2d, vVertexPosition2d.add(dir1), lightPosition, lightPosition.add(dirL1))
ixL2 = foundry.utils.lineLineIntersection(vVertexPosition2d, vVertexPosition2d.add(dir2), lightPosition, lightPosition.add(dirL2))

ixL1 = lineLineIntersection2d(vVertexPosition2d, dir1, lightPosition, dirL1)
ixL2 = lineLineIntersection2d(vVertexPosition2d, dir2, lightPosition, dirL2)

Draw.point(ixL1, { color: Draw.COLORS.red })
Draw.point(ixL2, { color: Draw.COLORS.blue })

// Calculate the projected light size at ONE intersection.
ixL1dist = PIXI.Point.distanceBetween(lightPosition, ixL1)
ixC1dist = PIXI.Point.distanceBetween(corner1, ixL1)
invK = (ixL1dist - ixC1dist) / ixC1dist;
lightSizeProjected = lightSize * invK;

// Now continue to move in the direction of the wall from the intersection
// for a distance of lightSizeProjected. This is the outer penumbra point of transition to
// fully lit. Moving the opposite direction will get the inner penumbra point of transition
// to full shadow.
ixOuterPenumbra1 = ixL1.add(dir1.multiplyScalar(lightSizeProjected))
ixInnerPenumbra1 = ixL1.subtract(dir1.multiplyScalar(lightSizeProjected))
ixOuterPenumbra2 = ixL2.add(dir2.multiplyScalar(lightSizeProjected))
ixInnerPenumbra2 = ixL2.subtract(dir2.multiplyScalar(lightSizeProjected))

// Outer should equal the intersection of the line from endpoint to outer shadow corner
Draw.point(ixOuterPenumbra1, { color: Draw.COLORS.red })
Draw.point(ixOuterPenumbra2, { color: Draw.COLORS.blue })
Draw.point(ixInnerPenumbra1, { color: Draw.COLORS.red })
Draw.point(ixInnerPenumbra2, { color: Draw.COLORS.blue })







// Assume currently at vertex A
vertex = A
otherVertex = B




// We want point B for now
Draw.point(A)
Draw.point(B)

// Can ignore Z for walls here.
abDist = PIXI.Point.distanceBetween(A, B)

// Assume currently at vertex B
vertex = B
otherVertex = A

// Shoot ray from light to vertex and intersect the plane
function intersectRayPlane(linePoint, lineDirection, planePoint, planeNormal) {
  denom = planeNormal.dot(lineDirection);
  if ( Math.abs(denom) < 0.0001 ) return false;
  t = planeNormal.dot(planePoint.subtract(linePoint))  / denom;
  return linePoint.add(lineDirection.multiplyScalar(t));
}

ix = intersectRayPlane(lightPosition, vertex.subtract(lightPosition).normalize(),
  canvasPlane.point, canvasPlane.normal)
Draw.point(ix);
vertexDist = PIXI.Point.distanceBetween(lightPosition, vertex);
ixDist = PIXI.Point.distanceBetween(lightPosition, ix);

vertexDist3 = Point3d.distanceBetween(lightPosition, vertex);
ixDist3 = Point3d.distanceBetween(lightPosition, ix);

invSideRatio = ixDist / vertexDist;
bigABDist = abDist * invSideRatio

invSideRatio3 = ixDist3 / vertexDist3;
bigABDist3 = abDist * invSideRatio3


ix2 = intersectRayPlane(lightPosition, otherVertex.subtract(lightPosition).normalize(),
  canvasPlane.point, canvasPlane.normal)
Draw.point(ix2)
PIXI.Point.distanceBetween(ix, ix2); // Should equal bigABDist

// Ratio of the two triangles is k
k = vertexDist / (ixDist - vertexDist)

// Size of the penumbra radius is proportional to the triangles, indicated by k
lightSizeProjected = lightSize / k;


// Flip around so we can multiply instead of divide
invK = (ixDist - vertexDist) / vertexDist
lightSizeProjected = lightSize * invK;

invK3 = ixDist3 / vertexDist3
lightSizeProjected3 = lightSize * invK3;

// Project the point on the end of the shadow trapezoid
dir = B.subtract(A).normalize()
penumbraIx = ix.add(dir.multiplyScalar(lightSizeProjected))
Draw.point(penumbraIx, { color: Draw.COLORS.blue })

penumbraRatio = (ixDist - vertexDist) / vertexDist
penumbraRatio = vertexDist / (ixDist - vertexDist)
lightSizeProjected = lightSize * penumbraRatio
vSidePenumbraRatio = lightSizeProjected / bigABDist;


// Orientation test to determine if a point is on the penumbra side of a shadow.
A2 = A.to2d()
B2 = B.to2d()
dirAB = A2.subtract(B2).normalize()
penumbraLightPoint1 = lightPosition.to2d().add(dirAB.multiplyScalar(lightSize))

// Penumbra line is penumbraLightPoint1 --> A2
c = _token.center
foundry.utils.orient2dFast(penumbraLightPoint1, A2, lightPosition);
foundry.utils.orient2dFast(penumbraLightPoint1, A2, c)



// Assume a wall ratio of 0.5 and a penumbra ratio between 0 and .2
penumbraRatio = [0, 0.05, 0.1, 0.15, 0.2]
wallRatio = 0.5
vWallRatio = [0.5, 0.6, 0.7, 0.8, 0.9, 1]
behindWallPercent = vWallRatio.map(x => linearConversion(x, wallRatio, 1, 0, 1))

penumbraRatio.map(p => p * behindWallPercent[0])
behindWallPercent.map(x => x * penumbraRatio[1])

// Test calc:
// Shoot a ray from the ix in the direction of BA for provided distance
dir = A.subtract(B).normalize()
bigA = ix.add(dir.multiplyScalar(bigABDist))
Draw.point(bigA, { color: Draw.COLORS.green })

// Now do the same but for the projected light radius.
projLightSize = lightSize * (vertexDist / (ixDist - vertexDist))
lightS = ix.add(dir.multiplyScalar(projLightSize))
Draw.point(lightS, { color: Draw.COLORS.yellow })

*/


/* Tile Testing
MODULE_ID = "elevatedvision";
api = game.modules.get(MODULE_ID).api
Draw = CONFIG.GeometryLib.Draw;
Draw.clearDrawings()
SourceDepthShadowMap = api.SourceDepthShadowMap
Point3d = CONFIG.GeometryLib.threeD.Point3d
Matrix = CONFIG.GeometryLib.Matrix
Plane = CONFIG.GeometryLib.threeD.Plane;



// Perspective light
let [l] = canvas.lighting.placeables;
source = l.source;
lightPosition = new Point3d(source.x, source.y, source.elevationZ);
directional = false;
lightRadius = source.radius;
lightSize = 100;

Draw.clearDrawings()
Draw.point(lightPosition, { color: Draw.COLORS.yellow });
cir = new PIXI.Circle(lightPosition.x, lightPosition.y, lightRadius)
Draw.shape(cir, { color: Draw.COLORS.yellow })

// Draw the light size
cir = new PIXI.Circle(lightPosition.x, lightPosition.y, lightSize);
Draw.shape(cir, { color: Draw.COLORS.yellow, fill: Draw.COLORS.yellow, fillAlpha: 0.5 })

Draw.shape(l.bounds, { color: Draw.COLORS.lightblue})



map = new SourceDepthShadowMap(lightPosition, { directional, lightRadius, lightSize });
map.clearPlaceablesCoordinatesData()
if ( !directional ) Draw.shape(
  new PIXI.Circle(map.lightPosition.x, map.lightPosition.y, map.lightRadiusAtMinElevation),
  { color: Draw.COLORS.lightyellow})


tileNum = 0;
geometry = constructTileGeometry(map, tileNum);
uniforms = {
  uLightPosition: [lightPosition.x, lightPosition.y, lightPosition.z],
  uCanvasElevation: 0,
  uLightSize: lightSize,
  uTileTexture: map.placeablesCoordinatesData.tileCoordinates[tileNum].object.texture.baseTexture,
  uOffsetPercentage: 0.0,
  uShadowPercentage: 1.0
}

let { vertexShader, fragmentShader } = shadowTransparentTileShaderGLSL;
shader = PIXI.Shader.from(vertexShader, fragmentShader, uniforms);
mesh = new PIXI.Mesh(geometry, shader);

canvas.stage.addChild(mesh);
canvas.stage.removeChild(mesh)

// Render tile multiple times with offset to approximate a penumbra.
MAX_WIDTH = 4096;
MAX_HEIGHT = 4096;
let { sceneWidth, sceneHeight } = canvas.dimensions;
width = Math.min(MAX_WIDTH, map.directional ? sceneWidth : map.lightRadius * 2);
height = Math.min(MAX_HEIGHT, map.directional ? sceneHeight : map.lightRadius * 2);
c = new PIXI.Container;
canvas.stage.addChild(c)

// TODO: Maybe use #define to trigger offsetting?
let { vertexShader, fragmentShader } = shadowTransparentTileShaderGLSL;

uniforms = {
  uLightPosition: [lightPosition.x, lightPosition.y, lightPosition.z],
  uCanvasElevation: 0,
  uLightSize: lightSize,
  uTileTexture: map.placeablesCoordinatesData.tileCoordinates[tileNum].object.texture.baseTexture,
  uOffsetPercentage: 0,
  uShadowPercentage: 1.0
}

// TODO: Efficiently destroy once combined
// r0Texture = new PIXI.RenderTexture.create({
//   width,
//   height,
//   scaleMode: PIXI.SCALE_MODES.LINEAR // LINEAR is only supported if OES_texture_float_linear is present (renderer.context.extensions.floatTextureLinear)
// });


r0Uniforms = {
  uLightPosition: [lightPosition.x, lightPosition.y, lightPosition.z],
  uCanvasElevation: 0,
  uLightSize: lightSize,
  uTileTexture: map.placeablesCoordinatesData.tileCoordinates[tileNum].object.texture.baseTexture,
  uOffsetPercentage: 0,
  uShadowPercentage: 1.0
}
r0Shader = PIXI.Shader.from(vertexShader, fragmentShader, r0Uniforms);
r0Mesh = new PIXI.Mesh(geometry, r0Shader);
// canvas.app.renderer.render(r0Mesh, { renderTexture: r0Texture });
c.addChild(r0Mesh);

r75Uniforms = {
  uLightPosition: [lightPosition.x, lightPosition.y, lightPosition.z],
  uCanvasElevation: 0,
  uLightSize: lightSize,
  uTileTexture: map.placeablesCoordinatesData.tileCoordinates[tileNum].object.texture.baseTexture,
  uOffsetPercentage: 0.75,
  uShadowPercentage: 0.25
}
// r5Texture = new PIXI.RenderTexture.create({
//   width,
//   height,
//   scaleMode: PIXI.SCALE_MODES.LINEAR // LINEAR is only supported if OES_texture_float_linear is present (renderer.context.extensions.floatTextureLinear)
// });

r75Shader = PIXI.Shader.from(vertexShader, fragmentShader, r75Uniforms);
r75Mesh = new PIXI.Mesh(geometry, r75Shader);
// canvas.app.renderer.render(r5Mesh, { renderTexture: r75Texture });
c.addChild(r75Mesh);



r5Uniforms = {
  uLightPosition: [lightPosition.x, lightPosition.y, lightPosition.z],
  uCanvasElevation: 0,
  uLightSize: lightSize,
  uTileTexture: map.placeablesCoordinatesData.tileCoordinates[tileNum].object.texture.baseTexture,
  uOffsetPercentage: 0.5,
  uShadowPercentage: 0.5
}
// r5Texture = new PIXI.RenderTexture.create({
//   width,
//   height,
//   scaleMode: PIXI.SCALE_MODES.LINEAR // LINEAR is only supported if OES_texture_float_linear is present (renderer.context.extensions.floatTextureLinear)
// });

r5Shader = PIXI.Shader.from(vertexShader, fragmentShader, r5Uniforms);
r5Mesh = new PIXI.Mesh(geometry, r5Shader);
// canvas.app.renderer.render(r5Mesh, { renderTexture: r5Texture });
c.addChild(r5Mesh);

r25Uniforms = {
  uLightPosition: [lightPosition.x, lightPosition.y, lightPosition.z],
  uCanvasElevation: 0,
  uLightSize: lightSize,
  uTileTexture: map.placeablesCoordinatesData.tileCoordinates[tileNum].object.texture.baseTexture,
  uOffsetPercentage: 0.25,
  uShadowPercentage: 0.75
}
// r5Texture = new PIXI.RenderTexture.create({
//   width,
//   height,
//   scaleMode: PIXI.SCALE_MODES.LINEAR // LINEAR is only supported if OES_texture_float_linear is present (renderer.context.extensions.floatTextureLinear)
// });

r25Shader = PIXI.Shader.from(vertexShader, fragmentShader, r25Uniforms);
r25Mesh = new PIXI.Mesh(geometry, r25Shader);
// canvas.app.renderer.render(r5Mesh, { renderTexture: r25Texture });
c.addChild(r25Mesh);



// s = new PIXI.Sprite(r5Texture)
// canvas.stage.addChild(s);
// canvas.stage.removeChild(s)

canvas.stage.removeChild(c);

// Render container to a texture, then apply a blur
combinedTexture = new PIXI.RenderTexture.create({
  width,
  height,
  scaleMode: PIXI.SCALE_MODES.LINEAR // LINEAR is only supported if OES_texture_float_linear is present (renderer.context.extensions.floatTextureLinear)
});
canvas.app.renderer.render(c, { renderTexture: combinedTexture });

s = new PIXI.Sprite(combinedTexture);
canvas.stage.addChild(s)

blurFilter = new PIXI.filters.BlurFilter();
s.filters = [blurFilter]
blurFilter.blur = 20

canvas.stage.removeChild(s)


blurredTexture = new PIXI.RenderTexture.create({
  width,
  height,
  scaleMode: PIXI.SCALE_MODES.LINEAR // LINEAR is only supported if OES_texture_float_linear is present (renderer.context.extensions.floatTextureLinear)
});

canvas.app.renderer.render(s, { renderTexture: blurredTexture });

sBlurred = new PIXI.Sprite(blurredTexture);
canvas.stage.addChild(sBlurred)
canvas.stage.removeChild(sBlurred)

*/


/* Test rendering elevation texture

performance.mark("renderEV1_start");
for ( let i = 0; i < 10000; i += 1 ) {

let canvasRect = canvas.dimensions.rect;
let sceneRect = canvas.dimensions.sceneRect;
elevationMap = canvas.elevation._elevationTexture;
lightFrame = new PIXI.Rectangle();
lightFrame.copyFrom(map.directional ? sceneRect : l.bounds);

geometryQuad = new PIXI.Geometry();

// Build a quad that equals the light bounds.
geometryQuad.addAttribute("aVertexPosition", [
  lightFrame.left, lightFrame.top, 0,
  lightFrame.right, lightFrame.top, 0,
  lightFrame.right, lightFrame.bottom, 0,
  lightFrame.left, lightFrame.bottom, 0
], 3);

geometryQuad.addIndex([0, 1, 2, 0, 2, 3]);


uniforms = { uElevationMap: elevationMap };
let { elevationMin, elevationStep, maximumPixelValue } = canvas.elevation;
let { size, distance } = canvas.dimensions;
elevationMult = size * (1 / distance);
uniforms.uElevationResolution = [elevationMin, elevationStep, maximumPixelValue, elevationMult];
//uniforms.uSceneDims = [sceneRect.left, sceneRect.top, sceneRect.width, sceneRect.height];
let { sceneX, sceneY, sceneWidth, sceneHeight } = canvas.dimensions;
uniforms.uSceneDims = [sceneX, sceneY, sceneWidth, sceneHeight];


let { vertexShader, fragmentShader } = renderElevationTestGLSL;
shader = PIXI.Shader.from(vertexShader, fragmentShader, uniforms);
mesh = new PIXI.Mesh(geometryQuad, shader);

canvas.stage.addChild(mesh)
canvas.stage.removeChild(mesh)

}
performance.mark("renderEV1_end");
performance.measure("renderEV1", "renderEV1_start", "renderEV1_end");

let { pixels, width, height } = extractPixels(canvas.app.renderer, elevationMap);
channels = [0];
channels = channels.map(c => filterPixelsByChannel(pixels, c, 1));
channels.map(c => pixelRange(c));
channels.map(c => uniquePixels(c));
channels.map(c => countPixels(c, 1));


*/


/* Test rendering the elevation texture over the light area only
// The quad we are rendering is the light bounds.
// Overlay the terrain elevation texture bounds. Upload only the portion of the
// terrain elevation texture that overlaps.

// This second appears longer.
performance.mark("renderEV2_start");
for ( let i = 0; i < 10000; i += 1 ) {
let canvasRect = canvas.dimensions.rect;
let sceneRect = canvas.dimensions.sceneRect;
elevationMap = canvas.elevation._elevationTexture;

lightFrame = new PIXI.Rectangle();
lightFrame.copyFrom(map.directional ? sceneRect : l.bounds);

// MAX_WIDTH = 4096;
// MAX_HEIGHT = 4096;
// width = Math.min(lightFrame.width, MAX_WIDTH);
// height = Math.min(lightFrame.height, MAX_HEIGHT);

// Elevation map starts at 0,0: shift to scene rect
elevationFrame = new PIXI.Rectangle();
elevationFrame.copyFrom(elevationMap.frame);
elevationFrame.x = sceneRect.x;
elevationFrame.y = sceneRect.y;

ixFrame = elevationFrame.intersection(lightFrame)
ixFrame.x = 0;
ixFrame.y = 0;

elevationMap = new PIXI.Texture(elevationMap.baseTexture, ixFrame)

geometryQuad = new PIXI.Geometry();

// Build a quad that equals the light bounds.
geometryQuad.addAttribute("aVertexPosition", [
  lightFrame.left, lightFrame.top, 0,
  lightFrame.right, lightFrame.top, 0,
  lightFrame.right, lightFrame.bottom, 0,
  lightFrame.left, lightFrame.bottom, 0
], 3);


// Texture 0 --> 1 maps to the sceneRect.
// So for a given direction, what percentage of lightFrame do you have to move to get to 0 (or 1). E.g.:
// What percentage of lightFrame.width do you have to move to get to sceneRect.x?
// distance between sceneRect.x and lightFrame.x = sceneRect.x - lightFrame.x.
// Percentage requires dividing by lightFrame.width.

// imagine lightFrame contains sceneRect.x = 0 at midpoint, and sceneRect.x = .75 at the far end
// so -0.75 at the one end would mean it works linearly.

texRight = (lightFrame.right - sceneRect.left) / sceneRect.width;
texLeft = (lightFrame.left - sceneRect.left) / sceneRect.width;

texBottom = (lightFrame.bottom - sceneRect.top) / sceneRect.height;
texTop = (lightFrame.top - sceneRect.top) / sceneRect.height;


geometryQuad.addAttribute("aElevationCoord", [
  texLeft, texTop,
  texRight, texTop,
  texRight, texBottom,
  texLeft, texBottom
], 2);

geometryQuad.addIndex([0, 1, 2, 0, 2, 3]);

uniforms = { uElevationMap: elevationMap  };
let { elevationMin, elevationStep, maximumPixelValue } = canvas.elevation;
let { size, distance } = canvas.dimensions;
elevationMult = size * (1 / distance);
uniforms.uElevationResolution = [elevationMin, elevationStep, maximumPixelValue, elevationMult];

let { vertexShader, fragmentShader } = renderElevationTest2GLSL;
shader = PIXI.Shader.from(vertexShader, fragmentShader, uniforms);
mesh = new PIXI.Mesh(geometryQuad, shader);

canvas.stage.addChild(mesh)
canvas.stage.removeChild(mesh)
}
performance.mark("renderEV2_end");
performance.measure("renderEV2", "renderEV2_start", "renderEV2_end");


// Texture coordinates:
// BL: 0,0; BR: 1,0; TL: 0,1; TR: 1,1
// Texture needs to equate the bounds with the elevation texture.

ixFrame = lightFrame.intersection(textureFrame);
texLeft = (ixFrame.left - lightFrame.left) / lightFrame.width;
texRight = 1 - ((lightFrame.right - lightFrame.right) / lightFrame.width);
texTop = (ixFrame.top - lightFrame.top) / lightFrame.height;
texBottom = 1 - ((lightFrame.bottom - lightFrame.bottom) / lightFrame.height);

geometryQuad.addAttribute("aElevationCoord", [
  texLeft, texBottom,
  texRight, texBottom,
  texRight, texTop,
  texLeft, texTop

//   0, 0, // TL
//   1, 0, // TR
//   1, 1, // BR
//   0, 1 // BL
], 2);
geometryQuad.addIndex([0, 1, 2, 0, 2, 3]);


uniforms = { elevationMap };
let { elevationMin, elevationStep, maximumPixelValue } = canvas.elevation;
let { size, distance } = canvas.dimensions;
elevationMult = size * (1 / distance);
uniforms.uElevationResolution = [elevationMin, elevationStep, maximumPixelValue, elevationMult];

let { vertexShader, fragmentShader } = renderElevationTestGLSL;
shader = PIXI.Shader.from(vertexShader, fragmentShader, uniforms);
mesh = new PIXI.Mesh(geometryQuad, shader);

canvas.stage.addChild(mesh)
canvas.stage.removeChild(mesh)

const renderTexture = new PIXI.RenderTexture.create({
  width,
  height,
  scaleMode: PIXI.SCALE_MODES.NEAREST
});
renderTexture.baseTexture.clearColor = [1, 1, 1, 1];
renderTexture.baseTexture.alphaMode = PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA;
canvas.app.renderer.render(mesh, { renderTexture });




*/
