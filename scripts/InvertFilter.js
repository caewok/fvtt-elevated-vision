// From https://pixijs.download/v3.0.11/docs/filters_invert_InvertFilter.js.html


const shader =
`
precision mediump float;

varying vec2 vTextureCoord;

uniform float invert;
uniform sampler2D uSampler;

void main(void)
{
    gl_FragColor = texture2D(uSampler, vTextureCoord);

    gl_FragColor.rgb = mix( (vec3(1)-gl_FragColor.rgb) * gl_FragColor.a, gl_FragColor.rgb, 1.0 - invert);
}
`;

export class InvertFilter extends AbstractFilter {
  static defaultUniforms = {
    invert: { type: '1f', value: 1 }
  }

  static fragmentShader = `
  precision mediump float;

  varying vec2 vTextureCoord;

  uniform float invert;
  uniform sampler2D uSampler;

  void main(void)
  {
      gl_FragColor = texture2D(uSampler, vTextureCoord);

      gl_FragColor.rgb = mix( (vec3(1)-gl_FragColor.rgb) * gl_FragColor.a, gl_FragColor.rgb, 1.0 - invert);
  }`;

  /**
   * The strength of the invert. `1` will fully invert the colors, and
   * `0` will make the object its normal color.
   **/
  get invert() { return this.uniforms.invert.value; }
  set invert(value) { this.uniforms.invert.value = value; }

}
