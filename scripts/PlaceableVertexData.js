/* globals

*/
"use strict";


class SourceWallGeometry extends PIXI.Geometry {
  constructor(source) {
    super();
    this.source = source;
    this.constructWallGeometry(walls);
  }

  constructWallGeometry(walls) {
    // Default is to draw light --> wallCorner1 --> wallCorner2.
    // Assumed that light is passed as uniform.
    // Attributes used to pass needed wall data to each vertex.
    const indices = [];
    const aWallCorner1 = [];
    const aWallCorner2 = [];
    const aTerrain = [];

    let triNumber = 0;
    const nWalls = walls.length;
    for ( let i = 0; i < nWalls; i += 1 ) {
      const wall = walls[i];
      if ( !this._includeWall(wall) ) return;

    }



  }


  _includeWall(wall) {
    const topZ = Math.min(wall.topZ, this.source.elevationZ - 1);
    const bottomZ = Math.max(wall.bottomZ, canvas.elevation.minElevation);
    if ( topZ <= bottomZ ) return false; // Wall is above or below the viewing box.
    return true;
  }

  _geometryForWall(wall) {


  }

}


class PointSourceWallGeometry extends SourceWallGeometry {

  _includeWall(wall) {
    if ( !super._includeWall(wall) ) return false;

    // Wall must be within radius

  }

}

class SizedSourceWallGeometry extends PointSourceWallGeometry {
  // Light has defined size.

}

class DirectionalSourceWallGeometry extends SourceWallGeometry {
  _includeWall(wall) {
    // Wall must not be the same direction as the source

  }

}