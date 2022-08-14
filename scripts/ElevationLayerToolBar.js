/* globals
Application,
canvas,
game,
mergeObject,
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { log } from "./util.js";
import { FIFOQueue } from "./FIFOQueue.js";

export class ElevationLayerToolBar extends Application {
  constructor() {
    super(...arguments);

    // As the elevation default to 0, it makes sense to start at 1 unit of elevation.
    this.currElevation = canvas.scene.dimensions.distance;
    this.undoQueue = new FIFOQueue(50);
    this.elevationLayer = canvas.layers.find(obj => obj.name === "ElevationLayer");
    this.elevationGrid =  this.elevationLayer.elevationGrid
  }

  get elevationstep() {
    return this.elevationGrid.elevationstep;
  }

  get elevationmax() {
    return this.elevationGrid.elevationmax;
  }

  /**
   * Keep elevation between 0 and the elevationmax.
   * Round to the nearest step.
   * @param {number} e   Elevation value to clamp.
   * @returns {number}
   */
  clampElevation(e) {
    this.elevationGrid.clampElevation(e);
  }

  static get defaultOptions() {
    const options = {
      classes: ["form"],
      left: 98,
      popOut: false,
      template: `modules/${MODULE_ID}/templates/elevation-step-controls.html`,
      id: `${MODULE_ID}-config`,
      title: "ElevationLayer Elevation Selection",
      closeOnSubmit: false,
      submitOnChange: false,
      submitOnClose: false
    };

    options.editable = game.user.isGM;
    return mergeObject(super.defaultOptions, options);
  }

  activateListeners(html) {
    super.activateListeners(html);
    $(".control-btn[data-tool]", html).on("click", this._onHandleClick.bind(this));
    $("#el-curr-elevation", html).on("change", this._onHandleChange.bind(this));
  }

  getData(options) {
    return {
      elevationstep: this.elevationstep,
      elevationmax: this.elevationstep,
      elevationcurr: this.currElevation
    };
  }

  /**
   * Handle when the user manually changes the elevation number
   * @param {Event} event
   */
  _onHandleChange(event) {
    if ( event.currentTarget.id !== "el-curr-elevation" ) return;
    const userValue = parseInt(event.currentTarget.value);
    log(`User input ${userValue}`);
    this.currElevation = this.clampElevation(userValue);
    this.render();
  }

  _onHandleClick(event) {
    const btn = event.currentTarget;
    const id = $(btn).attr("id");
    log(id);

    switch ( id ) {
      case "el-inc-elevation":
        this.currElevation += this.elevationstep;
        break;
      case "el-dec-elevation":
        this.currElevation -= this.elevationstep;
        break;
    }

    this.currElevation = this.clampElevation(this.currElevation);
    this.render();
  }

  async _render(...args) {
    await super._render(...args);
    $("#controls").append(this.element);
  }

  /**
   * If the user clicks a canvas location, change its elevation using the selected tool.
   * @param {PIXI.InteractionEvent} event
   */
   _onClickLeft(event) {
     log("clickLeft", event);
   }
}
