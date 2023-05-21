// Draw trapezoidal shape of shadow directly on the canvas.
// Take a vertex, light position, and canvas elevation.
// Project the vertex onto the flat 2d canvas.

function smoothstep(edge0, edge1, x) {
  const t = Math.clamped((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Set up geometry
// TODO: Could use triangle fan
// https://www.html5gamedevs.com/topic/44378-pixidraw_modespoints-doesnt-work/
// https://api.pixijs.io/@pixi/constants/PIXI/DRAW_MODES.html
// Use the map to build the geometry
// Use 4 triangles per quad so we can blend left/right
// Center point first then the 4 vertices.
function wallVertices(map, wallObj, aVertexPosition, lightBounds, abCoords, sideLengths) {
    const orientWall = foundry.utils.orient2dFast(wallObj.A, wallObj.B, map.lightPosition);
    if ( orientWall.almostEqual(0) ) return false; // Wall is collinear to the light.

    const topZ = Math.min(wallObj.topZ, map.lightPosition.z - 1);
    const bottomZ = Math.max(wallObj.bottomZ, map.minElevation);
    if ( topZ <= bottomZ ) return false; // Wall is above or below the viewing box.

    // Point source lights are limited to a max radius; drop walls outside the radius
    if ( !map.directional
      && !lightBounds.lineSegmentIntersects(wallObj.A, wallObj.B, { inside: true })) return false;

    // Calculate the center point of the wall quad.
    const aT3 = new Point3d(wallObj.A.x, wallObj.A.y, topZ);
    const bB3 = new Point3d(wallObj.B.x, wallObj.B.y, bottomZ);
    const center = aT3.projectToward(bB3, 0.5);
    aVertexPosition.push(center.x, center.y, center.z);

    // Arrange so A --> B --> lightPosition is counterclockwise
    // const [A, B] = orientWall > 0 ? [wallObj.A, wallObj.B] : [wallObj.B, wallObj.A];
    const [A, B] = [wallObj.A, wallObj.B];
    aVertexPosition.push(A.x, A.y, topZ);
    aVertexPosition.push(B.x, B.y, topZ);
    aVertexPosition.push(B.x, B.y, bottomZ);
    aVertexPosition.push(A.x, A.y, bottomZ);

    abCoords.push(
      center.x, center.y,
      B.x, B.y,
      A.x, A.y,
      A.x, A.y,
      B.x, B.y
    );

    // vec4 with:
    // x: 0 --> 1 moving from A to B
    // y: 0 --> 1 moving from bottom to top
    // z: distance of AB
    // w: height
    const abDist = PIXI.Point.distanceBetween(wallObj.A, wallObj.B);
    const height = topZ - bottomZ;
    sideLengths.push(
      0.5, 0.5, abDist, height, // Center
      0, 1, abDist, height,     // A top
      1, 1, abDist, height,     // B top
      1, 0, abDist, height,     // B bottom
      0, 0, abDist, height      // A bottom
    );

    return true;
}

function tileVertices(map, tileObj, aVertexPosition, lightBounds, abCoords, sideLengths) {
    const elevationZ = tileObj.elevationZ;
    if ( map.lightPosition.z <= elevationZ ) return false; // Tile is collinear to or above the light.
    if ( elevationZ < map.minElevation ) return false; // Tile is below the minimum elevation.

    // Drop walls outside the point source light radius.
    // Use the bounds for the tile points.
    const xMinMax = Math.minMax(tileObj.TL.x, tileObj.TR.x, tileObj.BR.x, tileObj.BL.x);
    const yMinMax = Math.minMax(tileObj.TL.y, tileObj.TR.y, tileObj.BR.y, tileObj.BL.y);
    const tileBounds = new PIXI.Rectangle(xMinMax.min, yMinMax.y, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
    if ( !map.directional && !lightBounds._overlapsRectangle(tileBounds) ) return false;


    // Calculate the center point of the wall quad.
    const center = tileObj.TL.projectToward(tileObj.BR, 0.5);
    aVertexPosition.push(center.x, center.y, elevationZ);

    // Arrange TL --> TR --> BR --> BL
    aVertexPosition.push(tileObj.TL.x, tileObj.TL.y, elevationZ);
    aVertexPosition.push(tileObj.TR.x, tileObj.TR.y, elevationZ);
    aVertexPosition.push(tileObj.BR.x, tileObj.BR.y, elevationZ);
    aVertexPosition.push(tileObj.BL.x, tileObj.BL.y, elevationZ);

    // Doesn't really work for tiles, so just fill in for now.
    abCoords.push(
      center.x, center.y,
      tileObj.TR.x, tileObj.TR.y,
      tileObj.BR.x, tileObj.BR.y,
      tileObj.BL.x, tileObj.BL.y,
      tileObj.TL.x, tileObj.TL.y
    );

    // vec4 with:
    // x: 0 --> 1 moving from TL --> TR
    // y: 0 --> 1 moving from BL --> TL
    // z: distance of TL --> TR
    // w: distance of BL --> TL
    const tltrDist = PIXI.Point.distanceBetween(tileObj.TL, tileObj.TR);
    const bltlDist = PIXI.Point.distanceBetween(tileObj.BL, tileObj.TL);
    sideLengths.push(
      0.5, 0.5, tltrDist, bltlDist, // Center
      0, 1, tltrDist, bltlDist,     // A top
      1, 1, tltrDist, bltlDist,     // B top
      1, 0, tltrDist, bltlDist,     // B bottom
      0, 0, tltrDist, bltlDist      // A bottom
    );

    return true;
  }

PLACEABLE_TYPES = {
  WALL: 0,
  TERRAIN_WALL: 1,
  TILE: 2,
  TRANSPARENT_TILE: 3
};

function constructGeometry(map) {
  const coords = map.placeablesCoordinatesData.coordinates;
  const nObjs = coords.length;
  const { WALL, TERRAIN_WALL, TILE, TRANSPARENT_TILE } = PLACEABLE_TYPES;

  // Need to cut off walls at the top/bottom bounds of the scene, otherwise they
  // will be given incorrect depth values b/c there is no floor or ceiling.
  // Point source lights have bounds
  let lightBounds;
  if ( !map.directional ) {
    const { lightPosition, lightRadius } = map;
    lightBounds = new PIXI.Rectangle(
      lightPosition.x - lightRadius,
      lightPosition.y - lightRadius,
      lightRadius * 2,
      lightRadius * 2);
  }

  // TODO: Try Uint or other buffers instead of Array.
  const indices = [];
  const aVertexPosition = [];
  const aObjType = [];
  const aObjIndex = [];
  const aTexCoord = [];
  const abCoords = [];
  const sideLengths = [];
  let objNumber = 0;
  for ( let i = 0; i < nObjs; i += 1 ) {
    const obj = coords[i];
    const isWall = obj.object instanceof Wall;
    const method = isWall ? wallVertices : tileVertices;
    if ( !method(map, obj, aVertexPosition, lightBounds, abCoords, sideLengths) ) continue;


    // 5 vertices per wall or tile
    // Center point then 4 outer points
    // Indices for triangles are:
    // 0 1 2
    // 0 2 3
    // 0 3 4
    // 0 4 1

    const v = objNumber * 5; // Five vertices per wall
    indices.push(
      v, v + 1, v + 2,
      v, v + 2, v + 3,
      v, v + 3, v + 4,
      v, v + 4, v + 1
    );

    // Texture coordinates
    aTexCoord.push(
      0.5, 0.5, // Center
      0, 0, // BL
      1, 0, // BR
      1, 1, // TR
      0, 1  // TL
    );

    // Label vertices with the type of object and track transparencies.
    let objType;
    if ( isWall ) {
      objType = obj.isTerrain ? TERRAIN_WALL : WALL;
    } else { // Is Tile
      objType = obj.hasTransparency ? TRANSPARENT_TILE : TILE;
    }

    // 5 vertices, so repeat labels x5.
    aObjType.push(objType, objType, objType, objType, objType);
    aObjIndex.push(i, i, i, i, i);

    // Increment to the next wall.
    objNumber += 1;
  }

  // TODO: set interleave to true?
  const geometry = new PIXI.Geometry();
  geometry.addIndex(indices);
  geometry.addAttribute("aVertexPosition", aVertexPosition, 3, false);
  geometry.addAttribute("aObjType", aObjType, 1, false);
  geometry.addAttribute("aObjIndex", aObjIndex, 1, false);
  geometry.addAttribute("aTexCoord", aTexCoord, 2, false);
  geometry.addAttribute("abCoords", abCoords, 2, false);
  geometry.addAttribute("aSideLengths", sideLengths, 4, false);
  return geometry;
}

shadowShapeShaderGLSL = {};
shadowShapeShaderGLSL.vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec3 uLightPosition;
uniform float uCanvasElevation;
uniform float uLightSize;

in vec3 aVertexPosition;
in vec2 abCoords;
in vec2 aTexCoord;
in vec4 aSideLengths;
out vec3 vertexPosition;
out vec3 shadowVertexPosition;
out float radiusAtCanvas;
out float distanceRatioToWall;
out float leftRight;
out float distanceLeftRight;
out float distanceRatioToEdge;
out vec2 radiusDistanceRatio;
flat out float vertexId;
out vec2 vTexCoord;
out vec4 vSideLengths;

// Note: lineDirection and planeNormal should be normalized.
vec3 intersectLineWithPlane(vec3 linePoint, vec3 lineDirection, vec3 planePoint, vec3 planeNormal, inout bool ixFound) {
  float denom = dot(planeNormal, lineDirection);

  ixFound = false;
  if (abs(denom) < 0.0001) {
      // Line is parallel to the plane, no intersection
      return vec3(-1.0);
  }

  ixFound = true;
  float t = dot(planeNormal, planePoint - linePoint) / denom;
  return linePoint + lineDirection * t;
}

void main() {
  vertexPosition = aVertexPosition;
  shadowVertexPosition = aVertexPosition;
  vTexCoord = aTexCoord;
  radiusAtCanvas = 0.0;
  distanceRatioToWall = 0.0;
  distanceLeftRight = distance(aVertexPosition.xy, abCoords);
  distanceRatioToEdge = 0.0;
  vSideLengths = aSideLengths;

  radiusDistanceRatio = vec2(0.0, 0.0);
  if ( aTexCoord.x == 0.5 ) distanceRatioToEdge = 1.0;


  float id = mod(float(gl_VertexID), 5.0);
  vertexId = float(gl_VertexID);

  if ( id == 0.0 ) {
    leftRight = 0.5;
  } else leftRight = float(id == 1.0 || id == 4.0);

  if ( vertexPosition.z <= uCanvasElevation ) {
    // Vertex is below the canvas; raise to the canvas elevation.
    vertexPosition.z = uCanvasElevation;
    shadowVertexPosition.z = uCanvasElevation;
  } else {
    // Vertex is above the canvas; intersect the light --> vertex --> canvas.
    // Plane plane = Plane(vec3(0.0), vec3(0.0, 0.0, 1.0));
    bool ixFound;
    vec3 planeNormal = vec3(0.0, 0.0, 1.0);
    vec3 planePoint = vec3(0.0);
    vec3 lineDirection = normalize(vertexPosition - uLightPosition);
    vec3 ix = intersectLineWithPlane(uLightPosition, lineDirection, planePoint, planeNormal, ixFound);
    if ( ixFound ) {
      float distLightToVertex = distance(uLightPosition, aVertexPosition);
      float distVertexToIx = distance(aVertexPosition, ix);
      float ratio = distVertexToIx / distLightToVertex;
      radiusAtCanvas = uLightSize * ratio;
      shadowVertexPosition = ix;
      distanceRatioToWall = 1.0;

      radiusDistanceRatio = radiusAtCanvas / aSideLengths.zw;

      // Project to the other vertex to calculate the distance between the two.
//       vec3 otherLineDirection = normalize(vec3(abCoords, aVertexPosition.z) - uLightPosition);
//       vec3 ixOther = intersectLineWithPlane(uLightPosition, otherLineDirection, planePoint, planeNormal, ixFound);
//       if ( ixFound ) distanceLeftRight = distance(ixOther, ix);
    }
  }
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(shadowVertexPosition.xy, 1.0)).xy, 0.0, 1.0);
}`;

shadowShapeShaderGLSL.fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;

in vec3 vertexPosition;
in vec3 shadowVertexPosition;
in float radiusAtCanvas;
in float distanceRatioToWall;
in float leftRight;
in float distanceLeftRight;
in vec2 vTexCoord;
in float distanceRatioToEdge;
in vec4 vSideLengths;
flat in float vertexId;
in vec2 radiusDistanceRatio;
out vec4 fragColor;

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

// For debugging
// Red is least; blue is most.
// Green is near 50%
vec3 stepColor(in float ratio) {
  if ( ratio < 0.2 ) return vec3(smoothstep(0.0, 0.2, ratio), 0.0, 0.0);
  if ( ratio < 0.4 ) return vec3(smoothstep(0.2, 0.4, ratio), smoothstep(0.2, 0.4, ratio), 0.0);
  if ( ratio < 0.6 ) return vec3(0.0, smoothstep(0.4, 0.6, ratio), 0.0);
  if ( ratio < 0.8 ) return vec3(0.0, smoothstep(0.6, 0.8, ratio), smoothstep(0.6, 0.8, ratio));
  return vec3(0.0, 0.0, smoothstep(0.8, 1.0, ratio));
}


void main() {
  // Color the area associated with each vertex separately.
  //fragColor = vec4(mod(vertexId + 1.0, 6.0) / 6.0, 0.0, 0.0, 0.5);
  //return;

  // Color according to a side parameter.
  //fragColor = vec4(stepRatio(vSideLengths.x, 5.0), stepRatio(vSideLengths.x, 6.0), 0.0, 0.5);
  //return;

  // Color according to how near the fragment is to an edge.
  //fragColor = vec4(distanceRatioToEdge, 0.0, 0.0, 0.5);
  //return;

  // fragColor = vec4(0.0, leftRight, 0.0, 0.5);
  //float lr = radiusDistanceRatio.x * 10.0;
  //fragColor = vec4(stepColor(lr), 0.5);
  // return;

  // fragColor = vec4(vTexCoord.x, 0.0, 0.0, 0.5);


  float penumbra = min(distanceRatioToEdge / radiusDistanceRatio.x, 1.0);
  fragColor = vec4(stepColor(penumbra), 0.5);
}`;


/* Testing
api = game.modules.get("elevatedvision").api
Draw = CONFIG.GeometryLib.Draw;
Draw.clearDrawings()
SourceDepthShadowMap = api.SourceDepthShadowMap
Point3d = CONFIG.GeometryLib.threeD.Point3d
Matrix = CONFIG.GeometryLib.Matrix


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
if ( !directional ) Draw.shape(new PIXI.Circle(map.lightPosition.x, map.lightPosition.y, map.lightRadiusAtMinElevation), { color: Draw.COLORS.lightyellow})
uniforms = {
  uLightPosition: [lightPosition.x, lightPosition.y, lightPosition.z],
  uCanvasElevation: 0,
  uLightSize: 100
}

geometry = constructGeometry(map)
let { vertexShader, fragmentShader } = shadowShapeShaderGLSL;
shader = PIXI.Shader.from(vertexShader, fragmentShader, uniforms);
mesh = new PIXI.Mesh(geometry, shader);

canvas.stage.addChild(mesh);
canvas.stage.removeChild(mesh)
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

