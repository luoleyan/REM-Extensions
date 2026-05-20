import { BrowserWindow, screen, ipcMain } from "electron"

const { width, height } = screen.getPrimaryDisplay().bounds

export function onReady(bw: BrowserWindow) {
    bw.setAlwaysOnTop(true, 'screen-saver')
    bw.setVisibleOnAllWorkspaces(true)
    bw.setBounds({
        x: width / 2 - 360,
        y: height - 140
    })
    bw.setIgnoreMouseEvents(true)
    bw.show()

    ipcMain.handle('desktop-lyrics-lock', (_, setTo) => {
        if (typeof setTo === 'boolean') {
            return bw.setIgnoreMouseEvents(setTo)
        }
    })

    ipcMain.on('desktop-lyrics-resize', (_, contentHeight: number) => {
        if (typeof contentHeight !== 'number' || !Number.isFinite(contentHeight)) {
            return
        }

        const bounds = bw.getBounds()
        if (Math.abs(bounds.height - contentHeight) <= 5) {
            return
        }

        bw.setBounds({
            ...bounds,
            height: Math.ceil(contentHeight),
        })
    })
}

export function onClose() {
    ipcMain.removeHandler('desktop-lyrics-lock')
    ipcMain.removeAllListeners('desktop-lyrics-resize')
}
