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
Hooks.on("renderSceneControls", addElevationLayerSubControls);
Hooks.on("renderTerrainLayerToolBar", renderElevationLayerSubControls);

function addElevationLayerSceneControls(controls) {
  const isGM = game.user.isGM;
  controls.push({
    name: "elevation",
    title: game.i18n.localize(`${MODULE_ID}.name`),
    icon: "fas fa-elevator",
    visible: isGM,
    layer: "elevation",
    activeTool: "fill-by-grid",
    currentElevation: canvas.scene?.dimensions?.distance || 0,
    tools: [
      {
        name: "fill-by-grid",
        title: game.i18n.localize(`${MODULE_ID}.controls.fill-by-grid.name`),
        icon: "fas fa-brush"
      },

      {
        name: "fill-by-los",
        title: game.i18n.localize(`${MODULE_ID}.controls.fill-by-los.name`),
        icon: "fas fa-eye"
      },

      /* TO-DO: How feasible would be a "painting" option with circle or square brush?
      {
        name: "fill-by-pixel",
        title: "Fill by Pixel",
        icon: "fas fa-paintbrush-fine"
      },
      */
      {
        name: "fill-space",
        title: game.i18n.localize(`${MODULE_ID}.controls.fill-space.name`),
        icon: "fas fa-fill-drip"
      },

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
      },

      {
        name: "upload",
        title: game.i18n.localize(`${MODULE_ID}.controls.upload.name`),
        icon: "fas fa-file-arrow-up",
        button: true,
        onClick: () => {
          new FilePicker({
            type: "image",
            displayMode: "thumbs",
            tileSize: false,
            callback: file => { canvas.elevation.importFromImageFile(file); }
          }).render(true);
        }
      },

      {
        name: "download",
        title: game.i18n.localize(`${MODULE_ID}.controls.download.name`),
        icon: "fas fa-file-arrow-down",
        button: true,
        onClick: () => { canvas.elevation.downloadElevationData({format: "image/webp"}); }
      },

      {
        name: "undo",
        title: game.i18n.localize(`${MODULE_ID}.controls.undo.name`),
        icon: "fas fa-rotate-left",
        button: true,
        onClick: () => {
          canvas.elevation.undo();
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

function renderElevationLayerSubControls() {
  const tools = $(canvas.elevation.toolbar.form).parent();
  if ( !tools ) return;
  const controltools = $("li[data-tool='fill-by-pixel']").closest(".sub-controls");
  controltools.addClass("elevation-controls");
  canvas.elevation.toolbar.element.addClass("active");
}
