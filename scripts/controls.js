/* globals
game,
canvas,
Dialog,
FilePicker,
Hooks
*/
"use strict";

/*
Anticipated UI:

Controls:
- Current elevation for painting. Scroll wheel to increment / decrement
- Tool to fill by grid square
- Tool to fill all space contained between walls
- Tool to fill by pixel. Resize and choose shape: grid square, hex, circle. Reset size to grid size.
- Reset
- Undo
*/

import { ElevationLayerToolBar } from "./ElevationLayerToolBar.js";
import { MODULE_ID } from "./const.js";

Hooks.on("getSceneControlButtons", addElevationLayerSceneControls);
Hooks.on("renderSceneControls", (controls) => {
  addElevationLayerSubControls(controls)
  drawBrush(controls);
});
Hooks.on("renderTerrainLayerToolBar", renderElevationLayerSubControls);
Hooks.on("getSceneControlButtons", addDirectionalLightingControl);

function addDirectionalLightingControl(controls) {
  // const isGM = game.user.isGM;
  const lighting = controls.find(c => c.name === "lighting");
  // if ( lighting.tools.some(t => t.name === "directionalLight") ) return;

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

function addElevationLayerSubControls(controls) {
  if ( !canvas || !canvas.elevation ) return;

  if ( controls.activeControl === "elevation" ) {
    if ( !canvas.elevation.toolbar ) canvas.elevation.toolbar = new ElevationLayerToolBar();
    canvas.elevation.toolbar.render(true);

  } else {
    if ( !canvas.elevation.toolbar ) return;
    canvas.elevation.toolbar.close();
  }
}

function drawBrush(controls) {
  if ( !canvas.elevation ) return;
  switch (controls.tool) {
    case 'fill-by-pixel':
      canvas.elevation.drawBrush();
      break;
    default:
      break;
  }
}

function renderElevationLayerSubControls() {
  if ( !canvas.elevation.toolbar ) return;
  const tools = $(canvas.elevation.toolbar.form).parent();
  if ( !tools ) return;
  const controltools = $("li[data-tool='fill-by-pixel']").closest(".sub-controls");
  controltools.addClass("elevation-controls");
  canvas.elevation.toolbar.element.addClass("active");
}
