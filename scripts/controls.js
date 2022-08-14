/* globals
game
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

export function addElevationLayerSceneControls(controls) {
  const isGM = game.user.isGM;
  controls.push({
    name: "elevation",
    title: "ElevationLayer.tool",
    icon: "fas fa-elevator",
    visible: isGM,
    layer: "elevation",
    activeTool: "fill-by-grid",
    tools: [
      {
        name: "fill-by-grid",
        title: "Fill by Grid",
        icon: "fas fa-brush"
      },

      {
        name: "fill-by-pixel",
        title: "Fill by Pixel",
        icon: "fas fa-paintbrush-fine"
      },

      {
        name: "fill-space",
        title: "Fill enclosed by walls",
        icon: "fas fa-fill-drip"
      },

      {
        name: "border",
        title: "Border spacer",
        icon: "fas fa-horizontal-rule"
      },

      {
        name: "fill-all",
        title: "Set all to current elevation",
        icon: "fas fa-fill"
      },

      {
        name: "clear",
        title: "Clear all",
        icon: "fas fa-trash-can"
      },

      {
        name: "undo",
        title: "Undo",
        icon: "fas fa-rotate-left"
      }
    ]
  });
}
