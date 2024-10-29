const { ipcMain, BrowserWindow, screen } = require('electron')
const { width, height } = screen.getPrimaryDisplay().bounds

/**
 * @param {BrowserWindow} bw
 */
exports.onReady = bw => {
    bw.setAlwaysOnTop(true, 'screen-saver')
    bw.setVisibleOnAllWorkspaces(true)

    bw.setBounds({
        x: width - 384,
        y: height - 192
    })

    function restoreWindows() {
        bw.hide()
        BrowserWindow.getAllWindows().forEach(w => {
            if (w.id === bw.id) {
                w.hide()
            } else {
                w.show()
            }
        })
    }

    ipcMain.handle('win:restore', restoreWindows)
    bw.on('close', restoreWindows)
}

exports.onClose = () => {
    ipcMain.removeHandler('win:restore')
}