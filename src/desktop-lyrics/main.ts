import { BrowserWindow, screen, ipcMain, app, dialog } from "electron"
import fs from "node:fs"
import path from "node:path"

interface HitRegion {
    x: number
    y: number
    width: number
    height: number
}

let hoverTimer: ReturnType<typeof setInterval> | undefined

const FONT_FILE_SIZE_LIMIT = 25 * 1024 * 1024
const MIN_WINDOW_HEIGHT = 320
const INITIAL_WINDOW_HEIGHT = 320
const SETTINGS_WINDOW_HEIGHT = 320

function fontMimeType(filePath: string) {
    switch (path.extname(filePath).toLowerCase()) {
        case '.woff': return 'font/woff'
        case '.woff2': return 'font/woff2'
        case '.ttf': return 'font/ttf'
        case '.otf': return 'font/otf'
        default: return 'application/octet-stream'
    }
}

function readFontFile(filePath: string) {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) throw new Error('字体文件不是普通文件')
    if (stat.size > FONT_FILE_SIZE_LIMIT) throw new Error('字体文件超过 25 MB 限制')
    const data = fs.readFileSync(filePath).toString('base64')
    return {
        path: filePath,
        name: path.basename(filePath, path.extname(filePath)),
        dataUrl: `data:${fontMimeType(filePath)};base64,${data}`,
    }
}

interface SavedBounds {
    x: number
    y: number
    width: number
    height: number
}

type WindowBounds = SavedBounds

function displayForPoint(point: { x: number, y: number }) {
    if (typeof screen.getDisplayNearestPoint === 'function') return screen.getDisplayNearestPoint(point)
    return screen.getAllDisplays().find(({ workArea }) =>
        point.x >= workArea.x && point.x < workArea.x + workArea.width &&
        point.y >= workArea.y && point.y < workArea.y + workArea.height
    ) ?? screen.getPrimaryDisplay()
}

function displayForBounds(bounds: Pick<WindowBounds, 'x' | 'y' | 'width' | 'height'>) {
    return displayForPoint({
        x: Math.round(bounds.x + bounds.width / 2),
        y: Math.round(bounds.y + bounds.height / 2),
    })
}

function clampBoundsToWorkArea(bounds: WindowBounds, workArea: Electron.Rectangle): WindowBounds {
    const width = Math.min(Math.max(1, bounds.width), workArea.width)
    const height = Math.min(Math.max(1, bounds.height), workArea.height)
    return {
        width,
        height,
        x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width)),
        y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height)),
    }
}

function clampBoundsToDisplay(bounds: WindowBounds, display = displayForBounds(bounds)) {
    return clampBoundsToWorkArea(bounds, display.workArea)
}

function isWindowDestroyed(bw: BrowserWindow) {
    return typeof bw.isDestroyed === 'function' && bw.isDestroyed()
}

// 插件窗口重新启用时保留上一次拖动的位置；若显示器已不存在则回退到主屏。
let savedBounds: SavedBounds | undefined
let boundsLoaded = false

function boundsFile() {
    return path.join(app.getPath('userData'), 'Data', 'desktop-lyrics-bounds.json')
}

function loadSavedBounds() {
    if (boundsLoaded) return
    boundsLoaded = true
    try {
        const value = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'))
        if ([value.x, value.y, value.width, value.height].every(Number.isFinite)) savedBounds = value
    } catch {
        // 首次使用或旧版本没有位置文件时使用默认位置。
    }
}

function saveBounds(value: SavedBounds) {
    savedBounds = value
    try {
        const file = boundsFile()
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(value))
    } catch (error) {
        console.error('[desktop-lyrics] failed to save window position:', error)
    }
}

function getInitialBounds() {
    const primary = screen.getPrimaryDisplay()
    const { x, y, width, height } = primary.workArea
    const defaultWidth = Math.min(1180, Math.max(480, width - 40))
    const defaultHeight = Math.min(INITIAL_WINDOW_HEIGHT, Math.max(MIN_WINDOW_HEIGHT, height - 40))
    if (!savedBounds) {
        return clampBoundsToWorkArea({
            x: Math.round(x + (width - defaultWidth) / 2),
            y: y + height - defaultHeight - 20,
            width: defaultWidth,
            height: defaultHeight,
        }, primary.workArea)
    }

    const display = screen.getAllDisplays().find(({ workArea }) =>
        savedBounds!.x < workArea.x + workArea.width &&
        savedBounds!.x + savedBounds!.width > workArea.x &&
        savedBounds!.y < workArea.y + workArea.height &&
        savedBounds!.y + savedBounds!.height > workArea.y
    )
    if (!display) {
        return clampBoundsToWorkArea({
            x: Math.round(x + (width - defaultWidth) / 2),
            y: y + height - defaultHeight - 20,
            width: defaultWidth,
            height: defaultHeight,
        }, primary.workArea)
    }

    const area = display.workArea
    const windowWidth = Math.min(savedBounds.width, Math.max(480, area.width - 40))
    const availableHeight = Math.max(MIN_WINDOW_HEIGHT, area.height - 40)
    const windowHeight = Math.min(SETTINGS_WINDOW_HEIGHT, availableHeight)
    const adjustedY = savedBounds.y - Math.round((windowHeight - savedBounds.height) / 2)
    return clampBoundsToWorkArea({
        x: Math.max(area.x, Math.min(savedBounds.x, area.x + area.width - windowWidth)),
        y: Math.max(area.y, Math.min(adjustedY, area.y + area.height - windowHeight)),
        width: windowWidth,
        height: windowHeight,
    }, area)
}

export function onReady(bw: BrowserWindow) {
    loadSavedBounds()
    const initialBounds = getInitialBounds()
    bw.setBounds(initialBounds)
    bw.setAlwaysOnTop(true, 'screen-saver')
    bw.setVisibleOnAllWorkspaces(true)

    const keepWindowInWorkArea = () => {
        if (isWindowDestroyed(bw)) return
        const nextBounds = clampBoundsToDisplay(bw.getBounds())
        const currentBounds = bw.getBounds()
        if (currentBounds.x !== nextBounds.x || currentBounds.y !== nextBounds.y ||
            currentBounds.width !== nextBounds.width || currentBounds.height !== nextBounds.height) {
            bw.setBounds(nextBounds)
        }
    }
    const onDisplayMetricsChanged = () => keepWindowInWorkArea()
    const onDisplayAdded = () => keepWindowInWorkArea()
    const onDisplayRemoved = () => keepWindowInWorkArea()
    screen.on?.('display-metrics-changed', onDisplayMetricsChanged)
    screen.on?.('display-added', onDisplayAdded)
    screen.on?.('display-removed', onDisplayRemoved)
    let locked = true
    let clickToSeek = false
    let mouseInteractive = false
    let hovering = false
    let regions: { lyrics: HitRegion, controls: HitRegion, viewport: { width: number, height: number } } | null = null
    let dragStart: {
        cursor: { x: number, y: number },
        lastCursor: { x: number, y: number },
        bounds: { x: number, y: number, width: number, height: number }
    } | null = null
    const updateMouseAccess = () => bw.setIgnoreMouseEvents(!mouseInteractive)
    const updatePointerState = () => {
        let nextHover = false
        let nextInteractive = dragStart !== null
        if (regions) {
            const cursor = screen.getCursorScreenPoint()
            const bounds = bw.getContentBounds()
            const x = (cursor.x - bounds.x) * regions.viewport.width / bounds.width
            const y = (cursor.y - bounds.y) * regions.viewport.height / bounds.height
            const inside = (region: HitRegion) => x >= region.x && x <= region.x + region.width &&
                y >= region.y && y <= region.y + region.height
            const insideLyrics = inside(regions.lyrics)
            const insideControls = inside(regions.controls)
            nextHover = insideLyrics || insideControls
            nextInteractive ||= insideControls || (insideLyrics && (!locked || clickToSeek))
        }
        if (hovering !== nextHover) {
            hovering = nextHover
            bw.webContents.send('desktop-lyrics-hover', hovering)
        }
        if (mouseInteractive !== nextInteractive) {
            mouseInteractive = nextInteractive
            updateMouseAccess()
        }
    }
    updateMouseAccess()

    ipcMain.handle('desktop-lyrics-lock', (event, setTo) => {
        if (event.sender === bw.webContents && typeof setTo === 'boolean') {
            locked = setTo
            if (locked) dragStart = null
            updatePointerState()
            updateMouseAccess()
            bw.webContents.send('desktop-lyrics-hover', hovering)
        }
    })

    ipcMain.handle('desktop-lyrics-click-to-seek', (event, setTo) => {
        if (event.sender === bw.webContents && typeof setTo === 'boolean') {
            clickToSeek = setTo
            updatePointerState()
            updateMouseAccess()
        }
    })

    ipcMain.on('desktop-lyrics-window-size', (event, value) => {
        if (event.sender !== bw.webContents || !value || typeof value !== 'object') return
        const requestedHeight = Number((value as { height?: unknown }).height)
        if (!Number.isFinite(requestedHeight)) return

        const currentBounds = bw.getBounds()
        const display = displayForBounds(currentBounds)
        const height = Math.min(
            display.workArea.height,
            Math.max(MIN_WINDOW_HEIGHT, Math.ceil(requestedHeight)),
        )
        if (currentBounds.height === height) return

        // 高度变化时保持窗口中心，让歌词内容在内容确实变高时不发生跳动。
        const nextBounds = clampBoundsToWorkArea({
            ...currentBounds,
            y: Math.round(currentBounds.y - (height - currentBounds.height) / 2),
            height,
        }, display.workArea)
        bw.setBounds(nextBounds)
    })

    ipcMain.handle('desktop-lyrics-import-font', async event => {
        if (event.sender !== bw.webContents) return null
        const result = await dialog.showOpenDialog(bw, {
            title: '导入歌词字体',
            properties: ['openFile'],
            filters: [{ name: '字体文件', extensions: ['woff2', 'woff', 'ttf', 'otf'] }],
        })
        if (result.canceled || !result.filePaths[0]) return null
        try {
            return readFontFile(result.filePaths[0])
        } catch (error) {
            console.error('[desktop-lyrics] failed to import font:', error)
            throw error
        }
    })

    ipcMain.handle('desktop-lyrics-load-font', (event, filePath) => {
        if (event.sender !== bw.webContents || typeof filePath !== 'string' || !filePath.trim()) return null
        try {
            return readFontFile(filePath)
        } catch (error) {
            console.warn('[desktop-lyrics] failed to restore imported font:', error)
            return null
        }
    })

    ipcMain.on('desktop-lyrics-regions', (event, value) => {
        if (event.sender !== bw.webContents) return
        regions = value
        updatePointerState()
    })
    // 穿透时 Windows 可能不转发移动事件；定时按屏幕坐标切换歌词区域的命中状态。
    hoverTimer = setInterval(updatePointerState, 50)

    ipcMain.on('desktop-lyrics-drag', (event, action) => {
        if (event.sender !== bw.webContents) return
        if (action === 'start' && !locked) {
            const cursor = screen.getCursorScreenPoint()
            dragStart = { cursor, lastCursor: cursor, bounds: bw.getBounds() }
            updatePointerState()
        } else if (action === 'move' && dragStart && !locked) {
            const cursor = screen.getCursorScreenPoint()
            // 窗口移动也会触发 pointermove，静止光标不能再次定位，否则缩放取整会累积到窗口尺寸。
            if (cursor.x === dragStart.lastCursor.x && cursor.y === dragStart.lastCursor.y) return
            dragStart.lastCursor = cursor
            const nextBounds = clampBoundsToWorkArea({
                x: dragStart.bounds.x + cursor.x - dragStart.cursor.x,
                y: dragStart.bounds.y + cursor.y - dragStart.cursor.y,
                width: dragStart.bounds.width,
                height: dragStart.bounds.height,
            }, displayForPoint(cursor).workArea)
            bw.setBounds(nextBounds)
        } else if (action === 'end') {
            dragStart = null
            keepWindowInWorkArea()
            saveBounds(clampBoundsToDisplay(bw.getBounds()))
            updatePointerState()
        }
    })

    bw.on?.('moved', keepWindowInWorkArea)
    bw.on?.('resize', keepWindowInWorkArea)

    ;(bw as BrowserWindow & { __desktopLyricsCleanup?: () => void }).__desktopLyricsCleanup = () => {
        screen.removeListener?.('display-metrics-changed', onDisplayMetricsChanged)
        screen.removeListener?.('display-added', onDisplayAdded)
        screen.removeListener?.('display-removed', onDisplayRemoved)
        bw.removeListener?.('moved', keepWindowInWorkArea)
        bw.removeListener?.('resize', keepWindowInWorkArea)
    }
}

export function onClose(bw?: BrowserWindow) {
    if (bw && !isWindowDestroyed(bw)) {
        const lyricsWindow = bw as BrowserWindow & { __desktopLyricsCleanup?: () => void }
        lyricsWindow.__desktopLyricsCleanup?.()
        saveBounds(clampBoundsToDisplay(bw.getBounds()))
    }
    clearInterval(hoverTimer)
    ipcMain.removeHandler('desktop-lyrics-lock')
    ipcMain.removeHandler('desktop-lyrics-click-to-seek')
    ipcMain.removeHandler('desktop-lyrics-import-font')
    ipcMain.removeHandler('desktop-lyrics-load-font')
    ipcMain.removeAllListeners('desktop-lyrics-drag')
    ipcMain.removeAllListeners('desktop-lyrics-window-size')
    ipcMain.removeAllListeners('desktop-lyrics-regions')
}
