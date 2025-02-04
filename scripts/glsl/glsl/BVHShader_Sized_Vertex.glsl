#version 300 es
precision ${PRECISION_VERTEX} float;
/* ----- NOTE: Unsized Vertex ----- */

/* ----- NOTE: In Variables ----- */
in vec2 aVertexPosition;

/* ----- NOTE: Out Variables ----- */
out vec2 vVertexPosition;
out vec2 vTerrainTexCoord;

/* ----- NOTE: Uniform Variables ----- */
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec4 uSceneDims;

/* ----- NOTE: Vertex Main ----- */
void main() {
  vVertexPosition = aVertexPosition;
  vTerrainTexCoord = (vVertexPosition - uSceneDims.xy) / uSceneDims.zw;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(vVertexPosition, 1.0)).xy, 0.0, 1.0);
}
