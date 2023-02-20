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
                  data will be downloaded in case the conversion to lower resolution fails.`
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
