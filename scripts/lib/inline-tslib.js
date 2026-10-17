const TS_HELPERS = `
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.prototype.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
`.trimStart()

function inlineTslib() {
    return {
        name: 'inline-tslib',
        renderChunk(code) {
            if (!code.includes('require("tslib")') && !code.includes("require('tslib')")) {
                return null
            }

            const stripped = code
                .replace(/const tslib_1 = require\(["']tslib["']\);\n?/, '')
                .replace(/tslib_1\.(__importDefault|__importStar|__extends|__assign|__rest|__decorate|__param|__metadata|__awaiter|__generator|__exportStar|__createBinding|__values|__read|__spread|__spreadArrays|__spreadArray|__await|__asyncGenerator|__asyncDelegator|__asyncValues|__makeTemplateObject|__importDefault|__importStar|__classPrivateFieldGet|__classPrivateFieldSet|__classPrivateFieldIn)/g, '$1')

            if (stripped.startsWith("'use strict';\n") || stripped.startsWith('"use strict";\n')) {
                const end = stripped.indexOf('\n') + 1
                return stripped.slice(0, end) + TS_HELPERS + stripped.slice(end)
            }

            return TS_HELPERS + '\n' + stripped
        },
    }
}

module.exports = {
    inlineTslib,
}
