const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const { EventEmitter } = require('node:events')

const source = readFileSync(path.join(__dirname, '../src/control-widget/lyrics.js'), 'utf8')

function loadService(lyricNew, appPath, immediateTimeout = false) {
    const calls = []
    const context = vm.createContext({
        module: { exports: {} },
        setTimeout: (callback, delay) => setTimeout(callback, immediateTimeout ? 1 : delay),
        clearTimeout,
        require(name) {
            if (name === 'electron') return { app: { getAppPath: () => appPath } }
            if (name === 'node:path') return path
            assert.equal(name, 'node:module')
            return { createRequire(filename) {
                calls.push(filename)
                return dependency => {
                    assert.equal(dependency, 'NeteaseCloudMusicApi')
                    return { lyric_new: lyricNew }
                }
            } }
        },
    })
    vm.runInContext(source, context)
    return { requestLyrics: context.module.exports.requestLyrics, calls }
}

test('开发版和安装版均按宿主应用路径加载歌词依赖', async () => {
    for (const appPath of ['C:/REM', 'C:/Program Files/rem/resources/app.asar']) {
        const body = { code: 200, lrc: { lyric: '[00:01.00]歌词' } }
        const service = loadService(async query => {
            assert.equal(query.id, '167870')
            return { status: 200, body }
        }, appPath)
        assert.equal(await service.requestLyrics(167870), body)
        assert.deepEqual(service.calls, [path.join(appPath, 'package.json')])
    }
})

test('HTTP错误、业务错误和缺失响应均抛出失败', async () => {
    for (const response of [undefined, { status: 500 }, { status: 200 }, { status: 200, body: { code: 500 } }]) {
        const service = loadService(async () => response, 'C:/REM')
        await assert.rejects(service.requestLyrics('1'), /歌词接口/)
    }
})

test('网络拒绝和长时间无响应都会结束加载', async () => {
    const failed = loadService(async () => { throw new Error('网络错误') }, 'C:/REM')
    await assert.rejects(failed.requestLyrics('1'), /网络错误/)
    const stalled = loadService(() => new Promise(() => {}), 'C:/REM', true)
    await assert.rejects(stalled.requestLyrics('1'), /歌词请求超时/)
})

function mountWindow(saved, displays = [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]) {
    const handlers = new Map()
    const ipcMain = Object.assign(new EventEmitter(), {
        handle: (channel, handler) => handlers.set(channel, handler),
        removeHandler: channel => handlers.delete(channel),
    })
    const screen = Object.assign(new EventEmitter(), {
        getPrimaryDisplay: () => displays[0], getAllDisplays: () => displays,
        getCursorScreenPoint: () => ({ x: -10000, y: -10000 }),
    })
    let bounds = { x: 100, y: 100, width: 380, height: 164 }
    const writes = []
    const timers = new Map()
    let timerId = 0
    const mockFs = {
        readFileSync() {
            if (!saved) throw Object.assign(new Error('不存在'), { code: 'ENOENT' })
            return JSON.stringify(saved)
        },
        promises: { mkdir: async () => {}, writeFile: async (file, data) => { writes.push(JSON.parse(data)) }, rename: async () => {} },
    }
    const bw = Object.assign(new EventEmitter(), {
        webContents: {}, setAlwaysOnTop() {}, setVisibleOnAllWorkspaces() {},
        isDestroyed: () => false, getBounds: () => ({ ...bounds }),
        setBounds(next) { bounds = { ...next }; bw.emit('moved') },
        setPosition(x, y) { bounds = { ...bounds, x, y }; bw.emit('moved') },
    })
    const context = vm.createContext({
        exports: {}, console: { warn() {} },
        setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id },
        clearTimeout: id => timers.delete(id), setInterval: () => ++timerId, clearInterval() {},
        require(name) {
            if (name === 'electron') return { ipcMain, screen, BrowserWindow: {}, app: { getPath: () => 'C:/test-rem' } }
            if (name === 'fs') return mockFs
            if (name === 'path') return path
            assert.equal(name, './lyrics')
            return { requestLyrics: async id => ({ id }) }
        },
    })
    vm.runInContext(readFileSync(path.join(__dirname, '../src/control-widget/main.js'), 'utf8'), context)
    context.exports.onReady(bw)
    return {
        bw, ipcMain, screen, writes, handlers,
        invoke: (channel, value) => handlers.get(channel)({ sender: bw.webContents }, value),
        emit: (channel, value) => ipcMain.emit(channel, { sender: bw.webContents }, value),
        tick(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback() } },
        flush: () => vm.runInContext('saveQueue', context),
        async close() { context.exports.onClose(bw); await vm.runInContext('saveQueue', context) },
    }
}

test('IPC只接收控件窗口请求，关闭后移除全部控件接口', async () => {
    const window = mountWindow()
    assert.equal((await window.invoke('control-widget:lyrics', '167870')).id, '167870')
    for (const channel of ['control-widget:lyrics', 'control-widget:preferences', 'control-widget:preferences-save', 'control-widget:reset-position']) {
        await assert.rejects(async () => window.handlers.get(channel)({ sender: {} }), /来源无效/)
    }
    await window.close()
    assert.equal(window.handlers.has('control-widget:lyrics'), false)
    assert.equal(window.handlers.has('control-widget:preferences-save'), false)
})

test('窗口恢复保存的位置，显示器移除后限制到现有工作区', async () => {
    const normal = mountWindow({ position: { x: 300, y: 400 }, keepExpanded: true, autoHideDelay: 1400 })
    assert.equal(normal.bw.getBounds().x, 300)
    assert.equal(normal.bw.getBounds().y, 400)
    assert.equal(normal.invoke('control-widget:preferences').keepExpanded, true)
    await normal.close()
    const removed = mountWindow({ position: { x: 4000, y: -1000 } })
    assert.equal(removed.bw.getBounds().x, 1540)
    assert.equal(removed.bw.getBounds().y, 0)
    await removed.close()
})

test('副屏负坐标位置能够恢复，用户移动后保存基础窗口位置', async () => {
    const window = mountWindow({ position: { x: -800, y: 200 } }, [
        { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
        { id: 2, workArea: { x: -1280, y: 0, width: 1280, height: 1024 } },
    ])
    assert.equal(window.bw.getBounds().x, -800)
    window.bw.setBounds({ x: -900, y: 300, width: 380, height: 164 })
    window.tick(120)
    window.tick(600)
    await window.flush()
    assert.equal(window.writes.at(-1).position.x, -900)
    assert.equal(window.writes.at(-1).position.y, 300)
    await window.close()
})

test('保持展开阻止自动收起，关闭此偏好后按选定延时收起', async () => {
    const window = mountWindow()
    await window.invoke('control-widget:preferences-save', { keepExpanded: true, autoHideDelay: 1400 })
    window.emit('control-widget:mouseleave')
    window.tick(1400)
    assert.equal(window.bw.getBounds().width, 380)
    await window.invoke('control-widget:preferences-save', { keepExpanded: false, autoHideDelay: 1400 })
    window.tick(800)
    assert.equal(window.bw.getBounds().width, 380)
    window.tick(1400)
    assert.ok(window.bw.getBounds().width === 12 || window.bw.getBounds().height === 12)
    window.emit('control-widget:mouseenter')
    assert.equal(window.bw.getBounds().width, 380)
    assert.equal(window.bw.getBounds().height, 164)
    await window.close()
})

test('底部展开与关闭歌单保持底边，恢复时不会保存歌单窗口高度', async () => {
    const window = mountWindow({ position: { x: 300, y: 916 } })
    window.emit('control-widget:content-expanded', true)
    assert.equal(window.bw.getBounds().y + window.bw.getBounds().height, 1080)
    assert.equal(window.bw.getBounds().height, 392)
    window.tick(120)
    window.emit('control-widget:content-expanded', false)
    assert.equal(window.bw.getBounds().y, 916)
    await window.close()
    assert.equal(window.writes.at(-1).position.y, 916)
})

test('工作区缩小时重新限制窗口位置，即使原位置由程序恢复', async () => {
    const displays = [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]
    const window = mountWindow({ position: { x: 1500, y: 900 } }, displays)
    displays[0].workArea = { x: 0, y: 0, width: 1280, height: 800 }
    window.screen.emit('display-metrics-changed')
    window.tick(120)
    assert.ok(window.bw.getBounds().x <= 900)
    assert.ok(window.bw.getBounds().y <= 636)
    await window.close()
})
