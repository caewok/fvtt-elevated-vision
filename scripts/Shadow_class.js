import { COLORS } from "./utility.js";
import { log } from "./module.js";
import { Vertex } from "./Vertex_class.js";

/**
 * An extension of the base PIXI.Polygon representing shadow cast by a wall with defined height.
 * @param {Point} V Vision origin point
 * @param {Segment} segment Wall segment that is blocking vision
 * @param {Number} distance Distance out to run the non-parallel sides of the trapezoid.
 *   (technically, if given only distance, the shape returned may not be a trapezoid)
 * @param {Number} distanceB For cases where V is not centered and so  
 *    the non-parallel sides have different lengths. 
 */
export class Shadow extends PIXI.Polygon {
  constructor(vision_point, ...points) {
    super(...points);
    this.vision_point = vision_point;
    this.elevation = 0;
  }

  static buildShadowTrapezoid(vision_point, wall_segment, distanceA, distanceB = distanceA) {
    log(`distA ${distanceA}, distB ${distanceB} for vision, wall`, vision_point, wall_segment);

    // one end of the segment
    const ray_VA = new Ray(vision_point, wall_segment.A);        
    const ray_A_edge = Ray.fromAngle(wall_segment.A.x, wall_segment.A.y, ray_VA.angle, distanceA);
    log(`ray_VA`, ray_VA, ray_A_edge);

    // other end of the segment
    const ray_VB = new Ray(vision_point, wall_segment.B);
    const ray_B_edge = Ray.fromAngle(wall_segment.B.x, wall_segment.B.y, ray_VB.angle, distanceB);
    log(`ray_VB`, ray_VB, ray_B_edge);

    //const points = [...ray_A_edge.A, ...ray_A_edge.B, ...ray_B_edge.B, ...ray_B_edge.A, ...ray_A_edge.A];
    const points = [ray_A_edge.A.x, ray_A_edge.A.y, ray_A_edge.B.x, ray_A_edge.B.y, ray_B_edge.B.x, ray_B_edge.B.y, ray_B_edge.A.x, ray_B_edge.A.y, ray_A_edge.A.x, ray_A_edge.A.y];
    log(`buildShadowTrapezoid for vision point`, vision_point, points);

    const new_obj = new Shadow(vision_point, ...points);    
    log(`new_obj:`, new_obj);
    return new_obj;
  }
  
 /**
  * Calculate distance from vision point for which an elevated wall blocks vision.
  * @param {Point} T Terrain wall end point
  * @param {Number} Ve Vision elevation
  * @param {Number} Te Terrain wall elevation
  * @param {Number} Oe Elevation of the space beyond the terrain wall
  * @param {Point} V Vision origin point
  * @param {Number} Ve Vision elevation
  * @param {Number} Te Terrain wall elevation
  * @return {Number} distance from V to O at which O would first be seen, assuming 
  *   O lies on the line extended from V to T.
  */
// TO-DO: Use this formula in sightLayer to test tokens.
// Can first calculate the intersection with the wall, and then pass 
// the intersection point as T.
  static calculateShadowDistance(T, Oe, V, Ve, Te) {        
    // if any elevation is negative, normalize so that the lowest elevation is 0
    const min_elevation = Math.min(Ve, Oe, Te);
    if(min_elevation < 0) {
      const adder = abs(min_elevation);
      Ve = Ve + adder;
      Oe = Oe + adder;
      Te = Te + adder;
    }

    // If the vision elevation is less than or equal to the terrain, 
    //   the wall blocks infinitely unless the object is higher than the wall
    if(Ve <= Te && Oe <= Te) return Number.POSITIVE_INFINITY;

    const ray_VT = new Ray(V, T);

    // theta is the angle between the 3-D sight line and the sight line in 2-D
    const theta = Math.atan((Ve - Te) / ray_VT.distance); // theta is in radians

    // distance at which O would be seen
    // assuming O lies on the line extended from V to T
    const TO_needed = (Te - Oe) / Math.tan(theta); // tan needs radians

    return TO_needed;
 }    
  
  /**
   * Test if ray is totally inside polygon
   * @param {Ray} Segment ray to check
   * @return {boolean} true if ray is totally inside polygon
   */
  rayInside(ray) {
    return (this.contains(ray.A.x, ray.A.y) && this.contains(ray.B.x, ray.B.y));
  }
  
  /**
   * Test if ray intersects polygon
   * @param {Ray} Segment ray to check
   * @return {Obj} false if ray intersects the polygon; intersection if found
   */
   // TO-DO: Shortcuts? Sort by closest in some fashion?
  intersectsRay(ray) {
    for(let i = 0; i < this.segments; i++) {
      const segment = this.segments[i];
      const intersection = ray.intersectSegment([segment.A.x, segment.A.y,
                             segment.B.x, segment.B.y]);
      if(intersection) return intersection;
    }   
    return false;
  }
  
 /**
  * The segments of the polygon as an array of Rays.
  * Computed lazily as required.
  * @type {Array}
  */
  get segments() {
    if(this._segments === undefined) this._segments = this._constructSegments();
    return this._segments; 
  }

  _constructSegments() {
    const poly_segments = [];
    for(let i = 0; i < (this.points.length - 2); i += 2) {
      const poly_segment = new Ray({ x: this.points[i],
                                     y: this.points[i + 1] },
                                   { x: this.points[i + 2],
                                     y: this.points[i + 3] });
      poly_segments.push(poly_segment);
    }
    return poly_segments;
  }
  
 /*
  * Draw the polygon on the canvas
  * @param {Hex} color    Color to use (default: gray)
  */
  draw(color = COLORS.gray, alpha = .5) {
    // no lineStyle(1, color)
    canvas.controls.debug.beginFill(color, alpha).drawShape(this).endFill();
  }
}
