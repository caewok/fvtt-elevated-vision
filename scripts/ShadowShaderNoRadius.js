/* globals
*/
"use strict";

import { ShadowShader, UNIFORMS } from "./ShadowShader.js";
import { updateUniformsForSource } from "./Shadow_GLSL.js";

export class ShadowShaderNoRadius extends ShadowShader {
  static vertexShader = `
    attribute vec2 aVertexPosition;
    uniform mat3 projectionMatrix;
    uniform mat3 translationMatrix;
    uniform mat3 textureMatrix;
    uniform vec2 EV_canvasDims;
    varying vec2 vTextureCoord;

    ${UNIFORMS}

    // EV-specific variables
    varying vec2 EV_textureCoord;
    varying vec2 EV_pixelXY;

    void main() {
      vTextureCoord = (textureMatrix * vec3(aVertexPosition, 1.0)).xy;
      EV_textureCoord = vTextureCoord / EV_canvasDims;
      EV_pixelXY = vTextureCoord;
      gl_Position = vec4((projectionMatrix * (translationMatrix * vec3(aVertexPosition, 1.0))).xy, 0.0, 1.0);
    }
  `;

  updateUniforms(source) {
    updateUniformsForSource(this.uniforms, source, { useRadius: false });
  }
}
