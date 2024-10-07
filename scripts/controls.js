/* globals
game,
canvas,
Dialog,
FilePicker,
Hooks
*/
"use strict";

import { ElevationLayerToolBar } from "./ElevationLayerToolBar.js";
import { MODULE_ID } from "./const.js";

Hooks.on("getSceneControlButtons", addElevationLayerSceneControls);
Hooks.on("getSceneControlButtons", addDirectionalLightingControl);

function addDirectionalLightingControl(controls) {
  const lighting = controls.find(c => c.name === "lighting");
  const directionalTool = {
    name: "directional-light",
    title: game.i18n.localize(`${MODULE_ID}.controls.directional-light.name`),
    icon: "fas fa-star"
  };
  lighting.tools = [lighting.tools[0], directionalTool, ...lighting.tools.slice(1)];
}


function addElevationLayerSceneControls(controls) {
  const isGM = game.user.isGM;
  controls.push({
    name: "elevation",
    title: game.i18n.localize(`${MODULE_ID}.name`),
    icon: "fas fa-elevator",
    visible: isGM,
    layer: "elevation",
    currentElevation: canvas.scene?.dimensions?.distance || 0,
    tools: [

      {
        name: "clear",
        title: game.i18n.localize(`${MODULE_ID}.controls.clear.name`),
        icon: "fas fa-trash-can",
        button: true,
        onClick: () => {
          Dialog.confirm({
            title: game.i18n.localize(`${MODULE_ID}.controls.clear.confirm.title`),
            content: game.i18n.localize(`${MODULE_ID}.controls.clear.confirm.content`),
            yes: () => canvas.elevation.clearElevationData()
          });
        }
      }
    ]
  });
}
