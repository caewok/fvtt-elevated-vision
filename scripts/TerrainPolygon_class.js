import { COLORS, TINTS, toGridDistance, orient2drounded, FirstMapValue, SecondMapValue } from "./utility.js";
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
    
    log(`_constructVertices 0:`, prior_vertex, new_vertex);
    
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
      log(`_constructVertices ${i} new_vertex`, new_vertex);
      
      poly_vertices.set(new_vertex.id, new_vertex);
      prior_vertex = new_vertex;
      log(`_constructVertices ${i} end:`, prior_vertex, new_vertex)
    }
    
    log(`_constructVertices ended loop`);
    
    // link to beginning
    const last_vertex_id = new_vertex.id;
    
    const s_first_last = Segment.fromVertices(poly_vertices.get(first_vertex_id),
                                            poly_vertices.get(last_vertex_id));
                                                                         
    poly_vertices.get(last_vertex_id).includeSegment(s_first_last)
    
    // to ensure segments are A, B for the vertex, as in prior(A) --> vertex --> next (B)
    // need to insert this s_first_last as A in the first vertex
    const s_first_second =  FirstMapValue(poly_vertices.get(first_vertex_id).segments);
    poly_vertices.get(first_vertex_id).segments.clear();
    poly_vertices.get(first_vertex_id).includeSegment(s_first_last);
    poly_vertices.get(first_vertex_id).includeSegment(s_first_second);
    
    log(`_constructVertices return`, poly_vertices);

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
    
    [...this.vertices].forEach((v, idx) => {
      // skip every other vertex
      // only add the second segment, so that first<-->last segment is last
      if((idx + 1) % 2 === 0) {
        const s_second = SecondMapValue(v.segments);
        poly_segments.set(s_second.id, s_second);
      }
    });
    
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
 
 /*
  * Draw the polygon
  * This version draws individual segments, allowing for color choices for 
  *   different segments or segment splits.
  */
  draw(color = COLORS.black) {
    for(const [key, segment] of this.segments) {
      segment.draw(color);
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
