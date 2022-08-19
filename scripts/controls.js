/* globals
game,
canvas
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

export function addElevationLayerSceneControls(controls) {
  const isGM = game.user.isGM;
  controls.push({
    name: "elevation",
    title: "ElevationLayer.tool",
    icon: "fas fa-elevator",
    visible: isGM,
    layer: "elevation",
    activeTool: "fill-by-grid",
    currentElevation: canvas.scene?.dimensions?.distance || 0,
    tools: [
      {
        name: "fill-by-grid",
        title: "Fill by Grid",
        icon: "fas fa-brush"
      },

//       {
//         name: "fill-by-pixel",
//         title: "Fill by Pixel",
//         icon: "fas fa-paintbrush-fine"
//       },
//
//       {
//         name: "fill-space",
//         title: "Fill enclosed by walls",
//         icon: "fas fa-fill-drip"
//       },
//
//       {
//         name: "border",
//         title: "Border spacer",
//         icon: "fas fa-horizontal-rule",
//         active: false
//       },
//
//       {
//         name: "fill-all",
//         title: "Set all to current elevation",
//         icon: "fas fa-fill"
//       },
//
//       {
//         name: "clear",
//         title: "Clear all",
//         icon: "fas fa-trash-can"
//       },
//
//       {
//         name: "undo",
//         title: "Undo",
//         icon: "fas fa-rotate-left"
//       },



      {
        name: "upload",
        title: "Upload elevation data and replace in scene",
        icon: "fas fa-file-arrow-up",
        onClick: () => {
					//canvas.elevation.importDialog()
					new FilePicker({
              type: "image",
              displayMode: "thumbs",
              tileSize: false,
              callback: canvas.elevation.importFromPNG
            }).render(true);
				}
      },

      {
        name: "download",
        title: "Download elevation data",
        icon: "fas fa-file-arrow-down",
        onClick: () => {
					canvas.elevation.downloadElevationData()
				}
      }
    ]
  });
}

export function addElevationLayerSubControls(controls) {
  if ( !canvas || !canvas.elevation ) return;

  if ( controls.activeControl === "elevation" ) {
    if ( !canvas.elevation.toolbar ) canvas.elevation.toolbar = new ElevationLayerToolBar();
    canvas.elevation.toolbar.render(true);

  } else {
    if ( !canvas.elevation.toolbar ) return;
    canvas.elevation.toolbar.close();
  }
}

export function renderElevationLayerSubControls() {
  const tools = $(canvas.elevation.toolbar.form).parent();
  if ( !tools ) return;
  const controltools = $("li[data-tool='fill-by-pixel']").closest(".sub-controls");
  controltools.addClass("elevation-controls");
  canvas.elevation.toolbar.element.addClass("active");
}
