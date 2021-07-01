import { COLORS, TINTS, toGridDistance, orient2drounded, FirstMapValue, SecondMapValue, almostEqual } from "./utility.js";
import { Shadow } from "./Shadow_class.js";
import { log, MODULE_ID, FORCE_SEGMENT_TYPE_DEBUG } from "./module.js";
import { Vertex } from "./Vertex_class.js";
import { ShadowSegment } from "./ShadowSegment_class.js";
import { RadialSweep } from "./RadialSweep_class.js"; 

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
    value = value;
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
      poly.elevation = toGridDistance(e);
      poly.originating_id = obj._id;
      return poly;
      
    } else {
      return new this(obj.points);
    }
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
    const sorted_vertices = RadialSweep.sortVertices(vision_point, [...this.vertices.values()]);
    log(`calculateNearFarSegments ${sorted_vertices.length} sorted vertices`, sorted_vertices, vision_point);
    radial_sweep.start(this.segments);
    sorted_vertices.forEach(vertex => {
      radial_sweep.nextVertex(vertex);
    });
    radial_sweep.complete();
    
    // if the vision point is within the polygon, then near points might be considered 
    //   "far" for purposes of shadow. (Stand on a plateau and look out; 
    //   shadows below cliff)
    // "far" are probably "ignore" b/c those are not line of sight
    if(this.contains(vision_point.x, vision_point.y)) {
      log(`calculateNearFarSegments within vision point ${vision_point.x}, ${vision_point.y}`);
      for(const [key, segment] of this.segments) {    
        const splits = segment.getSplits();
        splits.forEach(split => {
          //log(`split properties`, split.properties);
          if(split.properties.vision_distance === "far") {
            split.properties.vision_distance = "ignore"
          } else if(split.properties.vision_distance === "near") {
            split.properties.vision_distance = "far"
          }
        });      
      }    
    }
    
  } 
 
 /*
  * Draw the polygon
  * This version draws individual segments, allowing for color choices for 
  *   different segments or segment splits.
  * Segment blocks vision: red
  * Segment is far from vision point, suggesting it will make a shadow: gray
  * Segment is near: orange
  */
  draw(color = COLORS.black) {
    for(const [key, segment] of this.segments) {    
      const splits = segment.getSplits();
      splits.forEach(s => {
        const seg_color = (s.properties.vision_type === "block") ? COLORS.red : 
                          (s.properties.vision_distance === "near") ? COLORS.orange : 
                          COLORS.gray;
        s.draw(seg_color);
      });      
    }
  }
   
  /*
   * Draw shadows for all segments
   * @param {PIXI.Point} origin_point   {x,y} location of vision point
   * @param {Number} origin_elevation   Elevation of vision point in game units
   */
   drawShadows(origin_point, origin_elevation) {
     log(`Drawing shadows for origin at elevation ${origin_elevation}`, origin_point);
     for(const [key, segment] of this.segments) { 
       const splits = segment.getSplits();
       splits.forEach(s => {
         s.setOrigin(origin_point, origin_elevation);
         s.elevation = this.elevation;
         s.has_shadow = s.properties.vision_type === "block" || s.properties.vision_distance === "far";
         s.drawShadows();
       });
     }
   }
 
}
