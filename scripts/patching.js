import { MODULE_ID, log } from "./module.js";
import { evRestrictVisiblity,
         evTestVisibility } from "./sightLayer.js";
import { evComputePolygon,
         evTestWall } from "./wallsLayer.js";

export function registerPatches() {
  libWrapper.register(MODULE_ID, 'SightLayer.prototype.restrictVisibility', evRestrictVisiblity, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'SightLayer.prototype.testVisibility', evTestVisibility, 'WRAPPER');
  
  libWrapper.register(MODULE_ID, 'WallsLayer.prototype.computePolygon', evComputePolygon, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'WallsLayer.testWall', evTestWall, 'WRAPPER');
}