/* globals
AdaptiveLightingShader,
*/
"use strict";

import { log } from "./util.js";


export class ShadowShader extends AdaptiveLightingShader {

  static vertexShader = `
  ${this.VERTEX_ATTRIBUTES}
  ${this.VERTEX_UNIFORMS}
  ${this.VERTEX_FRAGMENT_VARYINGS}

  uniform vec4 EV_transform;
  varying vec2 EV_textureCoord;

  void main() {
    vec3 tPos = translationMatrix * vec3(aVertexPosition, 1.0);
    vUvs = aVertexPosition * 0.5 + 0.5;
    vDepth = aDepthValue;
    vSamplerUvs = tPos.xy / screenDimensions;

    EV_textureCoord = EV_transform.xy * vUvs + EV_transform.zw;

    gl_Position = vec4((projectionMatrix * tPos).xy, 0.0, 1.0);
  }`;

  static fragmentShader = `
  varying vec2 EV_textureCoord;
  varying vec2 vSamplerUvs;

  uniform sampler2D uSampler;
  uniform sampler2D EV_elevationSampler;
  uniform vec2 EV_canvasXY;

  // Defined constants
  vec4 visionColor = vec4(1., 0., 0., 1.);
  vec4 shadowColor = vec4(0., 0., 0., 1.);

  void main() {
    vec4 backgroundElevation = texture2D(EV_elevationSampler, EV_textureCoord);

    if ( backgroundElevation.r > 0. ) {
      gl_FragColor = shadowColor;
//       discard;
    } else {
//       vec4 fg = texture2D(uSampler, vSamplerUvs);
//        gl_FragColor = fg;
      gl_FragColor = visionColor;

    }
  }
  `;

  /** @override */
  static create(uniforms={}, source) {
    updateShadowShaderUniforms(uniforms, source);
    return super.create(uniforms);
  }

}

function updateShadowShaderUniforms(uniforms, source) {
  // Screen-space to local coords:
  // https://ptb.discord.com/channels/732325252788387980/734082399453052938/1010914586532261909
  // shader.uniforms.EV_canvasMatrix ??= new PIXI.Matrix();
  // shader.uniforms.EV_canvasMatrix
  //   .copyFrom(canvas.stage.worldTransform)
  //   .invert()
  //   .append(mesh.transform.worldTransform);

  // Alternative version using vUvs, given that light source mesh have no rotation
  // https://ptb.discord.com/channels/732325252788387980/734082399453052938/1010999752030171136
  const { width, height } = canvas.dimensions;
  const { x, y, radius } = source;
  uniforms.EV_transform = [
    radius * 2 / width,
    radius * 2 / height,
    (x - radius) / width,
    (y - radius) / height
  ];
  uniforms.EV_elevationSampler = canvas.elevation?._elevationTexture || PIXI.Texture.EMPTY;
}

/**
 * Wrap LightSource.prototype.updateUniforms
 */
export function _updateUniformsLightSource(wrapper) {
  wrapper();
  if ( this._EV_mesh.los._destroyed ) {
    log("_updateUniformsLightSource los mesh destroyed!");
    this._createEVMeshes();
  }

  updateShadowShaderUniforms(this._EV_mesh.los.shader.uniforms, this);
}

/**
 * Wrap VisionSource.prototype.updateUniforms
 */
export function _updateUniformsVisionSource(wrapper) {
  wrapper();
  if ( this._EV_mesh.los._destroyed || this._EV_mesh.fov._destroyed ) {
    log("_updateUniformsLightSource los mesh destroyed!");
    this._createEVMeshes();
  }

  updateShadowShaderUniforms(this._EV_mesh.los.shader.uniforms, this);
  updateShadowShaderUniforms(this._EV_mesh.fov.shader.uniforms, this);
}
