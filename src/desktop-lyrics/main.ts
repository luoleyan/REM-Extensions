import { BrowserWindow, screen, ipcMain } from "electron"

const { width, height } = screen.getPrimaryDisplay().bounds
const WINDOW_WIDTH_MIN = 320
const WINDOW_WIDTH_MAX = 1920
const WINDOW_HEIGHT_MIN = 60
const WINDOW_HEIGHT_MAX = 600

export function onReady(bw: BrowserWindow) {
    let manualSized = false

    const clampWindowSize = (w: number, h: number) => ({
        width: Math.min(WINDOW_WIDTH_MAX, Math.max(WINDOW_WIDTH_MIN, Math.round(w))),
        height: Math.min(WINDOW_HEIGHT_MAX, Math.max(WINDOW_HEIGHT_MIN, Math.round(h))),
    })

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
        if (manualSized) {
            return
        }

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

    ipcMain.on('desktop-lyrics-set-size', (_, nextWidth: number, nextHeight: number) => {
        if (
            typeof nextWidth !== 'number'
            || typeof nextHeight !== 'number'
            || !Number.isFinite(nextWidth)
            || !Number.isFinite(nextHeight)
        ) {
            return
        }

        const bounds = bw.getBounds()
        const next = clampWindowSize(nextWidth, nextHeight)
        manualSized = true
        bw.setBounds({
            ...bounds,
            width: next.width,
            height: next.height,
        })
    })

    ipcMain.on('desktop-lyrics-size-mode', (_, manualMode: boolean) => {
        if (typeof manualMode === 'boolean') {
            manualSized = manualMode
        }
    })
}

export function onClose() {
    ipcMain.removeHandler('desktop-lyrics-lock')
    ipcMain.removeAllListeners('desktop-lyrics-resize')
    ipcMain.removeAllListeners('desktop-lyrics-set-size')
    ipcMain.removeAllListeners('desktop-lyrics-size-mode')
}
