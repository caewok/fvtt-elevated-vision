/* globals
CONFIG,
canvas,
PIXI
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
    opts.elevation ??= opts.tokenElevation ?? token.elevationE;
    super(location, opts);
    this.token = token;
  }
}
