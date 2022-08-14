/* globals

*/
"use strict";

import { MODULE_ID } from "./const.js";

export class ElevationLayerToolBar extends Application {
  constructor(...arguments) {
    super(...arguments);
  }

  static get defaultOptions() {
    const options = {
      classes: ["form"],
      left: 98,
      popOut: false,
      template: `modules/${MODULE_ID}/templates/elevation-controls.html`,
      id: `${MODULE_ID}-config`,
      title: ""
    };
  }

}