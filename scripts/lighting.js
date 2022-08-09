/* globals
PIXI,
canvas
*/
"use strict";

import { log } from "./util.js";
import { MODULE_ID } from "./const.js";


export function createAdaptiveLightingShader(wrapped, ...args) {
  const replaceUniformStr = "uniform sampler2D uBkgSampler;";
  const replaceFragStr = "float depth = smoothstep(0.0, 1.0, vDepth);";

  this.fragmentShader = this.fragmentShader.replace(
    replaceUniformStr, `${replaceUniformStr}\n${UNIFORMS}`);

  this.fragmentShader = this.fragmentShader.replace(
    replaceFragStr, `${replaceFragStr}\n${DEPTH_CALCULATION}`);

   const shader = wrapped(...args);
   shader.uniforms.EV_numWalls = 0;
   shader.uniforms.EV_wallCoords = new Float32Array();
   shader.uniforms.EV_pointRadius = .1;
   return shader;

}

const UNIFORMS =
`
uniform int EV_numWalls;
uniform vec3 EV_wallCoords[numWalls];
uniform float EV_pointRadius;
`;

// For now, just mark the endpoints of walls
// If near a wall endpoint, make depth 0.
const DEPTH_CALCULATION =
`
for ( int i = 0; i < EV_numWalls; i++ ) {
  const e0 = [EV_wallCoords[i], 1];
  if ( distance(e0, gl_FragCoord) < EV_pointRadius ) {
    depth = 0;
    break;
  }
}
`;

/**
 * @param {number[]} mat    Array, representing a square matrix
 * @param {number[]} vec    Array, representing a vector
 * @return {number[]} Vector result of mat * v
 */
function multMatrixVector(mat, vec) {
  const vln = vec.length;
  const matLn = mat.length;
  if ( matLn % vln !== 0 ) console.warn("multSquareMatrixVector requires matrix rows to equal vector length.");

  const res = [];
  for ( let r = 0; r < matLn; r += vln ) {
    let val = 0;
    for ( let c = 0; c < vln; c += 1 ) {
//       console.log(`r: ${r}; c: ${c} | ${mat[r + c]} * ${vec[c]}`)
      val += mat[r + c] * vec[c];
    }
    res.push(val);
  }
  return res;
}

/**
 * @param {number[]} mat3   Array, representing a 3x3 matrix.
 * @return {number[]} An array representing a 4x4 matrix
 */
function to4D(mat3) {
  return [
    mat3[0], mat3[1], mat3[2], 0,
    mat3[3], mat3[4], mat3[5], 0,
    mat3[6], mat3[7], mat3[9], 0,
    0, 0, 0, 1
  ];
}

export function _updateColorationUniformsLightSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;
  updateLightUniforms(this.coloration.shader);
}

export function _updateIlluminationUniformsLightSource(wrapped) {
  wrapped();
  if ( this instanceof GlobalLightSource ) return;
  updateLightUniforms(this.illumination.shader);
}

function updateLightUniforms(shader) {
  const u = shader.uniforms;

  const translationMatrix = shader.program.translationMatrix.value; // Float32Array[9]
  const projectionMatrix = shader.program.projectionMatrix.value; // Float32Array[9]

  // change to a 4-d array, b/c we want to include the elevation
  const translationMatrix4d = to4D(translationMatrix);
  const projectionMatrix4d = to4D(projectionMatrix);

  u.EV_numWalls = this.los.shadows.length;
  u.EV_pointRadius = .1;

  const wallCoords = [];
  for ( let i = 0; i < u.EV_numWalls; i += 1 ) {
    const s = this.los.shadows[i];
    const e = s.wall.topZ;

    const a = multMatrixVector(projectionMatrix4d, multMatrixVector(translationMatrix4d, [s.wall.A.x, s.wall.A.y, e, 1]));
    const b = multMatrixVector(projectionMatrix4d, multMatrixVector(translationMatrix4d, [s.wall.B.x, s.wall.B.y, e, 1]));

    wallCoords.push(...a, ...b);
  }

  u.EV_wallCoords = new Float32Array(wallCoords);
}




/*
 this.fragmentShader = this.fragmentShader.replace(
            "uniform sampler2D uBkgSampler;",
            "uniform sampler2D uBkgSampler;\nuniform sampler2D mymodule_maskTexture;"
        );
        this.fragmentShader = this.fragmentShader.replace(
             "float depth = smoothstep(0.0, 1.0, vDepth);",
             "float depth = smoothstep(0.0, 1.0, vDepth);\ndepth *= texture2D(mymodule_maskTexture, vSamplerUvs).r;"
        );
*/

// export function _createLOSLightSource(wrapped) {
//   log("_createLOSLightSource");
//   const los = wrapped();
//   if ( !los.shadows || !los.shadows.length ) return los;
//
//   log("Adding shadow filter");
//   this.createReverseShadowMaskFilter()
//   this.illumination.filters = [this.reverseShadowMaskFilter];
//   this.coloration.filters = [this.reverseShadowMaskFilter];
//
//   return los;
// }


export function drawLightLightSource(wrapped) {
  log("drawLightLightSource");
  if ( this.los.shadows && this.los.shadows.length ) {
    log("drawLightLightSource has shadows");
//     this.illumination.filters = [this.createReverseShadowMaskFilter()];
  }

  if ( this.los._drawShadows ) this.los._drawShadows();
  return wrapped();
}
//
// export function createReverseShadowMaskFilter() {
// //   if ( !this.reverseShadowMaskFilter ) {
//     this.shadowsRenderTexture =
//        canvas.primary.createRenderTexture({renderFunction: this.renderShadows.bind(this), clearColor: [0, 0, 0, 0]});
//     this.reverseShadowMaskFilter = ReverseMaskFilter.create({
//       uMaskSampler: this.shadowsRenderTexture,
//       channel: "a"
//     });
//     this.reverseShadowMaskFilter.blendMode = PIXI.BLEND_MODES.NORMAL;
// //   }
//   return this.reverseShadowMaskFilter;
// }
//
// export function renderShadows(renderer) {
//   const cir = new PIXI.Circle(0, 0, 50);
//   const graphics = new PIXI.Graphics();
//   const rt = renderer.renderTexture;
//   graphics.beginFill(0, 1); // color, alpha
//   graphics.drawCircle(cir);
//   graphics.endFill;
//   renderer.render(graphics, rt);
//   return rt;
// }

// Simple version
// export function _createLOSLightSource(wrapped) {
//   const los = wrapped();
//   this.createReverseMaskFilter();
//   this.illumination.filters = [this.reverseMaskFilter];
//   this.coloration.filters = [this.reverseMaskFilter];
//   return los;
// }
//
// // Added to LightSource.prototype
// export function createReverseMaskFilter() {
//   const rt = canvas.primary.createRenderTexture({renderFunction: renderInnerCircle.bind(this), clearColor: [0, 0, 0, 0]});
//   this.reverseMaskFilter = ReverseMaskFilter.create({
//     uMaskSampler: rt,
//     channel: "a"
//   });
//   this.reverseMaskFilter.blendMode = PIXI.BLEND_MODES.NORMAL;
//   return this.reverseMaskFilter;
// }
//
// function renderInnerCircle(renderer) {
//   const cir = new PIXI.Circle(0, 0, 50);
//   const graphics = new PIXI.Graphics();
//   const rt = renderer.renderTexture;
//   graphics.beginFill(0, 1); // color, alpha
//   graphics.drawCircle(cir);
//   graphics.endFill;
//   renderer.render(graphics, rt);
//   return rt;
// }




// export function renderShadows(renderer) {
//   if ( !this.los.shadows || !this.los.shadows.length ) return;
//
//   const graphics = new PIXI.Graphics();
//   const rt = renderer.renderTexture;
//
//   for ( const shadow of this.los.shadows) {
//     graphics.beginFill(0, 1); // color, alpha
//     graphics.drawPolygon(shadow);
//     graphics.endFill;
//   }
//   renderer.render(graphics, rt);
//   return rt;
// }




//   #createReverseMaskFilter() {
//     if ( !this.reverseMaskfilter ) {
//       this.reverseMaskfilter = ReverseMaskFilter.create({
//         uMaskSampler: canvas.primary.tokensRenderTexture,
//         channel: "a"
//       });
//       this.reverseMaskfilter.blendMode = PIXI.BLEND_MODES.NORMAL;
//     }
//     return this.reverseMaskfilter;
//   }
//
//
//    this.tokensRenderTexture =
//       this.createRenderTexture({renderFunction: this._renderTokens.bind(this), clearColor: [0, 0, 0, 0]});
//
//
//
//
//
//   createRenderTexture({renderFunction, clearColor}={}) {
//     const renderOptions = {};
//     const renderer = canvas.app?.renderer;
//
//     // Creating the render texture
//     const renderTexture = PIXI.RenderTexture.create({
//       width: renderer?.screen.width ?? window.innerWidth,
//       height: renderer?.screen.height ?? window.innerHeight,
//       resolution: renderer.resolution ?? PIXI.settings.RESOLUTION
//     });
//     renderOptions.renderFunction = renderFunction;            // Binding the render function
//     renderOptions.clearColor = clearColor;                    // Saving the optional clear color
//     this.#renderPaths.set(renderTexture, renderOptions);      // Push into the render paths
//
//     // Return a reference to the render texture
//     return renderTexture;
//   }
//
//   _renderTokens(renderer) {
//     for ( const tokenMesh of this.tokens ) {
//       tokenMesh.render(renderer);
//     }
//


// Class PointSource:
/**
 * Create a new Mesh for this source using a provided shader class
 * @param {Function} shaderCls  The subclass of AdaptiveLightingShader being used for this Mesh
 * @returns {PIXI.Mesh}         The created Mesh
 * @protected
 */
//   _createMesh(shaderCls) {
//     const state = new PIXI.State();
//     const mesh = new PIXI.Mesh(this.constructor.GEOMETRY, shaderCls.create(), state);
//     mesh.mask = this.losMask;
//     Object.defineProperty(mesh, "uniforms", {get: () => mesh.shader.uniforms});
//     return mesh;
//   }

/**
 * Update the position and size of the mesh each time it is drawn.
 * @param {PIXI.Mesh} mesh      The Mesh being updated
 * @returns {PIXI.Mesh}         The updated Mesh
 * @protected
 */
// _updateMesh(mesh) {
//   mesh.position.set(this.data.x, this.data.y);
//   mesh.width = mesh.height = this.radius * 2;
//   return mesh




