/*
Segments that can construct a shadow along the side away from the observer.

Allows segments used for walls or polygons to have a quasi-3d element.

When set to create a shadow, the segment determines the vision location and relative elevation of the vision point versus the segment elevation. The segment then draws one or more shadow polygons.
- blocking: infinite shadow (to edge of map) if Ve is less than Se
- 0-elevation polygon to create shade on the default map 0 elevation, with cutouts for other terrain polygons
- polygons for shadows on other terrains, which may be higher or lower than the default 0.
*/

import { COLORS, almostEqual } from "./utility.js";
import { log } from "./module.js";
import { Shadow } from "./Shadow_class.js";
import { Segment } from "./Segment_class.js";

export class ShadowSegment extends Segment {
  constructor(A, B) {
    super(A, B);
    this.elevation = 0;  
    this.has_shadow = false;
  }
 
 /*
  * Get elevation for the Segment. 
  * @type {Number} 
  */
  get elevation() {
    return this._elevation;
  }
 
 /*
  * Set elevation for the Segment. 
  * @param {Number} value   Elevation in grid units.
  * @type {Number} 
  */
  set elevation(value) {
    if(this._elevation !== value) {
      // remove cached shadow information calculations.
    }
    return this._elevation;
  }
  
 /*
  * Get the origin point (vision location) 
  * @type {PIXI.Point}  
  */
  get origin_point() {
    return this._origin_point;
  }
  
 /*
  * Set the origin point (vision location)
  * Typically accomplished using setOrigin to simultaneously set elevation of the point.
  * @param {PIXI.Point} value   {x, y} location of the vision point
  */ 
  set origin_point(value) {
    const EPSILON = 1e-5
    if(this._origin_point && (!almostEqual(this._origin_point.x, value.x, EPSILON) || 
       !almostEqual(this._origin_point.y, value.y, EPSILON))) {
      // remove cached shadow information calculations   
       
    }  
    this._origin_point = value;
  } 
  
 /*
  * Get elevation for the origin point. 
  * @type {Number} 
  */
  get origin_elevation() {
    return this._origin_elevation;
  } 
  
 /* 
  * Set elevation for the origin point. 
  * @param {Number} value   Elevation in grid units.
  * @type {Number} 
  */
  set origin_elevation(value) {
    if(this._origin_elevation !== value) {
      // remove cached shadow information calculations.
    }
    return this._origin_elevation;
  }
  
 /*
  * Set origin point and origin elevation simultaneously
  * @param {PIXI.Point} value   {x, y} location of the vision point
  * @param {Number} value   Elevation of the vision point in grid units.
  */
  setOrigin(p, e) {
    this.origin_point = p;
    this.origin_elevation = e;
  }

 /*
  * Calculate if this segment is blocking vision (Ve < Te)
  */
  get blocks_vision() {
    return this.origin_elevation < this.elevation;
  } 
  
 /*
  * maximum distance we might need to extend a Ray
  * @type {Number}
  */
  get max_distance() {
    if(this._max_distance === undefined) this._max_distance = new Ray({ x: 0, y: 0 }, 
                               { x: canvas.dimensions.sceneWidth, 
                                 y: canvas.dimensions.sceneHeight }).distance;
    return this._max_distance;
  }
  
 /*
  * Get the infinite shade trapezoid for when segment blocks.
  * @type {Shadow}
  */
  get blocking_shadow() {
    if(this._blocking_shadow === undefined) this._blocking_shadow = this._constructBlockingShadow();
    return this._blocking_shadow;
  }
  
 /*
  * Internal function to construct the infinite shade trapezoid for when segment blocks.
  * @return {Shadow}
  */
  _constructBlockingShadow() {
    return Shadow.buildShadowTrapezoid(this.origin_point, this, this.max_distance);
  }
  
 /*
  * Internal function to construct a shadow trapezoid for a given terrain elevation to 
  *   be covered.
  * @param {Number} Oe  Terrain elevation to be covered.
  */
  _constructShadow(Oe = 0) {
    const dist_A = Shadow.calculateShadowDistance(this.A, 
                                                  Oe, 
                                                  this.origin_point, 
                                                  this.origin_elevation, 
                                                  this.elevation);
    const dist_B = Shadow.calculateShadowDistance(this.B, 
                                                  Oe, 
                                                  this.origin_point, 
                                                  this.origin_elevation, 
                                                  this.elevation);
    log(`_constructShadow dist_A ${dist_A} dist_B ${dist_B} with Oe ${Oe}`); 
    return Shadow.buildShadowTrapezoid(this.origin_point, this, dist_A, dist_B);
  }
   
 /*
  * Draw the shadows for this Segment.
  * TO-DO: More complicated versions with cutouts and shadows for overlapping terrains.
  */
  drawShadows(color = COLORS.gray, alpha = 0.25) {
    if(this.splits.size > 0) {
      const splits = this.getSplits();
      splits.forEach(s => s.drawShadows(color, alpha));
      return;
    } 
  
    if(!this.has_shadow) return;
    if(this.blocks_vision) {
      this.blocking_shadow.draw(color, alpha);
    } else {
      const zero_shadow = this._constructShadow(0);
      zero_shadow.draw(color, alpha);
    }
  }        
}
