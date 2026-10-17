const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const { EventEmitter } = require('node:events')
const ts = require('../node_modules/typescript')

const hostRoot = path.join(__dirname, '../../REM')

async function mountTheme() {
    const rem = new EventEmitter()
    rem.emitNone = rem.emit.bind(rem)
    const invokers = new Map()
    const handlers = new Map()
    const ipcMain = Object.assign(new EventEmitter(), { handle: (name, handler) => handlers.set(name, handler) })
    const received = []
    const mainWindow = Object.assign(new EventEmitter(), {
        webContents: { closeDevTools() {} }, setThumbarButtons() {},
        isDestroyed: () => false,
    })
    const widgetWindow = {
        isDestroyed: () => false,
        webContents: { send: (channel, theme) => received.push({ channel, theme: { ...theme } }) },
    }
    mainWindow.webContents.send = () => {}
    const dependencies = {
        electron: {
            ipcMain, BrowserWindow: { getAllWindows: () => [mainWindow, widgetWindow] },
            app: { requestSingleInstanceLock: () => true },
            Menu: { setApplicationMenu() {} }, nativeImage: { createFromPath() {} },
        },
        path,
        '../../utils/stores/rem-store.js': class {},
        '../../utils/network/server.js': { watchNetworkChange() {} },
        '../../extension/initExtensionHost': {},
        '../../utils/main-invoker/node.js': () => ({ invoke: name => invokers.get(name)() }),
        '../../utils/ipc/main.js': {},
        '../../utils/ipc/extmapping.js': {},
        './protocol.js': { registerProtocol() {} },
        '../../utils/devices/node/index.js': {},
        '../../utils/features/main.js': { appendFeatures() {} },
        '../../extension/host/loader': {},
        '../../utils/appPath/main': {},
        '../../utils/easy-log/node.js': {},
        '../../utils/ipc/net.js': {},
        '../../utils/ext-market/node.js': {},
        '../../protocol_dist/main/registry.js': {},
        '../../protocol_dist/main/consumerHost.js': {},
        '../../protocol_dist/main/localFile/index.js': {},
    }
    const mainContext = vm.createContext({
        module: { exports: {} }, __dirname: path.join(hostRoot, 'wins/main'),
        process: { platform: 'win32' }, mainWindow,
        require(name) { assert.ok(name in dependencies, name); return dependencies[name] },
    })
    vm.runInContext(readFileSync(path.join(hostRoot, 'wins/main/buildWindow.js'), 'utf8'), mainContext)
    vm.runInContext('initMainWin(mainWindow)', mainContext)

    const settingsDependencies = {
        '../../utils/stores/base': { store: {
            getSync: () => undefined, set: async () => {},
        } },
        '../../utils/lang/lang.js': { Lang: { langs: {} } },
        '../../utils/style/font': { setClearFont() {} },
        '../../utils/rem': { rem },
        '../../utils/math.js': { hue: () => 210 },
        '../../utils/main-invoker/browser.js': { invoker: { handle: (name, handler) => invokers.set(name, handler) } },
        '../../utils/devices/browser/output': { indexOfOutputDevice: async () => 0, setPluginOutput() {} },
        '../../utils/devices/browser/find': { getAudioDevices: async () => [{ label: '默认设备', deviceId: 'default' }] },
    }
    const settingsContext = vm.createContext({
        exports: {}, langMapping: { s: key => key },
        document: { body: { style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} } } },
        hooks: {
            invoke: async () => ({ accent: '0088ffff', dark: false }),
            send: (name, value) => ipcMain.emit(name, { sender: mainWindow.webContents }, value),
        },
        require(name) { assert.ok(name in settingsDependencies, name); return settingsDependencies[name] },
    })
    const compiled = ts.transpileModule(readFileSync(path.join(hostRoot, 'pages/settings/initSettings.js'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    vm.runInContext(compiled, settingsContext)
    settingsContext.exports.initSettings()
    await new Promise(resolve => setImmediate(resolve))
    received.length = 0
    return {
        rem, ipcMain, received,
        query: () => handlers.get('app?theme')(),
    }
}

test('设置变更后 app?theme 返回最新主题，重新打开控件无需重启 REM', async () => {
    const host = await mountTheme()
    assert.equal((await host.query()).colorHue, 210)
    host.rem.emit('changeControlColor', 39)
    host.rem.emit('changeDarkMode', true)
    const theme = await host.query()
    assert.equal(theme.colorHue, 39)
    assert.equal(theme.dark, true)
})

test('主窗口切换主题经真实 IPC 处理函数即时通知已打开控件', async () => {
    const host = await mountTheme()
    host.rem.emit('changeControlColor', 292)
    host.rem.emit('changeDarkMode', true)
    assert.equal(host.received.length, 2)
    assert.deepEqual(host.received.at(-1), { channel: 'app:theme-changed', theme: { colorHue: 292, dark: true } })
})

test('主题广播只接受主窗口通知', async () => {
    const host = await mountTheme()
    host.ipcMain.emit('app:theme-changed', { sender: {} }, { colorHue: 39, dark: true })
    assert.equal(host.received.length, 0)
})
