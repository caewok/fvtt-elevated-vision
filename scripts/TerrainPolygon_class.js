import { COLORS, TINTS, toGridDistance, orient2drounded, FirstMapValue, SecondMapValue, almostEqual } from "./utility.js";
import { Shadow } from "./Shadow_class.js";
import { log, MODULE_ID, FORCE_SEGMENT_TYPE_DEBUG } from "./module.js";
import { Segment, Vertex } from "./SegmentVertex_class.js";
 

// Two types of polygons:
// 1. TerrainData: t.data, containing t.data.x, t.data.y, t.data.points, t.data.max (elevation)
// 2. fov/los: SourcePolygon, with x, y, radius, points
// TerrainData: 
//   - relative points to x, y
//   - points are [[x0, y0], [x1, y1], ...]
// SourcePolygon:
//   - uses absolute points; 
//   - the x,y are just for identifying the center point.
//   - points are like PIXI.Polygon: [x0, y0, x1, y1, ...]

/*
 * Polygon with methods to assist with measuring terrain elevation.
 * @param {Array} points          Array of points [x0, y0, x1, y1, ...]
 */
export class TerrainPolygon extends PIXI.Polygon {
  constructor(...points) {
    super(...points); 
  }
  
 /*
  * Construct the map of segments for the polygon.
  * @type {Map}
  */
  get segments() {
    if(this._segments === undefined || this._segments.size === 0) {
      this._segments = this._constructSegments();
      }
    return this._segments; 
  }
  
 /*
  * Construct the map of vertices for the polygon.
  * @type {Map}
  */
  get vertices() {
    if(this._vertices === undefined || this._vertices.size === 0) {
      this._segments = undefined;
      this._vertices = this._constructVertices();
    }
    return this._vertices;
  }
  
 /*
  * Internal function to construct the map of vertices for the polygon
  * Each vertex links to two segments, using the internal Segment and Vertex linking.
  * @return {Map}
  */
  _constructVertices() {
    const poly_vertices = new Map();  
    let prior_vertex = new Vertex(this.points[0], this.points[1]);
    let new_vertex;
    prior_vertex.originating_object = this;
    poly_vertices.set(prior_vertex.id, prior_vertex);
    
    //log(`_constructVertices 0:`, prior_vertex, new_vertex);
    
    // save the first id to link at the end
    const l = this.points.length;
    if(this.points[0] !== this.points[l - 2] ||
       this.points[1] !== this.points[l - 1]) {
       console.error(`${MODULE_ID}|_constructVertices expects a closed set of points.`, this);
       }
    
    const first_vertex_id = prior_vertex.id;

    // TO-DO: assuming closed stroke for now.
    for (let i = 2; i < (this.points.length - 2); i += 2) {
      new_vertex = prior_vertex.connectPoint(this.points[i], this.points[i + 1]);
      //log(`_constructVertices ${i} new_vertex`, new_vertex);
      
      poly_vertices.set(new_vertex.id, new_vertex);
      prior_vertex = new_vertex;
      //log(`_constructVertices ${i} end:`, prior_vertex, new_vertex)
    }
    
    //log(`_constructVertices ended loop`);
    
    // link to beginning
    const last_vertex_id = new_vertex.id;
    
    const s_last_first = Segment.fromVertices(poly_vertices.get(last_vertex_id),
                                              poly_vertices.get(first_vertex_id),);
                                                                         
    poly_vertices.get(last_vertex_id).includeSegment(s_last_first)
    
    // to ensure segments are A, B for the vertex, as in prior(A) --> vertex --> next (B)
    // need to insert this s_first_last as A in the first vertex
    const s_first_second =  FirstMapValue(poly_vertices.get(first_vertex_id).segments);
    poly_vertices.get(first_vertex_id).segments.clear();
    poly_vertices.get(first_vertex_id).includeSegment(s_last_first);
    poly_vertices.get(first_vertex_id).includeSegment(s_first_second);
    
    //log(`_constructVertices return`, poly_vertices);

    return poly_vertices;
  }
  
//   points: [100, 100, 0
//            100, 200, 2
//            200, 200, 4
//            200, 100, 6
//            100, 100] 8
//   
//   // i == 0
//   prior_vertex = Vertex(100, 100); 
//   - x: 100
//   - y: 100
//   - segments: Map()
//   
//   // i == 2
//   new_vertex = prior_vertex.connectPoint({x: 100, y: 200})
//   prior_vertex:
//   - segments: 0 -> 2
//     - vertexA: prior_vertex (100, 100)
//     - vertexB: new_vertex (100, 200)
//   new_vertex:
//   - segments: 0 -> 2
//     - vertexA: prior_vertex (100, 100)
//     - vertexB: new_vertex (100, 200)
//     
  
  
  
  
  
 /*
  * Internal function to build the Map of polygon segments.
  * Each segment shares two vertices with two other segments, linked here
  *   using the internal Segment and Vertex linking.
  * @return {Map}
  */
  _constructSegments() {
    const poly_segments = new Map();

    for(const [key, vertex] of this.vertices) {
      // only add the second segment, so that first<-->last segment is last
      const s_second = SecondMapValue(vertex.segments);

      // Default every segment: 
      //   - "far" until calculateNearFarSegments is run
      //   - "ignore" for vision type (block, shadow, ignore)
      s_second.mergeProperty({ vision_distance: "far", 
                               vision_type: "ignore" });      
      poly_segments.set(s_second.id, s_second);
    }
    return poly_segments;
  }
  
 /*
  * Elevation for the polygon. Default: 0.
  * @type {Number}
  */
  get elevation() { 
    if(this._elevation === undefined) this._elevation = 0;
    return this._elevation;
  }
  
 /*
  * Set elevation for the polygon and underlying segments.
  * May cause deletion of certain cached calculations.
  * @param {Number} value   Elevation, in game units (e.g., 5 foot grid, 40 foot of elevation)
  */
  set elevation(value) {
    value = toGridDistance(value);
    if(this._elevation != value) {
      // delete cached calculations
    }
    this._elevation = value;
    
    // set property for each segment
    for(const [key, segment] of this.segments) {
      segment.mergeProperty({ elevation: value });
    }
  }
  
  /**
   * A factory method to construct an TerrainPolygon from an object.
   * Object can be:
   * - inherit from PIXI.Polygon.
   * - inherit from TerrainData
   * - default: any object with points
   * @param {Object} obj          Object to use to construct the TerrainPolygon.
   * @return {TerrainPolygon}    The constructed TerrainPolygon.
   */
  static fromObject(obj) {
    // TerrainData does not appear to be exported to this scope
    // simplest answer is to just check the constructor name
    // will not work for inheritance, but should give what we need here.
    //if(obj instanceof TerrainData) {
    if(obj.closeStroke) {
      const l = obj.points.length;

      if(!almostEqual(obj.points[0], obj.points[l - 2]) ||
         !almostEqual(obj.points[1], obj.points[l - 1])) {

         obj.points.push(obj.points[0]);
         obj.points.push(obj.points[1]);
      }
    }

    if(obj.constructor.name === "TerrainData") {
      // transform the points based on x,y
      const transformed_points = [];
      obj.points.forEach(p => {
        transformed_points.push(p[0] + obj.x);
        transformed_points.push(p[1] + obj.y);
      });
      
      const e = obj.max || 0;
      
      // do we need obj.width and obj.height?   
      let poly = new this(transformed_points);
      poly.elevation = e;
      poly.originating_id = obj._id;
      return poly;
      
    } else {
      return new this(obj.points);
    }
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
    const segments_arr = [...this.segments];

    for(let i = 0; i < this.segments_arr; i++) {
      const segment = this.segments_arr[i][1];
      const intersection = ray.intersectSegment([segment.A.x, segment.A.y,
                             segment.B.x, segment.B.y]);
      if(intersection) return intersection;
    }   
    return false;
  }

  /**
   * Test if another polygon intersects or is contained in another.
   * @param {TerrainPolygon} poly    An TerrainPolygon to test.
   * @param {boolean} contained_only  If true, will test only for fully contained.
   * @return {boolean} true if intersects or is contained in
   */
  intersectsPolygon(poly, contained_only = false) {
    const segments_arr = [...this.segments];
    for(let i = 0; i < segments_arr.length; i++) {
      const segment = segments_arr[i][1];
      if(contained_only) {
        if(!poly.rayInside(segment)) return false;
      } else {
        if(poly.rayInside(segment)) return true;
        if(poly.intersectsRay(segment)) return true;
      } 
    }
    return contained_only; // if contained_only, is true; if includes intersection, false.
  }
  
 /*
  * Calculate near vs far segments based on vision origin.
  * @param {PIXI.Point} vision_point    Near or far based on this relative point in {x,y} format 
  */
  calculateNearFarSegments(vision_point) {
    const radial_sweep = new RadialSweep(vision_point, 
                                         undefined, // slightly faster than Number.NEGATIVE_INFINITY
                                         { vision_distance: "near" });
    
    // all segments are "far" until proven otherwise
    // Note: already set by _constructSegments as default
    const sorted_vertices = RadialSweep.sortVertices(vision_point, [...this.vertices]);
    sorted_vertices.forEach(vertex => {
      radial_sweep.nextVertex(vertex);
    });
    radial_sweep.complete();
  } 
 
 /*
  * Draw the polygon
  * This version draws individual segments, allowing for color choices for 
  *   different segments or segment splits.
  */
  draw(color = COLORS.black) {
    for(const [key, segment] of this.segments) {    
      const splits = segment.getSplits();
      splits.forEach(s => {
        const seg_color = (s.properties.vision_type === "block") ? COLORS.red : color;
        s.draw(seg_color);
      });      
    }
  }

  /*
   * Draw the polygon on the canvas
   * @param {Hex} color    Color to use (default: black)
   */
   drawPolygon(color = COLORS.black) {
     canvas.controls.debug.lineStyle(1, color).drawShape(this);
   }
 
}
