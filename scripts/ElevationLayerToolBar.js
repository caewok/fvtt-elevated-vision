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
    this.currElevation = canvas.scene.dimensions.distance;
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
  }

  getData(options) {
    const elevationstep = canvas.scene.dimensions.distance;
    return {
      elevationstep,
      elevationmax: 255 * elevationstep,
      elevationcurr: this.currElevation
    };
  }

  _onHandleClick(event) {
    const btn = event.currentTarget;
    const id = $(btn).attr("id");
    const elevationstep = canvas.scene.dimensions.distance;
    log(id);

    switch ( id ) {
      case "el-inc-elevation":
        this.currElevation += elevationstep;
        break;
      case "el-dec-elevation":
        this.currElevation -= elevationstep;
        break;
      case "el-curr-elevation":
        this.currElevation = $(btn).attr("value");
        break;
    }

    this.currElevation = Math.clamped(this.currElevation, 0, 255 * elevationstep);
    this.render();
  }

  async _render(...args) {
    await super._render(...args);
    $("#controls").append(this.element);
  }
}
