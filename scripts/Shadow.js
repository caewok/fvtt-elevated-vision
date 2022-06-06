/* globals
PIXI,
Ray,
canvas
*/
"use strict";

import { perpendicularPoint, distanceBetweenPoints } from "./util.js";
import { COLORS, drawShape } from "./drawing.js";
import { ClipperLib } from "./ClockwiseSweep/clipper_unminified.js";

export class Shadow extends PIXI.Polygon {

  /**
   * Build the parallelogram representing a shadow cast from a wall.
   * Looking top-down with a light or other source object at a given elevation
   * above a wall.
   * @param {Wall} w
   * @param {LightSource} source
   * @return {Shadow}
   */
  static constructShadow(wall, source) {
    /*
     Looking at a cross-section:
      V----------T----O-----?
      | \ Ø      |    |
    Ve|    \     |    |
      |       \  |    |
      |          \    |
      |        Te|  \ | <- point O where obj can be seen by V for given elevations
      ----------------•----
      |<-   VO      ->|
     e = height of V (vision object)
     Ø = theta
     T = terrain wall

     Looking from above:
                  •
                 /| 𝜶 is the angle VT to VT.A
              •/ -|
             /|   |
           /  | S | B
         /    |   |
       / 𝜶  B |   |
     V -------T---• O
     (and mirrored on bottom)
     S = shadow area
     B = bright area

     naming:
     - single upper case: point. e.g. V
     - double upper case: ray/segment. e.g. VT
     - lower case: descriptor. e.g., Ve for elevation of V.

    */
    let Te = wall.top; // TO-DO: allow floating walls to let light through the bottom portion
    let Oe = 0; // TO-DO: allow this to be modified by terrain elevation
    let Ve = source.elevation;
    if ( Ve <= Te ) return null; // Vision object blocked completely by wall

    // Need the point of the wall that forms a perpendicular line to the vision object
    const Tix = perpendicularPoint(wall.A, wall.B, source);
    if ( !Tix ) return null; // Line collinear with vision object
    const VT = new Ray(source, Tix);

    // If any elevation is negative, normalize so that the lowest elevation is 0
    const min_elevation = Math.min(Ve, Oe, Te);
    if ( min_elevation < 0 ) {
      const adder = Math.abs(min_elevation);
      Ve = Ve + adder;
      Oe = Oe + adder;
      Te = Te + adder;
    }

    // Theta is the angle between the 3-D sight line and the sight line in 2-D
    const theta = Math.atan((Ve - Te) / VT.distance); // Theta is in radians
    const TOdist = (Te - Oe) / Math.tan(theta); // Tan wants radians
    const VOdist = VT.distance + TOdist;

    /* Testing
    // Ray extending out V --> T --> O
    api.drawing.drawPoint(source, {color: api.drawing.COLORS.yellow})

    VO = Ray.towardsPoint(source, Tix, VOdist)
    api.drawing.drawPoint(vto.B, {color: api.drawing.COLORS.lightblue})
    */

    // Knowing the distances of the lines VT and VO, we can use the angle alpha
    // to determine the length of the line V->Tb --> ?
    // Alpha is the angle between V|T and V|wall.A or V|wall.B
    const distA = distanceBetweenPoints(wall.A, VT.B);
    const distB = distanceBetweenPoints(wall.B, VT.B);
    const alphaA = Math.atan(distA / VT.distance);
    const alphaB = Math.atan(distB / VT.distance);

    // Get the hypotenuse size to extend a line from V past wall T at endpoint,
    // given angle alpha.
    // Should form the parallelogram with wall T on one parallel side
    const hypA = VOdist / Math.cos(alphaA);
    const hypB = VOdist / Math.cos(alphaB);

    const VAdist = distanceBetweenPoints(source, wall.A);
    const VBdist = distanceBetweenPoints(source, wall.B);

    const VOa = Ray.towardsPoint(source, wall.A, VAdist + hypA);
    const VOb = Ray.towardsPoint(source, wall.B, VBdist + hypB);

    /* Testing
    // Rays extending V --> T.A or T.B --> end of shadow
    api.drawing.drawSegment(VOa, {color: api.drawing.COLORS.green})
    api.drawing.drawSegment(VOb, {color: api.drawing.COLORS.orange})
    api.drawing.drawSegment({A: VOa.B, B: VOb.B}, {color: api.drawing.COLORS.gray})
    */

    const shadow = new this([wall.A, VOa.B, VOb.B, wall.B]);

    /* Testing
    api.drawing.drawShape(shadow)
    */

    // Cache some values
    shadow.wall = wall;
    shadow.source = source;
    shadow.VT = VT;
    shadow.theta = theta;
    shadow.alpha = { A: alphaA, B: alphaB };

    return shadow;
  }

  /**
   * Intersect this shadow against a polygon and return a new shadow.
   * Copy relevant data from this shadow.
   * Used primarily to intersect against the sweep.
   */
  intersectPolygon(poly) {
    // Cannot rely on the super.intersectPolygon because we need to retrieve all the holes.
    const solution = this.clipperClip(poly, { cliptype: ClipperLib.ClipType.ctIntersection });

    return solution.map(pts => {
      const polyIx = PIXI.Polygon.fromClipperPoints(pts);
      const model = new this.constructor();
      Object.assign(model, polyIx);

      model.wall = this.wall;
      model.source = this.source;
      model.VT = this.VT;
      model.theta = this.theta
      model.alpha = this.alpha;

      return model;
    });
  }

  /**
   * Draw a shadow shape on canvas. Used for debugging.
   * Optional:
   * @param {HexString} color   Color of outline shape
   * @param {number} width      Width of outline shape
   * @param {HexString} fill    Color used to fill the shape
   * @param {number} alpha      Alpha transparency between 0 and 1
   */
  draw({ color = COLORS.gray, width = 1, fill = COLORS.gray, alpha = .5 } = {} ) {
    canvas.controls.debug.beginFill(fill, alpha);
    drawShape(this, { color, width });
    canvas.controls.debug.endFill();
  }
}

export function drawMeshes() {
  // Destroy an existing render texture
  if ( !this._flags.useFov ) {
    if ( this.fovTexture ) this.fovTexture.destroy(true);
    this.fovTexture = null;
  }

  // Update the render texture
  if ( this._flags.renderFOV ) {
    this.losMask.clear().beginFill(0xFFFFFF).drawShape(this.los);

    if ( this.los?.shadows && this.los.shadows.size ) {
      this.los.shadows.forEach(s_arr => {
        s_arr.forEach(s => {
          log("Drawing shadow", s);
          this.losMask.beginHole().drawShape(s).endHole();
        });
      });
    }

    this.losMask.endFill();

    if ( this._flags.useFov ) this._renderTexture();
    else this._flags.renderFOV = false;
  }

  // Draw new meshes
  const background = this.drawBackground();
  const light = this.drawLight();
  const color = this.drawColor();
  return {background, light, color};
}
