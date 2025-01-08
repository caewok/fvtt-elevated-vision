#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Unsized Vertex ----- */

/* ----- NOTE: In Variables ----- */
in vec2 aVertex;
in float aEdgeDist;

/* ----- NOTE: Out Variables ----- */
out vec2 vVertexPosition;
out vec2 vTerrainTexCoord;
out float vEdgeDist;

/* ----- NOTE: Uniform Variables ----- */
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec4 uSceneDims;

/* ----- NOTE: Vertex Main ----- */
void main() {
  vVertexPosition = aVertex;
  vTerrainTexCoord = (vVertexPosition - uSceneDims.xy) / uSceneDims.zw;
  vEdgeDist = aEdgeDist;
}