// From https://github.com/dev7355608/perfect-vision/blob/6e05503fcbe9de5a1dedb89389c366b14427ac7a/scripts/core/visibility.js#L244

import { StencilMask } from "./stencil-mask.js";

export class GraphicsStencilMask extends StencilMask {
    constructor() {
        super();

        this._graphics = this.addChild(new PIXI.LegacyGraphics());
        this._graphics.elevation = Infinity;
        this._graphics.sort = Infinity;
    }

    get currentPath() {
        return this._graphics.currentPath;
    }

    get fill() {
        return this._graphics.fill;
    }

    get geometry() {
        return this._graphics.geometry;
    }

    get line() {
        return this._graphics.line;
    }
}

for (const method of [
    "arc",
    "arcTo",
    "beginFill",
    "beginHole",
    "beginTextureFill",
    "bezierCurveTo",
    "clear",
    "closePath",
    "drawChamferRect",
    "drawCircle",
    "drawEllipse",
    "drawFilletRect",
    "drawPolygon",
    "drawRect",
    "drawRegularPolygon",
    "drawRoundedPolygon",
    "drawRoundedRect",
    "drawShape",
    "drawStar",
    "drawTorus",
    "endFill",
    "endHole",
    "lineStyle",
    "lineTextureStyle",
    "lineTo",
    "moveTo",
    "quadraticCurveTo",
    "setMatrix",
    "finishPoly",
    "startPoly"
]) {
    GraphicsStencilMask.prototype[method] = function () {
        return this._graphics[method].apply(this._graphics, arguments);
    };
}