import { log } from "./module.js";

export evComputePolygon(wrapped, ...args) {
  const res = wrapped(...args)
  log("evComputePolygon", ...args, res);
}

export evTestWall(wrapped, ...args) {
  const res = wrapped(...args)
  log("evTestWall", ...args, res);  
}

 /**
   * Test a single Ray against a single Wall
   * @param {Ray} ray                 The Ray being tested
   * @param {Wall} wall               The Wall against which to test
   * @return {RayIntersection|null}   A RayIntersection if a collision occurred, or null
   */