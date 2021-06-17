import { log } from "./module.js";

/* -------------------------------------------- */
  /*  Source Polygon Computation                  */
  /* -------------------------------------------- */

  /**
   * Compute source polygons of a requested type for a given origin position and maximum radius.
   * This method returns two polygons, one which is unrestricted by the provided radius, and one that is constrained
   * by the maximum radius.
   *
   * @param {Point} origin            An point with coordinates x and y representing the origin of the test
   * @param {number} radius           A distance in canvas pixels which reflects the visible range
   * @param {object} [options={}]     Additional options which modify the sight computation
   * @param {string} [options.type=sight]     The type of polygon being computed: "movement", "sight", or "sound"
   * @param {number} [options.angle=360]      An optional limited angle of emission with which to restrict polygons
   * @param {number} [options.density=6]      The desired radial density of emission for rays, in degrees
   * @param {number} [options.rotation=0]     The current angle of rotation, used when the angle is limited
   * @param {boolean} [options.unrestricted=false]  Compute sight that is fully unrestricted by walls
   *
   * @returns {{rays: Ray[], los: PIXI.Polygon, fov: PIXI.Polygon}}   The computed rays and polygons
   */
export function evComputePolygon(wrapped, ...args) {
  const res = wrapped(...args)
  log("evComputePolygon", ...args, res);
  return res;
}

 /**
   * Test a single Ray against a single Wall
   * @param {Ray} ray                 The Ray being tested
   * @param {Wall} wall               The Wall against which to test
   * @return {RayIntersection|null}   A RayIntersection if a collision occurred, or null
   */
export function evTestWall(wrapped, ...args) {
  const res = wrapped(...args)
  log("evTestWall", ...args, res);  
  return res;
}

