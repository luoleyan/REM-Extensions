const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('../node_modules/typescript')

const manifestFile = path.join(__dirname, '../src/desktop-lyrics/manifest.json')
const hostFile = path.join(__dirname, '../../REM/extension/host/win.js')

function loadHost() {
    const windows = []
    const timers = []
    class BrowserWindow {
        constructor(options) {
            this.options = options
            this.id = windows.length + 1
            this.webContents = { executeJavaScript() {} }
            windows.push(this)
        }
        loadFile() {}
        show() {}
        on() {}
    }
    const context = {
        module: { exports: {} },
        __dirname: path.dirname(hostFile),
        console,
        setTimeout(callback) { timers.push(callback) },
        require(name) {
            if (name === 'electron') return { BrowserWindow }
            if (name === 'path') return path
            if (name.includes('main-invoker/node')) return () => ({})
            if (name.includes('ipc/extmapping')) return { record() {}, deleteRecord() {} }
            if (name.includes('appPath/main')) return { Extensions: path.join(__dirname, '../build') }
            if (name.endsWith(path.join('desktop-lyrics', 'main.js'))) return {}
            throw new Error(`Unexpected dependency: ${name}`)
        },
    }
    vm.runInNewContext(fs.readFileSync(hostFile, 'utf8'), context, { filename: hostFile })
    return { host: context.module.exports, windows, timers }
}

test('桌面歌词窗口配置不含会覆盖透明设置的重复 JSON 字段', () => {
    const source = ts.parseJsonText(manifestFile, fs.readFileSync(manifestFile, 'utf8'))
    function inspect(node) {
        if (ts.isObjectLiteralExpression(node)) {
            const keys = new Set()
            for (const property of node.properties) {
                const key = property.name.text
                assert.ok(!keys.has(key), `Duplicate manifest field: ${key}`)
                keys.add(key)
            }
        }
        ts.forEachChild(node, inspect)
    }
    inspect(source)
})

for (const entry of ['openExtensionWindows', 'openFallbackWindows']) {
    test(`桌面歌词经 ${entry} 创建时原生窗口完全透明且无整窗阴影`, () => {
        const manifest = { ...JSON.parse(fs.readFileSync(manifestFile, 'utf8')), folderName: 'desktop-lyrics', activated: true }
        const { host, windows, timers } = loadHost()
        host[entry](manifest)
        for (const callback of timers) callback()
        assert.equal(windows.length, 1)
        const options = windows[0].options
        assert.equal(options.transparent, true)
        assert.equal(options.backgroundColor, '#00000000', 'Native background must not darken the full transparent viewport')
        assert.equal(options.hasShadow, false, 'The overlay must not cast a rectangular window shadow')
    })
}
