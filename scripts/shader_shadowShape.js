/* globals
foundry,
PIXI,
Wall
*/
"use strict";

import { MODULE_ID } from "./const.js";


/* NOTE: Color channel choices
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

/* NOTE: Terrain and elevation
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

/* NOTE: Shadow map output
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
  const aTexCoord = [];
  const aOtherCorner = [];
  const aBary = [];
  const aTerrain = [];

  // First vertex is the light source.
  aVertexPosition.push(lightPosition.x, lightPosition.y, lightPosition.z);
  aTexCoord.push(0, 0);
  aOtherCorner.push(0, 0, 0);
  aBary.push(1, 0, 0);
  aTerrain.push(0);

  let triNumber = 0;
  for ( let i = 0; i < nObjs; i += 1 ) {
    const obj = coords[i];
    const isWall = obj.object instanceof Wall;
    if ( !isWall ) continue;
    if ( !renderableWall(map, obj, lightBounds) ) continue;

    // A --> B --> light CCW
    // Only draw the triangles that are above minimum elevation and thus cast shadow.
    const topZ = Math.min(obj.topZ, map.lightPosition.z - 1);
    const bottomZ = Math.max(obj.bottomZ, map.minElevation);
    const orientWall = foundry.utils.orient2dFast(obj.A, obj.B, this.lightPosition);
    const [A, B] = orientWall > 0 ? [obj.A, obj.B] : [obj.B, obj.A];

    aVertexPosition.push(A.x, A.y, topZ, B.x, B.y, topZ);
    aTexCoord.push(1, 0, 1, 1);
    aOtherCorner.push(B.x, B.y, bottomZ, A.x, A.y, bottomZ);
    aBary.push(0, 1, 0, 0, 0, 1);
    aTerrain.push(obj.isTerrain, obj.isTerrain);

    // Two vertices per wall edge, plus light center (0).
    const v = triNumber * 2;
    indices.push(0, v + 1, v + 2);
    triNumber += 1;
  }

  // TODO: set interleave to true?
  const geometry = new PIXI.Geometry();
  geometry.addIndex(indices);
  geometry.addAttribute("aVertexPosition", aVertexPosition, 3, false);
  geometry.addAttribute("aTexCoord", aTexCoord, 2, false);
  geometry.addAttribute("aOtherCorner", aOtherCorner, 3, false);
  geometry.addAttribute("aBary", aBary, 3, false);
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
  vec3 planeNormal = diff01.cross(diff02);
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

in vec3 aVertexPosition;
in vec3 aOtherCorner;
in vec3 aBary;
in float aTerrain;

out float vWallRatio;
out vec3 vBary;
flat out float wallRatio;
flat out float sidePenumbraRatio;
flat out float nearFarPenumbraRatio;
flat out float isTerrain;
flat out vec3 corner1;
flat out vec3 corner2;

${GLSLFunctions.intersectRayPlane}

void main() {
  vWallRatio = 1.0;
  vBary = aBary;

  if ( gl_VertexID == 0 ) {
    vWallRatio = 0.0;
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition.xy, 1.0)).xy, 0.0, 1.0);
    return;
  }

  isTerrain = aTerrain;
  corner1 = aOtherCorner;
  corner2 = aVertexPosition;

  // Intersect the canvas plane: Light --> vertex --> plane.
  vec3 planeNormal = vec3(0.0, 0.0, 1.0);
  vec3 planePoint = vec3(0.0);
  vec3 lineDirection = normalize(aVertexPosition - uLightPosition);
  vec3 ix;
  bool ixFound = intersectRayPlane(uLightPosition, lineDirection, planePoint, planeNormal, ix);
  if ( !ixFound ) {
    // Shouldn't happen, but...
    wallRatio = 1.0;
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition.xy, 1.0)).xy, 0.0, 1.0);
    return;
  }

  // Use the projected 2d distance on the canvas.
  float vertexDist = distance(uLightPosition.xy, aVertexPosition.xy);
  float ixDist = distance(uLightPosition.xy, ix.xy);

  // Pass the fragment shader the wall location as a ratio so it knows where to shadow.
  wallRatio = vertexDist / ixDist;

  // If the bottom of the wall is above the canvas, correct the distance of the near shadow accordingly.
  if ( aOtherCorner.z > uCanvasElevation ) {
    vec3 nearEndpoint = vec3(aVertexPosition.xy, aOtherCorner.z);
    lineDirection = normalize(nearEndpoint - uLightPosition);
    vec3 ixNear;
    if ( intersectRayPlane(uLightPosition, lineDirection, planePoint, planeNormal, ixNear) ) {
      // Should always happen, but...
      float nearEndpointDist = distance(uLightPosition.xy, ixNear.xy);
      wallRatio = nearEndpointDist / ixDist;
    }
  }

  // Use similar triangles to calculate the length of the shadow at the end of the trapezoid.
  float abDist = distance(aOtherCorner.xy, aVertexPosition.xy);
  float ABDist = abDist * (ixDist / vertexDist);


  // Determine the lightSize circle projected at this vertex.
  // Pass the ratio of lightSize projected / length of shadow to fragment to draw the inner penumbra.
  float penumbraProjectionRatio = vertexDist / (ixDist - vertexDist);
  float lightSizeProjected = uLightSize * penumbraProjectionRatio;
  sidePenumbraRatio = lightSizeProjected / ABDist;

  // Determine the ratio for near/far using distance to the light.
  nearFarPenumbraRatio = lightSizeProjected / ixDist;

  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(ix.xy, 1.0)).xy, 0.0, 1.0);
}`;

wallShadowShaderGLSL.fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

uniform float uCanvasElevation;
uniform sampler2D uElevationMap;
uniform vec4 uElevationResolution;

in float vWallRatio;
in vec3 vBary;
flat in float wallRatio;
flat in float sidePenumbraRatio;
flat in float nearFarPenumbraRatio;
flat in float isTerrain;
flat in vec3 corner1;
flat in vec3 corner2;

out vec4 fragColor;

${GLSLFunctions.intersectRayQuad}
${GLSLFunctions.canvasElevationFromPixel}

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

${GLSLFunctions.stepColor}

void main() {
  // vBary.x is the distance from the light, where 1 = at light; 0 = at edge.
  // vBary.y is distance from A endpoint (transposed), where 1 = at A.
  // vBary.z is distance from B endpoint (transposed), where 1 = at B.

  // Can get distance from A edge by vBary.z / (vBary.y + vBary.z) ==> 0 at A edge, 1 at B edge
  //fragColor = vec4(stepColor(vBary.z / (vBary.y + vBary.z)), 0.5);
  //return;

  // Options:
  // - in front of wall---dismiss early
  // - elevation anywhere: shoot ray at light center
  // - within the l/r border: shoot ray at outer or inner light radius and check for wall intersection.
  // - within the t/b border: same
  // - otherwise can assume full shadow.
  // If within border, transparency based on ratio.

  if ( vWallRatio < wallRatio ) {
    // Fragment is in front of the wall.
    fragColor = vec4(vec3(1.0), 0.0);
    return;
  }





  // Convert from a constant penumbra ratio that goes to the light to one that
  // goes to zero at the wall endpoint.
  // Have not yet found the mathematical solution, but taking the square root of the
  // linear transform is pretty close.
  float lrRatio = vBary.z / (vBary.y + vBary.z);
  float linearTx = (vWallRatio - wallRatio) / ( 1.0 - wallRatio);
  // float smoothTx = smoothstep(wallRatio, 1.0, vWallRatio); // Bad choice.
  float squaredTx = sqrt(linearTx);

  // Using flat sidePenumbraRatio is slightly better -- flatter, less curvy.
  float targetRatio = sidePenumbraRatio * squaredTx;


  // For corners, need to blend the left/right and the far/near light amounts.
  // Multiplication is not correct here.
  float nfShadowPercent = 1.0;
  float lrShadowPercent = 1.0;
  if ( vBary.x < nearFarPenumbraRatio ) {
    nfShadowPercent = vBary.x / nearFarPenumbraRatio;
  }
  if ( lrRatio < targetRatio ) {
    lrShadowPercent = lrRatio / targetRatio;
  } else if ( (1.0 - lrRatio) < targetRatio ) {
    lrShadowPercent = (1.0 - lrRatio) / targetRatio;
  }

  // float penumbraShadowPercent = mix(nfShadowPercent, lrShadowPercent, 0.5);
  float penumbraShadowPercent = min(nfShadowPercent, lrShadowPercent);

  // If not on penumbra, this must be a full shadow.
  float light = (1.0 - penumbraShadowPercent);

  // isTerrain should be 0.0 or 1.0.
  float nonTerrainLight = light;
  float wallType = 1.0;
  float terrainLight = 1.0;

  if ( isTerrain > 0.5 ) {
    nonTerrainLight = 1.0;
    wallType = 0.5;
    terrainLight = light;
  }

  fragColor = vec4(nonTerrainLight, wallType, terrainLight, 1.0);
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
  vec4 ev = texture(uElevationMap, evTexCoord);

  if ( ev.r == 1.0 / 255.0 ) {
    fragColor = vec4(0.0, 1.0, 0.0, 1.0);
  } else {
    fragColor = vec4(0.0, 0.0, 0.0, 0.3);
  }
  return;

//   if ( evTexel.r > 0.0 ) {
//     fragColor = vec4(1.0, 0.0, 0.0, 1.0);
//   } else if ( evTexel.g > 0.0 ) {
//     fragColor = vec4(1.0, 0.0, 0.0, 1.0);
//   } else if ( evTexel.b > 0.0 ) {
//     fragColor = vec4(0.0, 0.0, 1.0, 1.0);
//   } else {
//     fragColor = vec4(0.0);
//   }
//
//   return;


  // float elevation = canvasElevationFromPixel(elevationTexel.r, uElevationResolution);

  // For testing, simply color the fragment using a ratio of elevation.
  // float elevationMin = uElevationResolution.r;



//   if ( elevation <= elevationMin ) {
//     fragColor = vec4(0.2);
//   } else {
//     fragColor = vec4(stepColor(elevation / 100.0), 0.7);
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
  vec4 elevationTexel = texture(uElevationMap, vElevationCoord);
  float elevation = canvasElevationFromPixel(elevationTexel.r, uElevationResolution);

  // For testing, simply color the fragment using a ratio of elevation.
  float elevationMin = uElevationResolution.r;

  if ( elevationTexel.r > 0.0 ) {
    fragColor = vec4(1.0, 0.0, 0.0, 1.0);
  } else if ( elevationTexel.g > 0.0 ) {
    fragColor = vec4(1.0, 0.0, 0.0, 1.0);
  } else if ( elevationTexel.b > 0.0 ) {
    fragColor = vec4(0.0, 0.0, 1.0, 1.0);
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



/* Testing
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
uniforms = {
  uLightPosition: [lightPosition.x, lightPosition.y, lightPosition.z],
  uCanvasElevation: 0,
  uLightSize: lightSize
}

geometry = constructWallGeometry(map)

let { vertexShader, fragmentShader } = wallShadowShaderGLSL;
shader = PIXI.Shader.from(vertexShader, fragmentShader, uniforms);
mesh = new PIXI.Mesh(geometry, shader);
mesh.blendMode = PIXI.BLEND_MODES.MULTIPLY;

canvas.stage.addChild(mesh);
canvas.stage.removeChild(mesh)

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

/* Test terrain walls
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

Draw.clearDrawings()
Draw.point(lightPosition, { color: Draw.COLORS.yellow });
cir = new PIXI.Circle(lightPosition.x, lightPosition.y, lightSize);
Draw.shape(cir, { color: Draw.COLORS.yellow, fill: Draw.COLORS.yellow, fillAlpha: 0.5 })

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

invSideRatio = ixDist / vertexDist;
bigABDist = abDist * invSideRatio


ix2 = intersectRayPlane(lightPosition, otherVertex.subtract(lightPosition).normalize(),
  canvasPlane.point, canvasPlane.normal)
Draw.point(ix2)
PIXI.Point.distanceBetween(ix, ix2); // Should equal bigABDist

penumbraRatio = vertexDist / (ixDist - vertexDist)
lightSizeProjected = lightSize * penumbraRatio
vSidePenumbraRatio = lightSizeProjected / bigABDist;

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
let canvasRect = canvas.dimensions.rect;
let sceneRect = canvas.dimensions.sceneRect;
elevationMap = canvas.elevation._elevationTexture;

geometryQuad = new PIXI.Geometry();

// Build a quad that equals the light bounds.
geometryQuad.addAttribute("aVertexPosition", [
  sceneRect.left, sceneRect.top, 0,
  sceneRect.right, sceneRect.top, 0,
  sceneRect.right, sceneRect.bottom, 0,
  sceneRect.left, sceneRect.bottom, 0
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


let { pixels, width, height } = extractPixels(canvas.app.renderer, elevationMap);
channels = [0];
channels = channels.map(c => filterPixelsByChannel(pixels, c, 1));
channels.map(c => pixelRange(c));
channels.map(c => uniquePixels(c));
channels.map(c => countPixels(c, 1));


*/


/* Test rendering the elevation texture over the light area only
MAX_WIDTH = 4096;
MAX_HEIGHT = 4096;
sceneRect = canvas.dimensions.sceneRect;
let lightFrame;
let elevationFrame;
let textureFrame = new PIXI.Rectangle();
let width;
let height;
evTex = canvas.elevation._elevationTexture;
if ( map.directional ) {
  width = sceneRect.width;
  height = sceneRect.height;
  lightFrame = evTex.frame;
  elevationFrame = lightFrame;
} else {
  lightFrame = l.bounds;
  width = lightFrame.width;
  height = lightFrame.height;

  // Need to keep the frame within the texture, and account for ev texture resolution.
  let frameCorner = map.lightPosition.to2d();
  frameCorner.subtract({x: sceneRect.width, y: sceneRect.height}, frameCorner);
  let diffX = frameCorner.x >= 0 ? 0 : -frameCorner.x;
  let diffY = frameCorner.y >= 0 ? 0 : -frameCorner.y;
  elevationFrame = new PIXI.Rectangle(frameCorner.x + diffX, frameCorner.y + diffY, width - diffX, height - diffY);
  textureFrame.copyFrom(elevationFrame);


  // Modify resolution
  elevationFrame.width *= evTex.resolution;
  elevationFrame.height *= evTex.resolution;

  // Check the extent of width and height
  elevationFrame.width = Math.min(elevationFrame.width, evTex.baseTexture.width);
  elevationFrame.height = Math.min(elevationFrame.height, evTex.baseTexture.height)

  textureFrame.width = Math.min(textureFrame.width, canvas.dimensions.width);
  textureFrame.height = Math.min(textureFrame.height, canvas.dimensions.height);

}

let { pixels } = extractPixels(canvas.app.renderer, evTex);
channels = [0, 1, 2, 3];
channels = channels.map(c => filterPixelsByChannel(pixels, c, 4));
channels.map(c => pixelRange(c));
channels.map(c => uniquePixels(c));


elevationMap = new PIXI.Texture(evTex.baseTexture, elevationFrame)

width = Math.min(width, MAX_WIDTH);
height = Math.min(height, MAX_HEIGHT);


geometryQuad = new PIXI.Geometry();

// Build a quad that equals the light bounds.
geometryQuad.addAttribute("aVertexPosition", [
  lightFrame.left, lightFrame.top, 0,
  lightFrame.right, lightFrame.top, 0,
  lightFrame.right, lightFrame.bottom, 0,
  lightFrame.left, lightFrame.bottom, 0
], 3);



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
