/* globals
Hooks,
game,
canvas,
CONFIG,
renderTemplate,
Dialog,
ui,
Ray,
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { log } from "./util.js";

// Patches
import { patchTile } from "./patches/Tile.js";

// Rendering configs
import { renderAmbientLightConfigHook, renderAmbientSoundConfigHook, renderTileConfigHook } from "./renderConfig.js";

// API imports
import * as util from "./util.js";
import * as extract from "./perfect-vision/extract-pixels.js";
import { FILOQueue } from "./FILOQueue.js";
import { ShadowShader } from "./ShadowShader.js";
import { ShadowShaderNoRadius } from "./ShadowShaderNoRadius.js";
import { ElevationGrid } from "./ElevationGrid.js";
import { WallTracerEdge, WallTracerVertex, WallTracer, SCENE_GRAPH } from "./WallTracer.js";
import { PixelCache, TilePixelCache } from "./PixelCache.js";

// Register methods, patches, settings
import { registerAdditions, registerPatches, registerShadowPatches } from "./patching.js";
import { registerGeometry } from "./geometry/registration.js";
import { registerElevationAdditions } from "./elevation.js";

// For elevation layer registration and API
import { ElevationLayer } from "./ElevationLayer.js";

// Elevation Layer control tools
import {
  addElevationLayerSceneControls,
  addElevationLayerSubControls,
  renderElevationLayerSubControls
} from "./controls.js";

// Settings, to toggle whether to change elevation on token move
import { SETTINGS, getSetting, setSetting, registerSettings, getSceneSetting, setSceneSetting, reloadTokenControls } from "./settings.js";
import { elevationForTokenTravel } from "./tokens.js";

const FLY_CONTROL = {
  name: SETTINGS.FLY_BUTTON,
  title: `${MODULE_ID}.controls.${SETTINGS.FLY_BUTTON}.name`,
  icon: "fa-solid fa-plane-lock",
  toggle: true
}

Hooks.once("init", function() {
  game.modules.get(MODULE_ID).api = {
    util,
    extract,
    ElevationLayer,
    ElevationGrid,
    ShadowShader,
    ShadowShaderNoRadius,
    FILOQueue,
    WallTracerEdge,
    WallTracerVertex,
    WallTracer,
    SCENE_GRAPH,
    PixelCache,
    TilePixelCache
  };

  FLY_CONTROL.title = game.i18n.localize(FLY_CONTROL.title);

  // These methods need to be registered early
  registerGeometry();
  registerElevationAdditions();
  registerSettings();
  registerLayer();
  registerAdditions();
});

Hooks.once("libWrapper.Ready", async function() {
  patchTile();
});

Hooks.once("setup", async function() {
  registerPatches();
});


Hooks.once("ready", async function() {
  if ( !getSetting(SETTINGS.WELCOME_DIALOG.v020) ) {
		Dialog.prompt({
			title: "Elevated Vision v0.2.0 Changes!",
			content: `
<p>
As of version 0.2.0, Elevated Vision no longer adjusts token visibility. You can install one or more of the
following modules if you need more functionality regarding 3d token visibility:
<ul>
  <li><a href="https://github.com/caewok/fvtt-token-visibility">Alternative Token Visibility</a></li>
  <li><a href="https://github.com/dev7355608/perfect-vision">Perfect Vision</a></li>
  <li><a href="https://github.com/theripper93/Levels">Levels</a></li>
</ul>
These modules should work together; please report bugs to the relevant git issue page!
</p>

<p>
Elevated Vision also no longer strictly requires, but still very strongly recommends, the <a href="https://foundryvtt.com/packages/wall-height/">Wall Height</a> module.
With Wall Height, you can set walls and lights to have defined heights. Elevated Vision will create shadows for elevated lights cast on lower walls,
block lower-elevation lights from illuminating the higher elevation, and create shadows when elevated tokens look down at lower-elevation walls.
</p>
<p>
Thus, with Wall Height but no other token visibility module installed, tokens in shadows
(caused by looking down on walls with defined height) will remain visible. Tokens otherwise behind walls
will be unseen, as expected by default Foundry. Basically, token visibility should be equivalent to
what you get using the Wall Height module alone; shadows are added but do not affect the visibility calculation.
</p>

<p>
<br>
<em>Clicking the button below will make this message no longer display when FoundryVTT loads. If you
want to keep seeing this message, please click the close button above.</em>
</p>
`,
			rejectClose: false,
			callback: () => setSetting(SETTINGS.WELCOME_DIALOG.v020, true)
		});
	}
});

Hooks.on("canvasInit", async function(canvas) {
  log("canvasInit");

  if ( typeof getSceneSetting(SETTINGS.AUTO_ELEVATION) === "undefined" ) {
    const autoelevate = getSetting(SETTINGS.AUTO_ELEVATION) ?? true;
    await setSceneSetting(SETTINGS.AUTO_ELEVATION, autoelevate);
  }

  if ( typeof getSceneSetting(SETTINGS.SHADING.ALGORITHM) === "undefined" ) {
    const algorithm = getSetting(SETTINGS.SHADING.ALGORITHM) ?? SETTINGS.SHADING.TYPES.WEBGL;
    await setSceneSetting(SETTINGS.SHADING.ALGORITHM, algorithm);
  }

  registerShadowPatches();
  updateFlyTokenControl();
});

Hooks.on("canvasReady", async function() {
  // Set the elevation grid now that we know scene dimensions
  if ( !canvas.elevation ) return;
  canvas.elevation.initialize();
});


Hooks.on("3DCanvasToggleMode", async function(isOn) {
  // TODO: Do we need to reset the values for the scene? Seems unnecessary, as a 3d canvas
  //       is not likely to be used in a non-3d state and require EV for it.
  if ( !isOn ) return;

  const autoelevateDisabled = getSceneSetting(SETTINGS.AUTO_ELEVATION);
  const shadowsDisabled = getSceneSetting(SETTINGS.SHADING.ALGORITHM) !== SETTINGS.SHADING.TYPES.NONE;

  if ( autoelevateDisabled ) {
    await setSceneSetting(SETTINGS.AUTO_ELEVATION, false);
    updateFlyTokenControl(false);
  }
  if ( shadowsDisabled ) await setSceneSetting(SETTINGS.SHADING.ALGORITHM, SETTINGS.SHADING.TYPES.NONE);

  registerShadowPatches();
  await canvas.draw(canvas.scene);

  if ( autoelevateDisabled || shadowsDisabled ) {
    ui.notifications.notify("Elevated Vision autoelevate and features for the scenes for compatibility with 3D Canvas.");
  }
});

// https://github.com/League-of-Foundry-Developers/foundryvtt-devMode
Hooks.once("devModeReady", ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(MODULE_ID);
});

Hooks.on("getSceneControlButtons", addElevationLayerSceneControls);
Hooks.on("renderSceneControls", addElevationLayerSubControls);
Hooks.on("renderTerrainLayerToolBar", renderElevationLayerSubControls);

function registerLayer() {
  CONFIG.Canvas.layers.elevation = { group: "primary", layerClass: ElevationLayer };
}


// Reset the token elevation when moving the token after a cloned drag operation.
// Token.prototype._refresh is then used to update the elevation as the token is moved.
Hooks.on("preUpdateToken", function(tokenD, changes, options, userId) {  // eslint-disable-line no-unused-vars
  const token = tokenD.object;
  log(`preUpdateToken hook ${changes.x}, ${changes.y}, ${changes.elevation} at elevation ${token.document?.elevation} with elevationD ${tokenD.elevation}`, changes);
  log(`preUpdateToken hook moving ${tokenD.x},${tokenD.y} --> ${changes.x ? changes.x : tokenD.x},${changes.y ? changes.y : tokenD.y}`);

  token._elevatedVision ??= {};
  token._elevatedVision.tokenAdjustElevation = false; // Just a placeholder
  token._elevatedVision.tokenHasAnimated = false;

  if ( !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return;
  if ( typeof changes.x === "undefined" && typeof changes.y === "undefined" ) return;

  const tokenCenter = token.center;
  const tokenDestination = token.getCenter(changes.x ? changes.x : tokenD.x, changes.y ? changes.y : tokenD.y );
  const travelRay = new Ray(tokenCenter, tokenDestination);
  const travel = token._elevatedVision.travel = elevationForTokenTravel(token, travelRay,
    { tokenElevation: token.document.elevation });
  if ( !travel.autoElevation ) return;

  if ( tokenD.elevation !== travel.finalElevation ) changes.elevation = travel.finalElevation;
  tokenD.object._elevatedVision.tokenAdjustElevation = true;
});

Hooks.on("updateToken", function(tokenD, changes, _options, _userId) {
  const token = tokenD.object;
  log(`updateToken hook ${changes.x}, ${changes.y}, ${changes.elevation} at elevation ${token.document?.elevation} with elevationD ${tokenD.elevation}`, changes);

});


// Add settings for minimum and step elevation to the scene configuration.
Hooks.on("renderSceneConfig", injectSceneConfiguration);
async function injectSceneConfiguration(app, html, data) {
  util.log("injectSceneConfig", app, html, data);

  if ( typeof app.object.getFlag(MODULE_ID, "elevationmin") === "undefined" ) app.object.setFlag(MODULE_ID, "elevationmin", 0);
  if ( typeof app.object.getFlag(MODULE_ID, "elevationstep") === "undefined" ) app.object.setFlag(MODULE_ID, "elevationstep", canvas.dimensions.distance);
  if ( typeof app.object.getFlag(MODULE_ID, "enable") === "undefined" ) app.object.setFlag(MODULE_ID, "enable", true);

  const form = html.find(`input[name="initial.scale"]`).closest(".form-group");
  const snippet = await renderTemplate(`modules/${MODULE_ID}/templates/scene-elevation-config.html`, data);
  form.append(snippet);
  app.setPosition({ height: "auto" });
}

// Hook when a tile changes elevation.
// Track for Levels, to ensure minimum elevation for the scene is met.
Hooks.on("createTile", createTileHook);
Hooks.on("updateTile", updateTileHook);

function createTileHook(document, _options, _userId) {
  if ( !canvas.elevation?._initialized ) return;

  const elevationMin = canvas.elevation.elevationMin;
  const rangeBottom = document.flags?.levels?.rangeBottom ?? document.elevation ?? elevationMin;
  const rangeTop = document.flags?.levels?.rangeTop ?? document.elevation ?? elevationMin;
  const min = Math.min(rangeBottom, rangeTop);

  if ( min < elevationMin ) {
    canvas.elevation.elevationMin = min;
    ui.notifications.notify(`Elevated Vision: Scene elevation minimum set to ${min} based on tile minimum elevation range.`);
  }
}

function updateTileHook(document, change, _options, _userId) {
  if ( !canvas.elevation?._initialized ) return;

  const elevationMin = canvas.elevation.elevationMin;
  const rangeBottom = change.flags?.levels?.rangeBottom ?? document.elevation ?? elevationMin;
  const rangeTop = change.flags?.levels?.rangeTop ?? document.elevation ?? elevationMin;
  const min = Math.min(rangeBottom, rangeTop);

  if ( min < elevationMin ) {
    canvas.elevation.elevationMin = min;
    ui.notifications.notify(`Elevated Vision: Scene elevation minimum set to ${min} based on tile minimum elevation range.`);
  }
}

Hooks.on("renderAmbientLightConfig", renderAmbientLightConfigHook);
Hooks.on("renderAmbientSoundConfig", renderAmbientSoundConfigHook);
Hooks.on("renderTileConfig", renderTileConfigHook);

Hooks.on("getSceneControlButtons", controls => {
  if ( !canvas.scene || !getSetting(SETTINGS.FLY_BUTTON) || !getSceneSetting(SETTINGS.AUTO_ELEVATION) ) return;

  const tokenTools = controls.find(c => c.name === "token");
  tokenTools.tools.push(FLY_CONTROL);
});

/**
 * Update data for pull-down algorithm menu for the scene config.
 */
Hooks.on("renderSceneConfig", renderSceneConfigHook);

function renderSceneConfigHook(application, html, data) {
  util.log("SceneConfig", application, html, data);

  // Avoid name collisions by using "elevatedvision"
  const renderData = {};
  renderData[MODULE_ID] = { algorithms: SETTINGS.SHADING.LABELS };
  foundry.utils.mergeObject(data, renderData, {inplace: true});
}

/**
 * Monitor whether EV has been enabled or disabled for a scene.
 */
Hooks.on("updateScene", updateSceneHook);

async function updateSceneHook(document, change, _options, _userId) {
  const autoelevate = change.flags?.[MODULE_ID]?.[SETTINGS.AUTO_ELEVATION];
  if ( typeof autoelevate !== "undefined" ) {
    updateFlyTokenControl(autoelevate);
    if ( autoelevate === true ) ui.notifications.notify("Elevated Vision autoelevate enabled for scene.");
    else if ( autoelevate === false ) ui.notifications.notify("Elevated Vision autoelevate disabled for scene.");
  }

  const algorithm = change.flags?.[MODULE_ID]?.algorithm;
  if ( algorithm ) {
    registerShadowPatches();
    await canvas.draw(canvas.scene);
    const label = game.i18n.localize(SETTINGS.SHADING.LABELS[algorithm]);
    ui.notifications.notify(`Elevated Vision scene shadows switched to ${label}.`);
  }
}

function updateFlyTokenControl(enable) {
  enable ??= getSceneSetting(SETTINGS.AUTO_ELEVATION);
  const tokenTools = ui.controls.controls.find(c => c.name === "token");
  const flyIndex = tokenTools.tools.findIndex(b => b.name === SETTINGS.FLY_BUTTON);
  if ( enable && !~flyIndex ) tokenTools.tools.push(FLY_CONTROL);
  else if ( ~flyIndex ) tokenTools.tools.splice(flyIndex, 1);
  ui.controls.render(true)
}

