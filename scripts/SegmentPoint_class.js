// Need to track points along segments.
// the polygon has points ordered as one would draw them, in an array [x0, y0, x1, y1,...]
// Segments can be easily constructed for each set [x0, y0, x1, y1], [x1, y1, x2, y2], ...
// Need to:
// - sort points clockwise around a vision point
// - track which segments are associated with each point
import { almostEqual } from "./utility.js";
import { orient2d } from "./lib/orient2d.js";
import { MODULE_ID, log } from "./module.js";

/*
 * Class to represent a point with certain features.
 * - point tracks what segments contain it as an endpoint
 * - equality test using almost equal
 */
export class SegmentPoint extends PIXI.Point {
  constructor(x, y) {
    super(x, y);
    this.segments = new Map;
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
   * @param {Number} segment_idx  Index for the segment, for tracking.
   * @return {s1: SegmentPoint, s2: SegmentPoint} Object containing the two segment 
   *   points for Ray.A and Ray.B, respectively.
   */ 
   static constructSegmentPoints(segment) {
     const s1 = new SegmentPoint(segment.A.x, segment.A.y);
     const s2 = new SegmentPoint(segment.B.x, segment.B.y);
     
     // can set directly b/c we know the segment has those endpoints
     s1.segments.set(segment.id || foundry.utils.randomID(), segment);
     s2.segments.set(segment.id || foundry.utils.randomID(), segment);
   
     return { A: s1,
              B: s2 };
   }
     
  /*
   * Add one or more indices to the set.
   * @param {Number} ...indices One or more integer indices to add
   */ 
   addIndex(...segment_idx) {
     [...segment_idx].forEach(i => this.segment_indices.add(i));
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
}

/*
 * Class extending Ray to represent a segment on the map, often in a polygon
 * - provides a unique id for the segment
 * - adds almost equal test
 * - measures ccr against a vision point
 * - provides next and previous methods if chaining as in a polygon
 */ 
export class Segment extends Ray {
  constructor(A, B) {
    super(A, B);
    this.id = foundry.utils.randomID();
    this.next = undefined; // typically used to set the next segment in a chain
    this.previous = undefined; // typically used to set the previous segment in a chain
    this.originating_object = undefined; // typically used to set the id of the object 
                                         // to which this segment belongs
    this.properties = {}; // typically used to characterize the segments                                      
  }
  
 /*
  * Test if a segment is equivalent to this one.
  * @param {Ray} segment      Segment to test.
  * @param {Number} EPSILON   Treat equal if within this error
  * @return 0 if not equivalent, -1 if equivalent when reversed, 1 if equivalent  
  */ 
  equivalent(segment, EPSILON = 1e-5) {
    if(almostEqual(this.A.x, segment.A.x, EPSILON) && 
       almostEqual(this.A.y, segment.A.y, EPSILON) &&
       almostEqual(this.B.x, segment.B.x, EPSILON) &&
       almostEqual(this.B.y, segment.B.y, EPSILON)) return 1;
       
    if(almostEqual(this.A.x, segment.B.x, EPSILON) && 
       almostEqual(this.A.y, segment.B.y, EPSILON) &&
       almostEqual(this.B.x, segment.A.x, EPSILON) &&
       almostEqual(this.B.y, segment.A.y, EPSILON)) return -1;
  
    return 0;
  }
  
 /*
  * Determine if (vision point) to segment is counter-clockwise, clockwise, 
  *   or in line when comparing to the segment end point B.
  *   (s.B is left of directed line p --> s.A)
  * @param {PIXI.Point} p   Point to test, in {x, y} format.
  * @return positive value if counterclockwise, 
  *   0 if collinear, negative value if clockwise
  */
  orient2d(p) {
    return orient2d(p.x, p.y, this.A.x, this.A.y, this.B.x, this.B.y);
  }
  
 /*
  * Test if endpoint B is counter-clockwise (left) compared to a (vision) point,
  *   if one drew a line from the point to endpoint A. 
  * @param {PIXI.Point} p   Point to test, in {x, y} format.
  * @return {boolean} true if counter-clockwise
  */
  ccw(p) {
    this.orient2d(p) > 0;
  }
  
 /*
  * Test if a point is a segment endpoint.
  * @param {PIXI.Point} p   Point to test
  * @return {boolean} true if the point is almost equal to an endpoint
  */
  isEndpoint(p, EPSILON = 1e-5) {
    return ((almostEqual(p.x, this.A.x, EPSILON) && 
             almostEqual(p.y, this.A.y, EPSILON)) || 
            (almostEqual(p.x, this.A.x, EPSILON) && 
             almostEqual(p.y, this.A.y, EPSILON))); 
  }
  
 /*
  * Test if point is on the segment.
  * @param {PIXI.Point} p   Point to test
  * @param {boolean} true if segment includes point
  */
  contains(p, EPSILON = 1e-5) {
    // test if collinear
    if(orient2d(this.A.x, this.A.y, p.x, p.y, this.B.x, this.B.y)) return false;
    
    // test if endpoint
    if(this.isEndpoint(p, EPSILON)) return true;
    
    // test if between the endpoints
    // recall that we already established the point is collinear above.
    return (p.x < max(this.A.x, this.B.x) &&
            p.x > min(this.A.x, this.B.x) &&
            p.y < max(this.A.y, this.B.y) &&
            p.y > min(this.A.y, this.B.y));
  }
  
  
 /* 
  * Get a segment split, if any
  */
  get split() {
    return this._split;
  } 
  
 /*
  * Split a segment along a point.
  * store the segment splits
  * @param {PIXI.Point} p   Point to use for the split
  */
  set split(value) {
    if(!contains(value)) {
      console.error(`${MODULE_ID}|Segment class split method: Point is not within the segment.`);
    }
    
    this._split = [new Segment({ x: this.A.x, y: this.A.y }, { x: value.x, y: value.y }),
                   new Segment({ x: value.x, y: value.y }, { x: this.B.x, y: this.B.y })];
                   
    this._split[0].originating_object = this;
    this._split[1].originating_object = this;
    this._split[0].properties = this.properties;
    this._split[1].properties = this.properties;  
    this._split[0].next = this._split[1];
    this._split[1].next = this._split[0];    
    this._split[0].previous = this._split[1];
    this._split[1].previous = this._split[0];          
  }
  
  
}
