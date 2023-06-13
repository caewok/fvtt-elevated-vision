/* global
canvas,
PIXI
*/
"use strict";

export class EVQuadMesh extends PIXI.Mesh {
  /**
   * Vertex shader constructs a quad and
   * calculates the canvas coordinate and texture coordinate varyings.
   */
  static vertexShader =
`
#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec2 aVertexPosition;
in vec2 aTextureCoord;

out vec2 vVertexPosition;
out vec2 vTextureCoord;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

void main() {
  vVertexPosition = aVertexPosition;
  vTextureCoord = aTextureCoord;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

  /**
   * Fragment shader intended to be overriden by subclass.
   */
  static fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec2 vVertexPosition;
in vec2 vTextureCoord;

out vec4 fragColor;

void main() {
  fragColor = vec4(0.0);
}`;

  static defaultUniforms = {};

  constructor(rect, { uniforms, vertexShader, fragmentShader, state, drawMode } = {}) {
    // Determine default parameters for the mesh.
    const geometry = EVQuadMesh.calculateQuadGeometry(rect);
    uniforms ??= {};
    vertexShader ??= EVQuadMesh.vertexShader;
    fragmentShader ??= EVQuadMesh.fragmentShader;
    state ??= new PIXI.State();
    drawMode ??= PIXI.DRAW_MODES.TRIANGLES;

    // Create shader
    const shader = PIXI.Shader.from(vertexShader, fragmentShader, uniforms);

    // Create the mesh
    super(geometry, shader, state, drawMode);

    // Store parameters
    this.rect = rect;
    this.uniforms = uniforms;
  }

  /**
   * Construct a geometry that represents a rectangle on the canvas.
   * Adds vertex coordinates and texture UV coordinates.
   * @param {PIXI.Rectangle} rect   Rectangle to use for the frame.
   * @returns {PIXI.Geometry}
   */
  static calculateQuadGeometry(rect) {
    const { left, right, top, bottom } = rect;
    const geometry = new PIXI.Geometry();
    geometry.addAttribute("aVertexPosition", [
      left, top,      // TL
      right, top,   // TR
      right, bottom, // BR
      left, bottom  // BL
    ], 2);

    // Texture coordinates:
    // BL: 0,0; BR: 1,0; TL: 0,1; TR: 1,1
    geometry.addAttribute("aTextureCoord", [
      0, 0, // TL
      1, 0, // TR
      1, 1, // BR
      0, 1 // BL
    ], 2);
    geometry.addIndex([0, 1, 2, 0, 2, 3]);
    return geometry;
  }
}

export class ElevationLayerShader extends EVQuadMesh {
  static fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec2 vVertexPosition;
in vec2 vTextureCoord;

out vec4 fragColor;

uniform sampler2D uTerrainSampler; // Elevation Texture
uniform vec4 uElevationRes;

/**
 * Calculate the canvas elevation given a pixel value.
 * Currently uses only the red channel.
 * Maps 0–1 red channel to elevation in canvas coordinates.
 * r: elevation min; g: elevation step; b: max pixel value (likely 255); a: canvas size / distance
 * uElevationRes = [elevationMin, elevationStep, maximumPixelValue, elevationMult];
 */
float canvasElevationFromPixel(in vec4 pixel) {
  return (uElevationRes.r + (pixel.r * uElevationRes.b * uElevationRes.g)) * uElevationRes.a;
}

/**
 * Determine the color for a given elevation value.
 * Currently draws increasing shades of red with a gamma correction to avoid extremely light alpha.
 * Currently takes the elevation pixel, not the elevation canvas value.
 */
vec4 colorForElevationPixel(vec4 elevation) {
  float alphaAdj = pow(elevation.r, 1. / 2.2);
  return vec4(alphaAdj, 0., 0., alphaAdj);
}

void main() {
  // Terrain is sized to the scene.
  vec4 terrainPixel = texture(uTerrainSampler, vTextureCoord);
  float elevation = canvasElevationFromPixel(terrainPixel);
  fragColor = colorForElevationPixel(terrainPixel);
}`;

  constructor() {
    const uniforms = {
      uElevationRes: [
        canvas.elevation.elevationMin,
        canvas.elevation.elevationStep,
        canvas.elevation.maximumPixelValue,
        canvas.dimensions.distancePixels
      ],
      uTerrainSampler: canvas.elevation._elevationTexture
    };

    const fragmentShader = ElevationLayerShader.fragmentShader;
    super(canvas.dimensions.sceneRect, { uniforms, fragmentShader });
  }
}
