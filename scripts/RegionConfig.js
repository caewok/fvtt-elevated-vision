/* globals
foundry,
Hooks
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, TEMPLATES } from "./const.js";
import { renderTemplateSync } from "./util.js";

// Patches for the RegionConfig class
export const PATCHES = {};
PATCHES.REGIONS = {};


// ----- NOTE: Wraps ----- //

async function _renderHTML(wrapped, context, options) {
  const res = await wrapped(context, options);
  const myHTML = renderTemplateSync(TEMPLATES.REGION, context.source);
  if ( !myHTML ) return;

  // Add the EV html to the end of the identity tab.
  const div = document.createElement("div");
  div.innerHTML = myHTML;
  res.identity.appendChild(div);
  return res;
}

PATCHES.REGIONS.WRAPS = { _renderHTML };

