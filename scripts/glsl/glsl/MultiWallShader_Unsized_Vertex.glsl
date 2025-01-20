#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Unsized Vertex ----- */

/* ----- NOTE: In Variables ----- */
in vec2 aVertex;
in float aEdgeDist;
in float aWallType;
in float aThresholdRadius2;

/* ----- NOTE: Out Variables ----- */
out vec2 vVertexPosition;
out vec2 vTerrainTexCoord;
out float vEdgeDist;

flat out float fWallType;
flat out float fThresholdRadius2;

/* ----- NOTE: Uniform Variables ----- */
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec4 uSceneDims;

/* ----- NOTE: Vertex Main ----- */
void main() {
  // int vertexNum = gl_VertexID % 3;

  vVertexPosition = aVertex;
  vEdgeDist = aEdgeDist;
  vTerrainTexCoord = (vVertexPosition - uSceneDims.xy) / uSceneDims.zw;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(vVertexPosition, 1.0)).xy, 0.0, 1.0);

  // Flats
  fWallType = aWallType;
  fThresholdRadius2 = aThresholdRadius2;
}
