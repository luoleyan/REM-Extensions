const { ipcMain, BrowserWindow, screen, app } = require('electron')
const fs = require('fs')
const path = require('path')
const { requestLyrics } = require('./lyrics')

const WINDOW_WIDTH = 380
const WINDOW_HEIGHT = 164
const EXPANDED_WINDOW_HEIGHT = 392
const INITIAL_RIGHT_OFFSET = 4
const INITIAL_BOTTOM_OFFSET = 4
// 水平边缘更难精确拖到，单独放宽左右吸附范围；垂直方向保持较小范围，避免靠近任务栏时误吸附。
const HORIZONTAL_SNAP_DISTANCE = 96
const VERTICAL_SNAP_DISTANCE = 40
const SNAP_DEBOUNCE_MS = 120
const EDGE_TRIGGER_SIZE = 12
const EDGE_POLL_INTERVAL_MS = 180

let snapTimer
let snapWindow
let snapHandler
let hideTimer
let edgePollTimer
let isCollapsed = false
let expandedBounds
let contentExpanded = false
let contentPinned = false
let preferences = { keepExpanded: false, autoHideDelay: 800 }
let positionSaveTimer
let saveQueue = Promise.resolve()
let programmedBounds

function preferencesPath() {
    return path.join(app.getPath('userData'), 'Data', 'control-widget.json')
}

function readPreferences() {
    try {
        const value = JSON.parse(fs.readFileSync(preferencesPath(), 'utf8'))
        preferences = {
            keepExpanded: value.keepExpanded === true,
            autoHideDelay: [450, 800, 1400].includes(value.autoHideDelay) ? value.autoHideDelay : 800,
            position: Number.isFinite(value.position?.x) && Number.isFinite(value.position?.y)
                ? value.position : undefined,
        }
    } catch (error) {
        preferences = { keepExpanded: false, autoHideDelay: 800 }
        if (error.code !== 'ENOENT') console.warn('[control-widget] failed to read preferences:', error)
    }
}

function persistPreferences() {
    const filename = preferencesPath()
    const data = JSON.stringify(preferences)
    // 位置变化和偏好操作共用写入队列，临时文件替换避免中途退出留下半个 JSON。
    saveQueue = saveQueue.catch(() => {}).then(async () => {
        await fs.promises.mkdir(path.dirname(filename), { recursive: true })
        await fs.promises.writeFile(filename + '.tmp', data, 'utf8')
        await fs.promises.rename(filename + '.tmp', filename)
    })
    return saveQueue
}

function rememberPosition(bw) {
    if (bw.isDestroyed()) return
    const current = isCollapsed && expandedBounds ? expandedBounds : bw.getBounds()
    const bounds = contentExpanded ? getContentBounds(current, false) : current
    preferences.position = { x: bounds.x, y: bounds.y }
    clearTimeout(positionSaveTimer)
    positionSaveTimer = setTimeout(() => {
        void persistPreferences().catch(error => console.warn('[control-widget] failed to save position:', error))
    }, 600)
}

function setWindowBounds(bw, bounds) {
    programmedBounds = { ...bounds }
    bw.setBounds(bounds)
}

function getInitialBounds() {
    const { workArea } = screen.getPrimaryDisplay()
    const bounds = {
        x: preferences.position?.x ?? workArea.x + workArea.width - WINDOW_WIDTH - INITIAL_RIGHT_OFFSET,
        y: preferences.position?.y ?? workArea.y + workArea.height - WINDOW_HEIGHT - INITIAL_BOTTOM_OFFSET,
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
    }
    const target = getDisplayForBounds(bounds).workArea
    return {
        ...bounds,
        x: Math.round(Math.max(target.x, Math.min(bounds.x, target.x + target.width - bounds.width))),
        y: Math.round(Math.max(target.y, Math.min(bounds.y, target.y + target.height - bounds.height))),
    }
}

function getDisplayForBounds(bounds) {
    const displays = typeof screen.getAllDisplays === 'function'
        ? screen.getAllDisplays()
        : [screen.getPrimaryDisplay()]
    const center = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
    }

    const getIntersectionArea = workArea => {
        const left = Math.max(bounds.x, workArea.x)
        const top = Math.max(bounds.y, workArea.y)
        const right = Math.min(bounds.x + bounds.width, workArea.x + workArea.width)
        const bottom = Math.min(bounds.y + bounds.height, workArea.y + workArea.height)
        return Math.max(0, right - left) * Math.max(0, bottom - top)
    }

    const getDistanceToWorkArea = workArea => {
        const dx = bounds.x + bounds.width < workArea.x
            ? workArea.x - (bounds.x + bounds.width)
            : workArea.x + workArea.width < bounds.x
                ? bounds.x - (workArea.x + workArea.width)
                : 0
        const dy = bounds.y + bounds.height < workArea.y
            ? workArea.y - (bounds.y + bounds.height)
            : workArea.y + workArea.height < bounds.y
                ? bounds.y - (workArea.y + workArea.height)
                : 0
        return Math.hypot(dx, dy)
    }

    const rankedDisplays = displays
        .map(display => ({
            display,
            area: getIntersectionArea(display.workArea),
            distance: getDistanceToWorkArea(display.workArea),
            centerDistance: Math.hypot(
                center.x - (display.workArea.x + display.workArea.width / 2),
                center.y - (display.workArea.y + display.workArea.height / 2),
            ),
        }))
        .sort((left, right) => right.area - left.area || left.distance - right.distance || left.centerDistance - right.centerDistance)

    return rankedDisplays[0]?.display ?? screen.getPrimaryDisplay()
}

function snapStartToWorkArea(start, size, min, max, threshold) {
    const maxStart = max - size
    if (size >= max - min) return min
    if (start < min) return min
    if (start > maxStart) return maxStart
    if (start - min <= threshold) return min
    if (maxStart - start <= threshold) return maxStart
    return start
}

function snapBoundsToWorkArea(bounds) {
    const { workArea } = getDisplayForBounds(bounds)
    const right = workArea.x + workArea.width
    const bottom = workArea.y + workArea.height

    return {
        ...bounds,
        x: snapStartToWorkArea(bounds.x, bounds.width, workArea.x, right, HORIZONTAL_SNAP_DISTANCE),
        y: snapStartToWorkArea(bounds.y, bounds.height, workArea.y, bottom, VERTICAL_SNAP_DISTANCE),
    }
}

function getSnapDistance(edge) {
    return edge === 'left' || edge === 'right'
        ? HORIZONTAL_SNAP_DISTANCE
        : VERTICAL_SNAP_DISTANCE
}

function samePosition(left, right) {
    return left.x === right.x && left.y === right.y
}

function getContentBounds(bounds, expanded) {
    const { workArea } = getDisplayForBounds(bounds)
    const height = Math.min(expanded ? EXPANDED_WINDOW_HEIGHT : WINDOW_HEIGHT, workArea.height)
    const currentBottom = bounds.y + bounds.height
    const workAreaBottom = workArea.y + workArea.height
    const shouldAnchorBottom = currentBottom >= workAreaBottom - VERTICAL_SNAP_DISTANCE
    const preferredY = shouldAnchorBottom ? currentBottom - height : bounds.y
    const y = Math.min(
        workAreaBottom - height,
        Math.max(workArea.y, preferredY),
    )

    return {
        ...bounds,
        y,
        height,
    }
}

function setContentExpanded(bw, expanded) {
    if (bw.isDestroyed() || contentExpanded === expanded) return

    contentExpanded = expanded
    const current = bw.getBounds()
    const next = getContentBounds(current, expanded)
    if (current.y !== next.y || current.height !== next.height) {
        setWindowBounds(bw, next)
    }
}

function getNearestEdge(bounds) {
    const { workArea } = getDisplayForBounds(bounds)
    const right = workArea.x + workArea.width - bounds.width
    const bottom = workArea.y + workArea.height - bounds.height
    const distances = [
        { edge: 'left', distance: Math.abs(bounds.x - workArea.x) },
        { edge: 'right', distance: Math.abs(right - bounds.x) },
        { edge: 'top', distance: Math.abs(bounds.y - workArea.y) },
        { edge: 'bottom', distance: Math.abs(bottom - bounds.y) },
    ]

    return distances
        .sort((left, right) => left.distance - right.distance)[0]
}

function isPointInsideBounds(point, bounds) {
    return point.x >= bounds.x
        && point.x <= bounds.x + bounds.width
        && point.y >= bounds.y
        && point.y <= bounds.y + bounds.height
}

function clearHideTimer() {
    if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = undefined
    }
}

function clearEdgePollTimer() {
    if (edgePollTimer) {
        clearInterval(edgePollTimer)
        edgePollTimer = undefined
    }
}

function getCollapsedBounds(bounds, edge) {
    const { workArea } = getDisplayForBounds(bounds)
    const right = workArea.x + workArea.width
    const bottom = workArea.y + workArea.height

    if (edge === 'left') {
        return { x: workArea.x, y: bounds.y, width: EDGE_TRIGGER_SIZE, height: bounds.height }
    }
    if (edge === 'right') {
        return { x: right - EDGE_TRIGGER_SIZE, y: bounds.y, width: EDGE_TRIGGER_SIZE, height: bounds.height }
    }
    if (edge === 'top') {
        return { x: bounds.x, y: workArea.y, width: bounds.width, height: EDGE_TRIGGER_SIZE }
    }

    return { x: bounds.x, y: bottom - EDGE_TRIGGER_SIZE, width: bounds.width, height: EDGE_TRIGGER_SIZE }
}

function expandWindow(bw) {
    if (bw.isDestroyed() || !isCollapsed || !expandedBounds) return

    clearEdgePollTimer()
    isCollapsed = false
    const bounds = expandedBounds
    expandedBounds = undefined
    setWindowBounds(bw, bounds)
}

function collapseWindow(bw, bounds, edge) {
    if (bw.isDestroyed() || isCollapsed) return

    clearHideTimer()
    // 收起只保留基础窗口尺寸，避免歌单展开状态被保存到边缘触发区。
    expandedBounds = contentExpanded ? getContentBounds(bounds, false) : { ...bounds }
    isCollapsed = true
    setWindowBounds(bw, getCollapsedBounds(bounds, edge))

    clearEdgePollTimer()
    edgePollTimer = setInterval(() => {
        if (bw.isDestroyed() || !isCollapsed || !expandedBounds) return

        const point = screen.getCursorScreenPoint()
        const collapsedBounds = bw.getBounds()
        if (isPointInsideBounds(point, collapsedBounds)) {
            expandWindow(bw)
        }
    }, EDGE_POLL_INTERVAL_MS)
}

/**
 * @param {BrowserWindow} bw
 */
exports.onReady = bw => {
    readPreferences()
    isCollapsed = false
    expandedBounds = undefined
    contentExpanded = false
    contentPinned = false
    bw.setAlwaysOnTop(true, 'screen-saver')
    bw.setVisibleOnAllWorkspaces(true)

    setWindowBounds(bw, getInitialBounds())

    const scheduleAutoHide = () => {
        clearHideTimer()
        if (contentPinned || preferences.keepExpanded) return
        hideTimer = setTimeout(() => {
            hideTimer = undefined
            if (bw.isDestroyed() || isCollapsed || contentPinned || preferences.keepExpanded) return

            const current = bw.getBounds()
            const point = screen.getCursorScreenPoint()
            if (isPointInsideBounds(point, current)) {
                scheduleAutoHide()
                return
            }

            const nearest = getNearestEdge(current)
            if (nearest.distance <= getSnapDistance(nearest.edge)) {
                collapseWindow(bw, current, nearest.edge)
            }
        }, preferences.autoHideDelay)
    }

    const scheduleSnap = (force = false) => {
        // 展开歌单、贴边收起和恢复位置不应被当作用户拖动，再次触发吸附。
        const bounds = bw.getBounds()
        if (force !== true && programmedBounds && samePosition(bounds, programmedBounds)
            && bounds.width === programmedBounds.width && bounds.height === programmedBounds.height) return
        clearHideTimer()
        if (snapTimer) clearTimeout(snapTimer)
        snapTimer = setTimeout(() => {
            snapTimer = undefined
            if (bw.isDestroyed()) return

            const current = bw.getBounds()
            const snapped = snapBoundsToWorkArea(current)
            if (!samePosition(current, snapped)) {
                bw.setPosition(snapped.x, snapped.y)
            }
            rememberPosition(bw)

            const nearest = getNearestEdge(snapped)
            if (nearest.distance <= getSnapDistance(nearest.edge)) {
                scheduleAutoHide()
            }
        }, SNAP_DEBOUNCE_MS)
    }

    snapWindow = bw
    snapHandler = scheduleSnap
    bw.on('moved', scheduleSnap)

    const onDisplayChange = () => {
        if (bw.isDestroyed()) return

        if (isCollapsed && expandedBounds) {
            const nextBounds = snapBoundsToWorkArea(expandedBounds)
            expandedBounds = nextBounds
            const edge = getNearestEdge(nextBounds).edge
            setWindowBounds(bw, getCollapsedBounds(nextBounds, edge))
            return
        }

        scheduleSnap(true)
    }
    screen.on?.('display-metrics-changed', onDisplayChange)
    screen.on?.('display-added', onDisplayChange)
    screen.on?.('display-removed', onDisplayChange)
    bw._controlWidgetDisplayChange = onDisplayChange

    const onMouseEnter = event => {
        if (event.sender !== bw.webContents) return
        clearHideTimer()
        expandWindow(bw)
    }
    const onMouseLeave = event => {
        if (event.sender !== bw.webContents) return
        scheduleAutoHide()
    }

    ipcMain.on('control-widget:mouseenter', onMouseEnter)
    ipcMain.on('control-widget:mouseleave', onMouseLeave)
    bw._controlWidgetMouseEnter = onMouseEnter
    bw._controlWidgetMouseLeave = onMouseLeave

    const onContentExpanded = (event, expanded) => {
        if (event.sender !== bw.webContents) return
        setContentExpanded(bw, Boolean(expanded))
    }

    const onContentPinned = (event, pinned) => {
        if (event.sender !== bw.webContents) return
        contentPinned = Boolean(pinned)
        if (contentPinned) {
            clearHideTimer()
            return
        }

        scheduleAutoHide()
    }

    ipcMain.on('control-widget:content-expanded', onContentExpanded)
    ipcMain.on('control-widget:content-pinned', onContentPinned)
    bw._controlWidgetContentExpanded = onContentExpanded
    bw._controlWidgetContentPinned = onContentPinned

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
    ipcMain.handle('control-widget:lyrics', (event, audioId) => {
        if (event.sender !== bw.webContents) throw new Error('歌词请求来源无效')
        return requestLyrics(audioId)
    })
    const requireWindow = event => {
        if (event.sender !== bw.webContents) throw new Error('控件请求来源无效')
    }
    ipcMain.handle('control-widget:preferences', event => {
        requireWindow(event)
        return { keepExpanded: preferences.keepExpanded, autoHideDelay: preferences.autoHideDelay }
    })
    ipcMain.handle('control-widget:preferences-save', async (event, value) => {
        requireWindow(event)
        const previous = { keepExpanded: preferences.keepExpanded, autoHideDelay: preferences.autoHideDelay }
        preferences.keepExpanded = value?.keepExpanded === true
        preferences.autoHideDelay = [450, 800, 1400].includes(value?.autoHideDelay) ? value.autoHideDelay : 800
        try {
            await persistPreferences()
        } catch (error) {
            Object.assign(preferences, previous)
            throw error
        }
        if (preferences.keepExpanded) {
            clearHideTimer()
            expandWindow(bw)
        } else scheduleAutoHide()
        return { keepExpanded: preferences.keepExpanded, autoHideDelay: preferences.autoHideDelay }
    })
    ipcMain.handle('control-widget:reset-position', event => {
        requireWindow(event)
        clearHideTimer()
        expandWindow(bw)
        preferences.position = undefined
        let bounds = getInitialBounds()
        if (contentExpanded) bounds = getContentBounds(bounds, true)
        setWindowBounds(bw, bounds)
        rememberPosition(bw)
    })
    bw.on('close', restoreWindows)
}

exports.onClose = bw => {
    rememberPosition(bw)
    clearTimeout(positionSaveTimer)
    void persistPreferences().catch(error => console.warn('[control-widget] failed to save preferences:', error))
    if (snapTimer) clearTimeout(snapTimer)
    clearHideTimer()
    clearEdgePollTimer()
    if (snapWindow && snapHandler) snapWindow.removeListener('moved', snapHandler)
    if (bw._controlWidgetMouseEnter) {
        ipcMain.removeListener('control-widget:mouseenter', bw._controlWidgetMouseEnter)
    }
    if (bw._controlWidgetMouseLeave) {
        ipcMain.removeListener('control-widget:mouseleave', bw._controlWidgetMouseLeave)
    }
    if (bw._controlWidgetContentExpanded) {
        ipcMain.removeListener('control-widget:content-expanded', bw._controlWidgetContentExpanded)
    }
    if (bw._controlWidgetContentPinned) {
        ipcMain.removeListener('control-widget:content-pinned', bw._controlWidgetContentPinned)
    }
    if (bw._controlWidgetDisplayChange) {
        screen.removeListener?.('display-metrics-changed', bw._controlWidgetDisplayChange)
        screen.removeListener?.('display-added', bw._controlWidgetDisplayChange)
        screen.removeListener?.('display-removed', bw._controlWidgetDisplayChange)
    }
    snapWindow = undefined
    snapHandler = undefined
    isCollapsed = false
    expandedBounds = undefined
    contentExpanded = false
    contentPinned = false
    programmedBounds = undefined
    ipcMain.removeHandler('win:restore')
    ipcMain.removeHandler('control-widget:lyrics')
    ipcMain.removeHandler('control-widget:preferences')
    ipcMain.removeHandler('control-widget:preferences-save')
    ipcMain.removeHandler('control-widget:reset-position')
}
