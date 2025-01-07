#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Unsized Vertex ----- */

in vec2 aVertex;
in float aEdgeDist;

out vec2 vVertexPosition;
out vec2 vTerrainTexCoord;
out float vEdgeDist;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec4 uSceneDims;

void main() {
  vVertexPosition = aVertex;
  vTerrainTexCoord = (vVertexPosition - uSceneDims.xy) / uSceneDims.zw;
  vEdgeDist = aEdgeDist;
}