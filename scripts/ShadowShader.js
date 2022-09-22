/* globals
AdaptiveLightingShader,
*/
"use strict";

export class ShadowShader extends AdaptiveLightingShader {

  static vertexShader = `
  ${this.VERTEX_ATTRIBUTES}
  ${this.VERTEX_UNIFORMS}
  ${this.VERTEX_FRAGMENT_VARYINGS}

  uniform mat3 canvasMatrix;
  varying vec2 vCanvasCoord;

  void main() {
//     vTextureCoord = aVertexPosition * (outputFrame.zw * inputSize.zw);
//     vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.)) + outputFrame.xy;
//     vCanvasCoord = (canvasMatrix * vec3(position, 1.0)).xy;

    vec3 tPos = translationMatrix * vec3(aVertexPosition, 1.0);
    vCanvasCoord = (canvasMatrix * vec3(tPos.xy, 1.0)).xy;

    vUvs = aVertexPosition * 0.5 + 0.5;
    vDepth = aDepthValue;
    vSamplerUvs = tPos.xy / screenDimensions;
    gl_Position = vec4((projectionMatrix * tPos).xy, 0.0, 1.0);
  }`;

  static fragmentShader = `
  varying vec2 vCanvasCoord;

  void main() {
    gl_FragColor = vec4(1., 0., 0., 1.);
  }
  `;

  /** @override */
  static create(uniforms={}, source) {
    updateShadowShaderUniforms(uniforms, source);
    return super.create(uniforms);
  }

}

function updateShadowShaderUniforms(uniforms, source) {
  uniforms.canvasMatrix ??= new PIXI.Matrix();
  uniforms.canvasMatrix.copyFrom(source.illumination.worldTransform).invert();
}

/**
 * Wrap LightSource.prototype.updateUniforms
 */
export function _updateUniformsLightSource(wrapper) {
  wrapper();
  updateShadowShaderUniforms(this._EV_mesh.los.shader.uniforms, this);
}

/**
 * Wrap VisionSource.prototype.updateUniforms
 */
export function _updateUniformsVisionSource(wrapper) {
  wrapper();
  updateShadowShaderUniforms(this._EV_mesh.los.shader.uniforms, this);
  updateShadowShaderUniforms(this._EV_mesh.fov.shader.uniforms, this);
}
