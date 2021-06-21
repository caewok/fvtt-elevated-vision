import { COLORS } from "./utility.js";

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
    // one end of the segment
    const ray_VA = new Ray(vision_point, wall_segment.A);        
    const ray_A_edge = Ray.fromAngle(wall_segment.A.x, wall_segment.A.y, ray_VA.angle, distanceA);

    // other end of the segment
    const ray_VB = new Ray(vision_point, wall_segment.B);
    const ray_B_edge = Ray.fromAngle(wall_segment.B.x, wall_segment.B.y, ray_VB.angle, distanceB);
    
    const points = [ray_A_edge.A.x, ray_A_edge.A.y,
                    ray_A_edge.B.x, ray_A_edge.B.y,
                    ray_B_edge.B.x, ray_B_edge.B.y,
                    ray_B_edge.A.x, ray_B_edge.A.y,
                    ray_A_edge.A.x, ray_A_edge.A.y];
    
    return new this.constructor(vision_point, points);
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
    for(let i = 0; i < this.points.length; i += 4) {
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
     canvas.controls.debug.lineStyle(1, color).beginFill(color, alpha).drawShape(this).endFill();
    }
}
