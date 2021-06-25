import { COLORS, TINTS, toGridDistance, orient2drounded } from "./utility.js";
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
      // clear the vertices just in case
      this._vertices = undefined;
      this._segments = this._constructSegments();
      }
    return this._segments; 
  }
  
 /*
  * Construct the map of vertices for the polygon.
  * @type {Map}
  */
  get vertices() {
    if(this._vertices === undefined || this._vertices.size === 0) this._vertices = this._constructVertices();
    return this._vertices;
  }
  
 /*
  * Internal function to build the Map of polygon segments.
  * Each segment shares two vertices with two other segments, linked here
  *   using the internal Segment and Vertex linking.
  * @return {Map}
  */
  _constructSegments() {
    const poly_segments = new Map();
    let previous_segment_id;
    for(let i = 0; i < (this.points.length - 2); i += 2) {
      const poly_segment = new Segment({ x: this.points[i],
                                         y: this.points[i + 1] },
                                       { x: this.points[i + 2],
                                         y: this.points[i + 3] });
      poly_segment.originating_object = this;    
      
      // link the vertices between segments
      if(i > 0) {
        poly_segment.vertexA = poly_segments.get(previous_segment_id).vertexB;
      }
                                      
      poly_segments.set(poly_segment.id, poly_segment);
      previous_segment_id = poly_segment.id;
    }
    return poly_segments;
  }
  
  
 /*
  * Internal function to construct the map of vertices for the polygon
  * Each vertex links to two segments, using the internal Segment and Vertex linking.
  * Here, segments are (arbitrarily) constructed first, then vertices are retrieved.
  * @return {Map}
  */
  _constructVertices() {
    const poly_vertices = new Map();    
    for(const [key, segment] of this.segments) { // will build the segments if necessary
      // need only the A vertex, b/c A & B are shared between segments
      poly_vertices.add(segment.vertexA.id, segment.vertexA);
    }
    return poly_vertices;
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
    for(const [key, segment] this.segments) {
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
