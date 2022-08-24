/* globals
Application,
canvas,
game,
mergeObject,
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { log } from "./util.js";

export class ElevationLayerToolBar extends Application {
  constructor() {
    super(...arguments);

    // As the elevation default to 0, it makes sense to start at 1 unit of elevation.
    this.elevation = canvas.elevation;
    this.currentElevation = canvas.scene.dimensions.distance;
  }

  get elevationStep() {
    return this.elevation.elevationStep;
  }

  get elevationMax() {
    return this.elevation.elevationMax;
  }

  get currentElevation() {
    return canvas.elevation.controls.currentElevation;
  }

  set currentElevation(value) {
    canvas.elevation.controls.currentElevation = value;
  }

  /**
   * Keep elevation between the designated min and max.
   * Round to the nearest step.
   * @param {number} e   Elevation value to clamp.
   * @returns {number}
   */
  clampElevation(e) {
    return this.elevation.clampElevation(e);
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
      elevationstep: this.elevationStep,
      elevationmax: this.elevationMax,
      elevationcurr: this.currentElevation
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
    this.currentElevation = this.clampElevation(userValue);
    this.render();
  }

  _onHandleClick(event) {
    const btn = event.currentTarget;
    const id = $(btn).attr("id");
    log(id);
    let newElevation = this.currentElevation || 0;
    switch ( id ) {
      case "el-inc-elevation":
        newElevation += this.elevationStep;
        break;
      case "el-dec-elevation":
        newElevation -= this.elevationStep;
        break;
    }

    this.currentElevation = this.clampElevation(newElevation);
    this.render();
  }

  async _render(...args) {
    await super._render(...args);
    $("#controls").append(this.element);
  }
}
