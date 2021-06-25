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

/*
 * Class to represent a vertex 
 * - all tracking of what segments contain it as an endpoitn
 * - equality test using almost equal
 * - unique id for vertex
 */
export class Vertex extends PIXI.Point {
  constructor(x, y) {
    super(x, y);
    this.segments = new Map;
    this.originating_object = undefined; // typically used to set the id of the object 
                                         // to which this vertex belongs
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
}


/*
 * Class extending Ray to represent a segment, such as part of a polygon or wall
 * - provides a unique id for the segment
 * - adds almost equal test
 * - measures ccr against a vision point
 * - provides next and previous methods if chaining as in a polygon
 */ 
export class Segment extends Ray {
  constructor(A, B) {

    super(A, B);
    this.originating_object = undefined; // typically used to set the id of the object 
                                         // to which this segment belongs
    this.properties = {}; // typically used to characterize the segments  
    this.splits = new Map(); // may contain 2 or more segments        
    
    //const vertices = Vertex.constructVertexFromSegment(this);  
    //this.vertexA = vertices.A;
    //this.vertexB = vertices.B;                        
  }
  
  /*
   * Use vertex instead of A and B
   */
   get A() {
     return this._vertexA || this.A; // needed for compatibility in initial construction
   }
   
   get B() {
     return this._vertexB || this.B;
   }
   
   set A(value) {
     this._vertexA = new Vertex(value.x, value.y);
     this._vertexA.includeSegment(this);
   }
   
   set B(value) {
     this._vertexB = new Vertex(value.x, value.y);
     this._vertexB.includeSegment(this);
   }

  /*
   * Get the id for this Segment.
   * @type {String}
   */
   get id() {
     if(!this._id) this._id = foundry.utils.randomID();
     return this._id;
   }
   
  /*
   * Merge a property into the segment properties.
   * This will push the property to splits, if any
   * See Foundry VTT mergeProperty
   */
   mergeProperty(obj, { insertKeys=true, 
                        insertValues=true, 
                        overwrite=true, 
                        recursive=true,  
                        enforceTypes=false, 
                        applyToSplits=true } = {}) {
     const opts = { insertKeys: insertKeys,
                    insertValues: insertValues,
                    overwrite: overwrite,
                    recursive: recursive,
                    inplace: true,
                    enforceTypes: enforceTypes,
                    applyToSplits: applyToSplits };
   
     mergeObject(this.properties, obj, opts);
     
     if(this.splits.size > 0) {
       this.splits.get("A").mergeProperty(obj, opts);
       this.splits.get("B").mergeProperty(obj, opts);
     }
   }
  
 /*
  * Reverse the direction of the Segment
  * @return {Segment}
  */
  reverse() {
    // cannot simply use super b/c it calls new Ray instead of new this.
    const s = new this.constructor(this.B, this.A);
    s._distance = this._distance;
    s._angle = Math.PI - this._angle;
    return s;
  }

 /*
  * Orient ccw based on vision point
  * Either return this segment or reverse it
  * @return {Segment}
  */
  orientToPoint(p) {
    if(this.ccw(p)) return this;
    return this.reverse();
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
    return orient2drounded(p.x, p.y, this.A.x, this.A.y, this.B.x, this.B.y);
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
    if(orient2drounded(this.A.x, this.A.y, p.x, p.y, this.B.x, this.B.y)) return false;
    
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
  * Get array of all splits
  * Splits are recursive, so this follows down the recursion
  * @return [Array{Segment}] Array of Segments representing a copy of the split segments
  */
  getSplits() {  
    if(this.splits.size === 0) return [this];
    return this.splits.get("A").getSplits().concat(this.splits.get("B").getSplits());
  }
  
 /*
  * Split a segment along a point.
  * store the segment splits
  * @param {PIXI.Point} p   Point to use for the split
  */
  split(p) {
    if(!this.contains(p)) {
      console.error(`${MODULE_ID}|Segment class split method: Point is not within the segment.`, p, this);
    }
    
    const p_dist = this.vertexA.squaredDist(p);
    
    if(this.split_dist) {
      if(p_dist === this.split_dist) return; // already split at this distance
      // already split, call split on child for correct side
      const child_node = (this.split_dist > p_dist) ? "A" : "B";    
      this.splits.get("A").split(p);
      return;      
    }
    
    this.split_dist = p_dist;
    this.splits = new Map();
    
    const segA = new Segment({ x: this.A.x, y: this.A.y }, 
                             { x: p.x, y: p.y });
    const segB = new Segment({ x: p.x, y: p.y }, 
                             { x: this.B.x, y: this.B.y });                      
    
    
    segA.originating_object = this.originating_object;
    segA.properties = this.properties;
    segA.parent = this;
        
    segB.originating_object = this.originating_object;
    segB.properties = this.properties;
    segB.parent = this;
    
    this.splits.add("A", segA);
    this.splits.add("B", segB);
  }

  
  firstSplit() {
    if(this.splits.size === 0) return this;
    return splits.get("A").firstSplit();
  }
  
//   nextSplit() {
// //     root
// //     - A 
// //       - A  
// //       - B  
// //     - B 
// //       - A
// //         - A <-- 
// //         - B 
// //       - B 
//     
//     if(!this.split_id) return undefined; // should be root or otherwise done.
//     if(this.split_id === "A") return this.originating_object.splits.B.firstSplit();   
//     if(this.split_id === "B") return this.originating_object.nextSplit();
//     return undefined; // shouldn't happen
//   }
//   
//   get next_split() {
//     let n = !this._active_split ? this.firstSplit() : this._active_split.nextSplit();
//     this._active_split = n;
//     return this._active_split;
//   }
//   
//   get active_split() {
//     return this._active_split || this;
//   }
//   
//   set active_split(value) {
//     this._active_split = value;
//   }
//   
  
  /*
   * Is the segment to the left of the point?
   * TO-DO: Is this exactly equivalent to ccw? Not totally certain as to the point ordering here.
   * @param {PIXI.Point} p  Point to test
   * @return {boolean} true if the segment is to the left
   */
   // From: https://github.com/Silverwolf90/2d-visibility/blob/a5508bdee8d0a816a2f7457f00a221060a03fe5f/src/segmentInFrontOf.js
   leftOf(p) {
     const cross = (this.B.x - this.A.x) * (p.y - this.A.y)
              - (this.B.y - this.A.y) * (p.x - this.A.x);
     return cross < 0;
   }
  
   /*
    * Factory function to get point between two points
    * @param {PIXI.Point} pointA  Point in {x, y} format.
    * @param {PIXI.Point} pointB  Point in {x, y} format.
    * @param {Number} f           Percent distance for the interpolation
    * @return {PIXI.Point} Interpolated point.
    */
   static interpolate(pointA, pointB, f) {
     return { x: pointA.x*(1-f) + pointB.x*f,
              y: pointA.y*(1-f) + pointB.y*f };
   }
  
  /*
   * Return true if this segment is in front of another segment
   * @param {Segment} segment               Segment to test
   * @param {PIXI.Point} relativePoint  Vision/observer point
   * @return {boolean} true if this segment is in front of the other.
   */
  inFrontOf(segment, relativePoint) {
    const A1 = this.leftOf(Segment.interpolate(segment.A, segment.B, 0.01));
    const A2 = this.leftOf(Segment.interpolate(segment.B, segment.A, 0.01));
    const A3 = this.leftOf(relativePoint);
    
    const B1 = segment.leftOf(Segment.interpolate(this.A, this.B, 0.01));
    const B2 = segment.leftOf(Segment.interpolate(this.B, this.A, 0.01)); 
    const B3 = segment.leftOf(relativePoint);
    
    if (B1 === B2 && B2 !== B3) return true;
    if (A1 === A2 && A2 === A3) return true;
    if (A1 === A2 && A2 !== A3) return false;
    if (B1 === B2 && B2 === B3) return false;

    return false;
  }
  
  draw(color = COLORS.black, alpha = 1, width = 1) {
    canvas.controls.debug.lineStyle(width, color, alpha).moveTo(this.A.x, this.A.y).lineTo(this.B.x, this.B.y);
  }
  
  
}
