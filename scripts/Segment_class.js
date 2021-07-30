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

import { almostEqual, round, COLORS } from "./utility.js";
import { MODULE_ID, log } from "./module.js";
import { Vertex } from "./Vertex_class.js";
import { orient2d } from "./lib/orient2d.min.js";

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
   * @type {Vertex|PIXI.Point}
   */
   get A() {
     return this._vertexA || this.A; // needed for compatibility in initial construction
   }
   
  /*
   * Use vertex instead of A and B
   * @type {Vertex|PIXI.Point}
   */
   get B() {
     return this._vertexB || this.B; // needed for compatibility in initial construction
   }
   
  /*
   * Use vertex instead of A and B
   * @type {Vertex|PIXI.Point}
   */
   set A(value) {
     this._vertexA = new Vertex(value.x, value.y);
     this._vertexA.includeSegment(this);
   }
    
  /*
   * Use vertex instead of A and B
   * @type {Vertex|PIXI.Point}
   */ 
   set B(value) {
     this._vertexB = new Vertex(value.x, value.y);
     this._vertexB.includeSegment(this);
   }
   
 /*
   * Use vertex instead of A and B
   * @type {Vertex}
   */ 
   get vertexA() {
     return this._vertexA;
   }
   
  /*
   * Use vertex instead of A and B
   * @type {Vertex}
   */   
   set vertexA(value) {
     this._vertexA = value;
   }
   
  /*
   * Use vertex instead of A and B
   * @type {Vertex}
   */ 
   get vertexB() {
     return this._vertexB;
   }
   
  /*
   * Use vertex instead of A and B
   * @type {Vertex}
   */   
   set vertexB(value) {
     this._vertexB = value;
   }
   
  /*
   * Factory function to construct a linked segment from two vertices.
   * @param {Vertex} vA
   * @param {Vertex} vB
   * @return {Segment}
   */
   static fromVertices(vA, vB) {
     const s = new this(vA, vB); // use "new this" to instantiate a child class, if any.https://stackoverflow.com/questions/50964683/how-to-create-an-instance-of-a-subclass-from-the-super-class
     s.vertexA = vA;
     s.vertexB = vB;
     s.originating_object = vA.originating_object;
     return s;
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
   * Set the id for this Segment.
   * @type {String}
   */
   set id(value) {
     this._id = value;
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
     
     if(applyToSplits && this.splits.size > 0) {
       this.splits.get("A").mergeProperty(obj, opts);
       this.splits.get("B").mergeProperty(obj, opts);
     }
   }
   
  /*
   * Set a property on the split that has the given point.
   * @param {PIXI.Point} p    Point in {x,y} format, used to locate the split.
   * @param {...} ...args     Arguments passed to mergeProperty method.
   */
   mergePropertyAtSplit(p, ...args) {
     const the_split = this.getSplitAt(p);
     log(`mergePropertyAtSplit`, the_split);
     the_split.mergeProperty(...args);
   }
  
  /*
   * Set a property on the split that has the given point.
   * If the point is on a split point, use the left split point relative to vision.
   * @param {PIXI.Point} p    Point in {x,y} format, used to locate the split.
   * @param {PIXI.Point} vision_origin Point in {x,y} format.
   * @param {...} ...args     Arguments passed to mergeProperty method.
   */ 
   mergePropertyAtSplitWithVision(p, vision_origin, ...args) {
     const the_split = this.getSplitAt(p, vision_origin);
     log(`mergePropertyAtSplit`, the_split);
     the_split.mergeProperty(...args);
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
    return orient2d(p.x, p.y, this.A.x, this.A.y, this.B.x, this.B.y);
  }
  
 /*
  * Test if endpoint B is counter-clockwise (left) compared to a (vision) point,
  *   if one drew a line from the point to endpoint A. 
  * @param {PIXI.Point} p   Point to test, in {x, y} format.
  * @return {boolean} true if counter-clockwise
  */
  ccw(p) {
    const orientation = this.orient2d(p);
    if(almostEqual(orientation, 0)) return false;
    return orientation > 0;
  }
  
 /*
  * Test if a point is collinear to the segment
  * @param {PIXI.Point} p	Point to test, in {x, y} format.
  * @return {boolean} true if collinear
  */
  collinear(p) {
    return almostEqual(this.orient2d(p), 0);
  }
  
 /*
  * Get vertex of segment opposite the id
  * @param {String} id  Id of the opposing vertex
  * @return {Vertex} Opposite side vertex
  */  
  getOppositeVertex(id) {
    return this.A.id === id ? this.B : this.A;
  } 

 /*
  * Test if a point is a segment endpoint.
  * @param {PIXI.Point} p   Point to test
  * @return {boolean} true if the point is almost equal to an endpoint
  */
  hasEndpoint(p, EPSILON = 1e-5) {
    return ((almostEqual(p.x, this.A.x, EPSILON) && 
             almostEqual(p.y, this.A.y, EPSILON)) || 
            (almostEqual(p.x, this.B.x, EPSILON) && 
             almostEqual(p.y, this.B.y, EPSILON))); 
  }
  
 /*
  * Test if point is on the segment.
  * @param {PIXI.Point} p   Point to test
  * @param {boolean} true if segment includes point
  */
  contains(p, EPSILON = 1e-5) {
    if(!this.collinear(p)) return false;
    
    // test if endpoint
    if(this.hasEndpoint(p, EPSILON)) return true;
    
    // test if between the endpoints
    // recall that we already established the point is collinear above.
    const within_x = (p.x < Math.max(this.A.x, this.B.x) &&
                      p.x > Math.min(this.A.x, this.B.x)) ||
                      almostEqual(p.x, this.A.x) ||
                      almostEqual(p.x, this.B.x);

   const within_y = (p.y < Math.max(this.A.y, this.B.y) &&
                     p.y > Math.min(this.A.y, this.B.y)) ||
                     almostEqual(p.y, this.A.y) ||
                     almostEqual(p.y, this.B.y);
 
   return within_x && within_y;
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
  * Generator to iterate over splits
  */
  * splitIterator() {
    // To-DO: just make getSplits a generator. Probably yield this; return;.
    for(the_split in this.getSplits()) {
      yield the_split;
    }
  } 
  
 /*
  * Split a segment along a point.
  * store the segment splits
  * @param {PIXI.Point} p   Point to use for the split
  */
  splitAt(p) {
    if(!this.contains(p)) {
      console.error(`${MODULE_ID}|Segment class split method: Point is not within the segment.`, p, this);
    }
    
    const p_dist = this.vertexA.squaredDistance(p);
    
    if(this.split_dist) {
      if(p_dist === this.split_dist) return; // already split at this distance
      // already split, call split on child for correct side
      // begin ...s... p ... end
      // |-- sd --|
      // |-- p_dist ---|
      // p_dist > sd, so the new split is in B
      
      const child_node = (p_dist > this.split_dist) ? "B" : "A";
      this.splits.get(child_node).splitAt(p);
      return;      
    }
    
    this.split_dist = p_dist;
    this.splits = new Map();
    
    // sub-segments should share the vertices of the parent, plus the p vertex, if any
    if(!(p instanceof Vertex)) p = Vertex.fromPoint(p);
    
    const segA = Segment.fromVertices(this.A, p);
    const segB = Segment.fromVertices(p, this.B);
        
    segA.originating_object = this.originating_object;
    segA.properties = duplicate(this.properties); // otherwise, the splits all share 
                                                  // the same properties. 
    segA.parent = this;
        
    segB.originating_object = this.originating_object;
    segB.properties = duplicate(this.properties); 
    segB.parent = this;
    
    this.splits.set("A", segA);
    this.splits.set("B", segB);
  }

 /*
  * Return the very first split in the segment.
  * @return {Segment}
  */ 
  firstSplit() {
    if(this.splits.size === 0) return this;
    return splits.get("A").firstSplit();
  }
  
 /*
  * Return the split that is before a given point. 
  * If the point is on the boundary between splits, use the left split point.
  * @param {PIXI.Point} p   Point in {x, y} format
  * @return {Segment}
  */ 
  getSplitAt(p, vision_origin) {
    if(this.splits.size === 0) return this;
    
    const p_dist = this.vertexA.squaredDistance(p);
    let child_node = (p_dist > this.split_dist) ? "B" : "A"; // should mirror splitAt
    
    if(vision_origin && p_dist === this.split_dist) {
      // determine which vertex is left of the vision point; use that in case of tie
      child_node = this.ccw(vision_origin) ? "B" : "A"; 
    }
    
    return this.splits.get(child_node).getSplitAt(p);
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
   * Is the segment to the left of the point? (Looks like only if entire segment is to the left
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
    const B1 = this.leftOf(Segment.interpolate(segment.A, segment.B, 0.01));
    const B2 = this.leftOf(Segment.interpolate(segment.B, segment.A, 0.01));
    const B3 = this.leftOf(relativePoint);
    
    const A1 = segment.leftOf(Segment.interpolate(this.A, this.B, 0.01));
    const A2 = segment.leftOf(Segment.interpolate(this.B, this.A, 0.01)); 
    const A3 = segment.leftOf(relativePoint);
    
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

