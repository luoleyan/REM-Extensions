'use strict';

Object.defineProperty(exports, "__esModule", { value: true });
exports.onReady = onReady;
exports.onClose = onClose;
const electron_1 = require("electron");
const { width, height } = electron_1.screen.getPrimaryDisplay().bounds;
function onReady(bw) {
    bw.setAlwaysOnTop(true, 'screen-saver');
    bw.setVisibleOnAllWorkspaces(true);
    bw.setBounds({
        x: width / 2 - 360,
        y: height - 140
    });
    bw.setIgnoreMouseEvents(true);
    electron_1.ipcMain.handle('desktop-lyrics-lock', (_, setTo) => {
        if (typeof setTo === 'boolean') {
            return bw.setIgnoreMouseEvents(setTo);
        }
    });
}
function onClose() {
    electron_1.ipcMain.removeHandler('desktop-lyrics-lock');
}
