// From https://github.com/dev7355608/perfect-vision/blob/6e05503fcbe9de5a1dedb89389c366b14427ac7a/scripts/core/point-source-shader.js#L1

export class DepthStencilShader extends PIXI.Shader {
    static vertexShader = `\
        attribute vec2 aVertexPosition;
        uniform mat3 projectionMatrix;
        uniform mat3 translationMatrix;
        uniform mat3 textureMatrix;
        varying vec2 vTextureCoord;
        void main() {
            vTextureCoord = (textureMatrix * vec3(aVertexPosition, 1.0)).xy;
            gl_Position = vec4((projectionMatrix * (translationMatrix * vec3(aVertexPosition, 1.0))).xy, 0.0, 1.0);
        }`;

    static fragmentShader = `\
        varying vec2 vTextureCoord;
        uniform sampler2D sampler;
        uniform float alphaThreshold;
        uniform float depthElevation;
        void main() {
            if (texture2D(sampler, vTextureCoord).a <= alphaThreshold) {
                discard;
            }
            gl_FragColor = vec4(0.0, 0.0, 0.0, depthElevation);
        }`;

    /**
     * The default uniforms.
     * @type {object}
     * @readonly
     */
    static defaultUniforms = {
        sampler: PIXI.Texture.WHITE,
        textureMatrix: PIXI.Matrix.IDENTITY,
        alphaThreshold: 0.75,
        depthElevation: 0
    };

    static #program;

    /**
     * Create a new instance.
     * @param {object} [defaultUniforms]- The default uniforms.
     * @returns {DepthStencilShader}
     */
    static create(defaultUniforms = {}) {
        const program = DepthStencilShader.#program ??= PIXI.Program.from(
            DepthStencilShader.vertexShader,
            DepthStencilShader.fragmentShader
        );
        const uniforms = foundry.utils.mergeObject(
            this.defaultUniforms,
            defaultUniforms,
            { inplace: false, insertKeys: false }
        );

        return new this(program, uniforms);
    }

    /**
     * A shared instance.
     * @type {DepthStencilShader}
     * @readonly
     */
    static instance = DepthStencilShader.create();

    /**
     * The texture.
     * @type {PIXI.Texture}
     */
    get texture() {
        return this.uniforms.sampler;
    }

    set texture(value) {
        this.uniforms.sampler = value;
    }

    /**
     * The texture matrix.
     * @type {PIXI.Texture}
     */
    get textureMatrix() {
        return this.uniforms.textureMatrix;
    }

    set textureMatrix(value) {
        this.uniforms.textureMatrix = value;
    }

    /**
     * The alpha threshold.
     * @type {number}
     */
    get alphaThreshold() {
        return this.uniforms.alphaThreshold;
    }

    set alphaThreshold(value) {
        this.uniforms.alphaThreshold = value;
    }

    /**
     * The depth elevation.
     * @type {number}
     */
    get depthElevation() {
        return this.uniforms.depthElevation;
    }

    set depthElevation(value) {
        this.uniforms.depthElevation = value;
    }
}