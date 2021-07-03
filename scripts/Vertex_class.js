// Need to track vertices along segments.
// the polygon has points ordered as one would draw them, in an array [x0, y0, x1, y1,...]
// Segments can be easily constructed for each set [x0, y0, x1, y1], [x1, y1, x2, y2], ...
// Need to:
// - sort vertices clockwise around a vision point
// - track which segments are associated with each vertex
// Solution here uses two linked classes:
// class Segment
//   -- links to VertexA and VertexB
//   -- permits "splitting" a segment into multiple parts 
// class Vertex
//   -- links to one or more Segments (typically two, for a polygon, or one, for a wall segment)

import { almostEqual, round, orient2drounded, COLORS } from "./utility.js";
import { MODULE_ID, log } from "./module.js";
import { Segment } from "./Segment_class.js";
import { ShadowSegment } from "./ShadowSegment_class.js";

/*
 * Class to represent a vertex 
 * - all tracking of what segments contain it as an endpoitn
 * - equality test using almost equal
 * - unique id for vertex
 * @param {Number} x  position of the point on the x axis
 * @param {Number} y  position of the point on the y axis
 * @return {Vertex}
 */
export class Vertex extends PIXI.Point {
  constructor(x, y) {
    super(x, y);
    this.segments = new Map;
    this.originating_object = undefined; // typically used to set the id of the object 
                                         // to which this vertex belongs
  }
  
 /*
  * Factory function to construct Vertex from point {x, y}
  * @param {PIXI.Point} p   Point in {x, y} format
  * @return Vertex
  */
  static fromPoint(p) {
    return new Vertex(p.x, p.y);
  }
  
  /* 
   * Link this vertex to another vertex by constructing a segment
   * @param {Number} x  position of the point on the x axis
   * @param {Number} y  position of the point on the y axis
   * @return The new Vertex
   */
   connectPoint(x, y, segment_class = "Segment") {
     const v = new Vertex(x, y);
     v.originating_object = this.originating_object;
     
     return this.connectVertex(v, segment_class);
   }
   
  /*
   * Link this vertex to another vertex by constructing a segment
   * @param {Vertex} v    Vertex to link or point in {x, y} format
   * @return the linked vertex
   */
   connectVertex(v, segment_class = "Segment") {
     const SEGMENT_CLASSES = {
       Segment,
       ShadowSegment
     }

     if(!(v instanceof Vertex)) {
       v = new Vertex(v.x, v.y);
       v.originating_object = this.originating_object;
     }
     const s = new SEGMENT_CLASSES[segment_class](this, v);
     s.originating_object = this.originating_object;
     
     s.vertexA = this;
     s.vertexB = v;
     
     this.includeSegment(s);
     v.includeSegment(s);
     
     return v;
   }
   
 
  /*
   * Get the id for this Vertex.
   * @type {String}
   */
   get id() {
     if(!this._id) this._id = foundry.utils.randomID();
     return this._id;
   }

  /*
   * Set the id for this Vertex.
   * @type {String}
   */
   set id(value) {
     this._id = value;
   }
 
  /*
   * Almost equal version that treats points as equal if within epsilon error
   * @param {PIXI.Point} p  Point in {x, y} format.
   * @return {boolean} true if the two points are with epsilon from one another.
   */
  equals(p, EPSILON = 1e-5) {
    return (almostEqual(this.x, p.x, EPSILON) && almostEqual(this.y, p.y, EPSILON));
  }
  
  /*
   * Factory function to construct segment points from a segment
   * @param {Ray} segment         Ray representing a segment with points A and B.
   * @return {s1: SegmentPoint, s2: SegmentPoint} Object containing the two segment 
   *   points for Ray.A and Ray.B, respectively.
   */ 
   static constructVertexFromSegment(segment) {
     const s1 = new Vertex(segment.A.x, segment.A.y);
     const s2 = new Vertex(segment.B.x, segment.B.y);
     
     // can set directly b/c we know the segment has these endpoints
     s1.segments.set(segment.id || foundry.utils.randomID(), segment);
     s2.segments.set(segment.id || foundry.utils.randomID(), segment);
   
     return { A: s1,
              B: s2 };
   }
     
  /*
   * Test if segment should be included in the index set
   * @param {Ray} segment   Segment to test
   * @param {Number} idx    Index of the segment
   * return {boolean} true if the segment was included
   */
   includeSegment(segment) {
     if(this.equals(segment.A) || this.equals(segment.B)) {
       this.segments.set(segment.id || foundry.utils.randomID(), segment);
       return true;
     }
     return false;
   }
   
  /*
   * Get squared distance from this point to another point.
   * Squared for comparison purposes, avoiding the sqrt
   * @param {PIXI.Point} p    Point to measure
   * @return {Number}  Squared distance.
   */
   squaredDistance(p) {
     if(this.equals(p)) return 0;
     
     // perf test; not much difference here. See https://stackoverflow.com/questions/26593302/whats-the-fastest-way-to-square-a-number-in-javascript/53663890 
     return round(Math.pow(p.x - this.x, 2) + Math.pow(p.y - this.y, 2), 8);
   }
   
  /*
   * Draw a point representation of the vertex.
   * @param {Hex} color   Color of the filled circle
   * @param {Number} radius   Radius of the circle
   */
   draw(color = COLORS.black, radius = 10) {
     canvas.controls.debug.beginFill(color).drawCircle(this.x, this.y, radius).endFill();
   }
}
