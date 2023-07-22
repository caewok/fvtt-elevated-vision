/* globals
Hooks,
game
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { SETTINGS, getSetting, setSetting } from "./settings.js";
const CHANGELOG = SETTINGS.CHANGELOG;

// From Perfect Vision
// https://github.com/dev7355608/perfect-vision/blob/cdf03ae7e4b5969efaee8e742bf9dd11d18ba8b7/scripts/changelog.js


Hooks.once("ready", () => {
    if (!game.user.isGM) {
        return;
    }

    game.settings.register(
        MODULE_ID,
        CHANGELOG,
        {
            scope: "client",
            config: false,
            type: Number,
            default: 0
        }
    );

    new ChangelogBuilder()
        .addEntry({
            version: "0.4.0",
            title: "Autoelevation and Scene Configuration",
            body: `\
                - **Autoelevation:** New methodology to automatically determine elevation. Tokens considered
                  *on-the-ground* if a terrain or tile is at or below the token, within the token's height.
                  Transparent tile portions are treated as holes. A token's elevation will be modified if
                  it starts *on-the-ground*. An optional *Fly* token control toggle overrides this---the token
                  will be treated as "flying" over valleys or terrain holes. Thus, tiles can be
                  used as bridges over valleys.
                - **Scene Configuration:** GM can now set auto-elevation and the shadow algorithm on a per-scene
                  basis, in the scene's configuration. The world settings now operate as default values for new scenes.
                - **Elevation Resolution:** Elevation data is saved, by default, at 25% of the scene size. It is also
                  limited to a maximum of 4096 pixels width/height (same as *Fog of War*). Should be faster and allow
                  *Elevated Vision* to work with larger scenes. When first loading a scene, the old scene elevation
                  data will be downloaded in case the conversion to lower resolution fails.
                - **Levels:** Elevation of basement tiles should now work regardless of the minimum elevation level for
                  the scene.`
        })

        .addEntry({
            version: "0.5.0",
            title: "FoundryVTT v11",
            body: `\
                - **Updated for v11:** Updated for FoundryVTT v11. If you need to fall back to v10, please use the
                  Elevated Vision v0.4 series.
                - **No WebGL:** WebGL shadows is not functional and so for now it will default back to Polygon shadows.
                  I will continue to work on a more robust implementation and intend to bring back lighting and
                  elevation shadows in a future update. I wanted to get this update out quickly because all of the
                  EV functionality appears to be working, just not the prettier visual shadows.`
        })

        .addEntry({
            version: "0.5.1",
            title: "Elevation data changes",
            body: `\
                - **Larger elevation range:** Elevation data is now stored in red and green channels of the
                  elevation image. This allows elevation to have 65,536 distinct values in a scene, for all the
                  mountaineers in your party!
                - **Elevation data storage:** Elevation data for each scene is now stored as a webp image in
                  worlds/[world-id]/assets/elevatedvision/[world-id][scene-id]-elevationMap.webp.`
        })

        .addEntry({
            version: "0.5.2",
            title: "Elevation colors",
            body: `\
                GM can define a minimum and maximum elevation color in settings. The coloration in the elevation layer
                will be interpolated between the two colors, based on the scene minimum and the current maximum elevation
                in the scene. Alpha (transparency) values will also be interpolated.

                Install the [Color Picker](https://foundryvtt.com/packages/color-picker) module to get
                a color picker for the minimum/maximum elevation settings.

                Any of you graphic experts out there, feel free to suggest improvements to how to best represent
                elevation gradients on a scene! Or share your preferred min/max color choices. There is an open
                comment on the Github page regarding "Multicolor height indicators." I will leave it open in case
                anyone has additional suggestions.`
        })

        .addEntry({
            version: "0.5.3",
            title: "WebGL shadows are back!",
            body: `\
                - **WebGL shadows:** The WebGL setting for elevation shadows is back! Pretty much rewritten
                  from scratch. WebGL shadows should be a lot more performant. Plus, the number of walls
                  it can consider when calculating shadows using the GPU is not longer limited.

                - **Elevation label on lights:** Heading says it all—--When in the lighting layer, lights
                  will display their current elevation.

                - **Token heights and prone status:** Token vision is (once again) based on token height.
                  The Wall Height module allows you to set this value or it can be auto-calculated.
                  When the prone status is enabled/disabled on a token, its height is decreased by two-thirds
                  (consistent with Wall Height) and the token vision shadows are updated to reflect
                  the new height.`
        })

        .addEntry({
            version: "0.5.5",
            title: "Directional lighting",
            body: `\
                - **Directional lighting:** In the lighting configuration, a new "Directional Light" checkbox
                  is available if you have WebGL shading selected for the scene. A directional light physically
                  models a distant light source, like the sun or moon. Dragging the light around the scene will
                  change its azimuth and elevation angle (closer to the center is higher elevation angle).

                  A directional light covers the entire scene with light, but respects walls. Try it with the Sunburst,
                  Star Light, or Smoke Patch animations!

                - **Shadow penumbra:** With WebGL shading, you now get shadow penumbra for all lights. These are physically
                  modeled penumbra based on the new light size property in the lighting configuration, which lets you
                  set how large of a sphere is modeled for the light. For limited height walls, the top and bottom
                  are also modeled. For directional lighting, solar angle changes how much penumbra will be present in the shadows.

                Apologies in advance for any bugs with these new changes! I intend to continue to iterate on the
                lighting shadows and also have some ideas for how to better incorporate terrain shadows.`
        })

        .build()
        ?.render(true);
});


/**
 * Display a dialog with changes; store changes as entries.
 */
class ChangelogBuilder {
    #entries = [];

    addEntry({ version, title = "", body }) {
        this.#entries.push({ version, title, body });

        return this;
    }

    build() {
        const converter = new showdown.Converter();
        const curr = getSetting(CHANGELOG);
        const next = this.#entries.length;
        let content = "";

        if (curr >= next) {
            return;
        }

        for (let [index, { version, title, body }] of this.#entries.entries()) {
            let entry = `<strong>v${version}</strong>${title ? ": " + title : ""}`;;

            if (index < curr) {
                entry = `<summary>${entry}</summary>`;
            } else {
                entry = `<h3>${entry}</h3>`;
            }

            let indentation = 0;

            while (body[indentation] === " ") indentation++;

            if (indentation) {
                body = body.replace(new RegExp(`^ {0,${indentation}}`, "gm"), "");
            }

            entry += converter.makeHtml(body);

            if (index < curr) {
                entry = `<details>${entry}</details><hr>`;
            } else if (index === curr) {
                entry += `<hr><hr>`;
            }

            content = entry + content;
        }

        return new Dialog({
            title: "Elevated Vision: Changelog",
            content,
            buttons: {
                view_documentation: {
                    icon: `<i class="fas fa-book"></i>`,
                    label: "View documentation",
                    callback: () => window.open("https://github.com/caewok/fvtt-elevated-vision/blob/master/README.md")
                },
                dont_show_again: {
                    icon: `<i class="fas fa-times"></i>`,
                    label: "Don't show again",
                    callback: () => setSetting(CHANGELOG, next)
                }
            },
            default: "dont_show_again"
        });
    }
}
