/* globals
CONFIG,
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { CoordinateElevationCalculator } from "./CoordinateElevationCalculator.js";

export class TokenPointElevationCalculator extends CoordinateElevationCalculator {
  /** @type {Token} */
  #token;

  /**
   * Uses a token instead of a point. Options permit the token location and elevation to be changed.
   * @param {Token} token
   * @param {object} [opts]
   * @param {Point} [opts.tokenCenter]
   * @param {number} [opts.tokenElevation]
   */
  constructor(token, opts = {}) {
    const location = opts.tokenCenter ?? token.center;
    opts.elevation ??= opts.tokenElevation ?? token.bottomE;

    // Set tileStep and terrainStep to token height if not otherwise defined.
    // (Do this here b/c _configure method does not yet have the token set.)
    const tokenHeight = token.topE - token.bottomE;
    opts.tileStep ??= CONFIG[MODULE_ID]?.tileStep ?? (tokenHeight || 1);
    opts.terrainStep ??= CONFIG[MODULE_ID]?.terrainStep ?? (tokenHeight || canvas.elevation.elevationStep);

    super(location, opts);
    this.#token = token;
  }

  /** @type {Token} */
  get token() { return this.#token; }
}
