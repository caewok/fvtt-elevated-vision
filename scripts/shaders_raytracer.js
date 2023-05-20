/** globals

*/
"use strict";

export shadowTraceWallsGLSL = {};

/**
 * Render a simple quad representing the viewable area from light's point of view.
 */
shadowTraceWallsGLSL.vertexShader =
`
`;

/**
 * Trace ray from light to fragment to identify occluding walls.
 * Penumbra calculation for shadow portions near shadow edges.
 * TODO: use #define and #ifdef to make penumbra calc optional.
 */
shadowTraceWallsGLSL.fragmentShader =
`
`;