// Draw trapezoidal shape of shadow directly on the canvas.
// Take a vertex, light position, and canvas elevation.
// Project the vertex onto the flat 2d canvas.

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
out vec3 vertexPosition;
out vec3 shadowVertexPosition;
out float radiusAtCanvas;
out float distanceToWall;
out float leftRight;
out float distanceLeftRight;

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
  radiusAtCanvas = 0.0;
  distanceToWall = 0.0;
  distanceLeftRight = distance(vertexPosition.xy, abCoords);

  float id = mod(float(gl_VertexID), 4.0);
  leftRight = float(id == 0.0 || id == 3.0);

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
      distanceToWall = 1.0;

      // Project to the other vertex to calculate the distance between the two.
      vec3 otherLineDirection = normalize(vec3(abCoords, aVertexPosition.z) - uLightPosition);
      vec3 ixOther = intersectLineWithPlane(uLightPosition, otherLineDirection, planePoint, planeNormal, ixFound);
      if ( ixFound ) distanceLeftRight = distance(ixOther, ix);
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
in float distanceToWall;
in float leftRight;
in float distanceLeftRight;
out vec4 fragColor;


void main() {
  // fragColor = vec4(distanceToWall, 0.0, 0.0, 0.5);
  // fragColor = vec4(0.0, leftRight, 0.0, 0.5);

  float penumbra = 1.0;
  float maxLRPenumbraRatio = radiusAtCanvas / distanceLeftRight;
  if ( leftRight < maxLRPenumbraRatio ) {
    penumbra = leftRight / maxLRPenumbraRatio;
  } else if ( (1.0 - leftRight) < maxLRPenumbraRatio ) {
    penumbra = (1.0 - leftRight) / maxLRPenumbraRatio;
  }

  // const maxNFPenumbraRatio = radiusAtCanvas / distanceToWall;
  if ( penumbra < 1.0 ) penumbra = 0.0;

  fragColor = vec4(penumbra, 0.0, 0.0, 0.5);
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

walls = canvas.walls.placeables;
map = new SourceDepthShadowMap(lightPosition, { walls, directional, lightRadius, lightSize });
if ( !directional ) Draw.shape(new PIXI.Circle(map.lightPosition.x, map.lightPosition.y, map.lightRadiusAtMinElevation), { color: Draw.COLORS.lightyellow})
uniforms = {
  uLightPosition: [lightPosition.x, lightPosition.y, lightPosition.z],
  uCanvasElevation: 0,
  uLightSize: 100
}

let { vertexShader, fragmentShader } = shadowShapeShaderGLSL;
shader = PIXI.Shader.from(vertexShader, fragmentShader, uniforms);
mesh = new PIXI.Mesh(map.geometry, shader);

canvas.stage.addChild(mesh);
canvas.stage.removeChild(mesh)
*/

