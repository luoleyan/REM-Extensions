const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const { EventEmitter } = require('node:events')

const rendererSource = readFileSync(path.join(__dirname, '../src/control-widget/ui/index.js'), 'utf8')
const lrc = { lrc: { lyric: '[00:10.00]第一句歌词\n[00:20.00]第二句歌词' } }

function createElement() {
    const attributes = new Map()
    const listeners = new Map()
    const classes = new Set()
    const properties = new Map()
    let capturedPointer
    const element = {
        textContent: '', title: '', children: [], dataset: {}, scrollTop: 0, scrollCalls: 0, replaceCount: 0,
        style: {
            setProperty(name, value) { properties.set(name, String(value)) },
            getPropertyValue: name => properties.get(name) || '',
        },
        classList: {
            toggle(name, active) { active ? classes.add(name) : classes.delete(name) },
            add(name) { classes.add(name) }, remove(name) { classes.delete(name) },
            contains: name => classes.has(name),
        },
        setAttribute(name, value) { attributes.set(name, value) },
        getAttribute(name) { return attributes.get(name) },
        removeAttribute(name) { attributes.delete(name) },
        addEventListener(type, callback) { listeners.set(type, callback) },
        trigger(type, event = {}) {
            return listeners.get(type)?.({
                pointerId: 1, isPrimary: true, button: 0, clientX: 100,
                preventDefault() {}, currentTarget: element, target: element, ...event,
            })
        },
        getBoundingClientRect: () => ({ left: 100, width: 200 }),
        setPointerCapture(id) { capturedPointer = id },
        hasPointerCapture: id => capturedPointer === id,
        releasePointerCapture() { capturedPointer = undefined },
        focus() {},
        append(...items) {
            for (const item of items.flatMap(item => item.isFragment ? item.children : [item])) {
                item.parentElement = element
                element.children.push(item)
            }
        },
        replaceChildren(...items) { element.replaceCount++; element.children = []; element.append(...items) },
        matches(selector) {
            if (selector === ':focus-visible') return element.focusVisible === true
            if (selector.startsWith('[data-index=')) return element.dataset.index === selector.match(/"(.*?)"/)[1]
            return selector.split('.').filter(Boolean).every(name => classes.has(name))
        },
        closest(selector) { return element.matches(selector) ? element : element.parentElement?.closest(selector) },
        contains(target) { return target === element || element.children.some(child => child.contains(target)) },
        scrollIntoView() { element.scrollCalls++ },
        querySelector(selector) {
            if (selector === '.fa') return createElement()
            return element.querySelectorAll(selector)[0] || null
        },
        querySelectorAll(selector) {
            return element.children.flatMap(child => [ ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector) ])
        },
    }
    Object.defineProperty(element, 'className', {
        get: () => [...classes].join(' '),
        set(value) { classes.clear(); String(value).split(' ').filter(Boolean).forEach(name => classes.add(name)) },
    })
    return element
}

async function mountRenderer(requestLyrics = async () => lrc, initialId = '1', seekHandler = async () => {}, options = {}) {
    const elements = new Map()
    const calls = []
    const commands = []
    let audioId = initialId
    let queue = options.queue || []
    let storeError = false
    const subscriptions = new Map()
    const body = createElement()
    const document = {
        body, documentElement: createElement(), activeElement: body,
        getElementById: key => getElement(key), querySelector: key => getElement(key),
        createElement() { const element = createElement(); element.focus = () => { document.activeElement = element }; return element },
        createDocumentFragment() { return Object.assign(createElement(), { isFragment: true }) },
    }
    const getElement = key => {
        if (!elements.has(key)) {
            const element = createElement()
            element.focus = () => { document.activeElement = element }
            elements.set(key, element)
        }
        return elements.get(key)
    }
    const ipcRenderer = Object.assign(new EventEmitter(), {
        send() {},
        async invoke(channel, id) {
            if (channel === 'control-widget:lyrics') return requestLyrics(id)
            if (channel === 'app?theme') return options.requestTheme ? options.requestTheme() : { colorHue: 220, dark: true }
            if (channel === 'control-widget:preferences') return { keepExpanded: false, autoHideDelay: 800 }
            if (channel === 'store:get') {
                if (storeError) throw new Error('读取失败')
                return id === 'listPlaying' ? queue : queue.findIndex(item => String(item.id) === String(audioId))
            }
        },
    })
    const context = vm.createContext({
        console: { warn() {} },
        setTimeout, clearTimeout,
        requestAnimationFrame: callback => { callback(); return 1 },
        cancelAnimationFrame() {},
        document,
        window: {
            win: {}, addEventListener() {},
            subscribe(name, callback) { subscriptions.set(name, callback); return { close: async () => {} } },
            connect(name) {
                calls.push(name)
                return {
                    close: async () => {},
                    async invoke(method) {
                        if (name === 'lyric') throw new Error('connect ENOENT \\pipe\\rem\\lyric')
                        if (method === '.audioData') return { id: audioId, name: '测试歌曲' }
                        if (method === '.duration') return 120
                        if (method.startsWith(':seek|')) {
                            commands.push(method)
                            return seekHandler(method)
                        }
                        if (name === 'playlist' && method.startsWith(':')) {
                            commands.push(method)
                            return options.playlistAction?.(method)
                        }
                    },
                }
            },
        },
        require(name) {
            assert.equal(name, 'electron')
            return { ipcRenderer }
        },
    })
    vm.runInContext(rendererSource, context)
    await new Promise(resolve => setImmediate(resolve))
    return {
        text: () => getElement('idleLyricText').textContent,
        element: getElement,
        body,
        document,
        ipcRenderer,
        evaluate: code => vm.runInContext(code, context),
        setQueue: value => { queue = value },
        failStore: value => { storeError = value },
        emit: (name, value) => subscriptions.get(name)?.(value),
        commands,
        close: () => context.window.win.beforeClose(),
        progress: seconds => vm.runInContext('updateProgress(0, ' + seconds + ')', context),
        async changeTrack(id) {
            audioId = id
            await vm.runInContext('render()', context)
            await new Promise(resolve => setImmediate(resolve))
        },
        settle: () => new Promise(resolve => setImmediate(resolve)),
        calls,
    }
}

test('已打开的播放控件即时跟随主题色和深浅模式，无需重建窗口', async t => {
    const renderer = await mountRenderer()
    t.after(renderer.close)
    assert.equal(renderer.document.documentElement.style.getPropertyValue('--accent-hue'), '220')
    for (const theme of [{ colorHue: 39, dark: false }, { colorHue: 292, dark: true }, { colorHue: 0, dark: false }]) {
        renderer.ipcRenderer.emit('app:theme-changed', {}, theme)
        assert.equal(renderer.document.documentElement.style.getPropertyValue('--accent-hue'), String(theme.colorHue))
        assert.equal(renderer.body.classList.contains('dark'), theme.dark)
    }
})

test('初始主题请求晚于切换通知返回时，保留最新主题', async t => {
    const pending = Promise.withResolvers()
    const renderer = await mountRenderer(undefined, '1', undefined, { requestTheme: () => pending.promise })
    t.after(renderer.close)
    renderer.ipcRenderer.emit('app:theme-changed', {}, { colorHue: 148, dark: false })
    pending.resolve({ colorHue: 220, dark: true })
    await renderer.settle()
    assert.equal(renderer.document.documentElement.style.getPropertyValue('--accent-hue'), '148')
    assert.equal(renderer.body.classList.contains('dark'), false)
})

test('初始主题请求失败时，不覆盖已收到的实时主题', async t => {
    const pending = Promise.withResolvers()
    const renderer = await mountRenderer(undefined, '1', undefined, { requestTheme: () => pending.promise })
    t.after(renderer.close)
    renderer.ipcRenderer.emit('app:theme-changed', {}, { colorHue: 322, dark: false })
    pending.reject(new Error('主题读取超时'))
    await renderer.settle()
    assert.equal(renderer.document.documentElement.style.getPropertyValue('--accent-hue'), '322')
    assert.equal(renderer.body.classList.contains('dark'), false)
})

test('关闭播放控件时解除主题监听，未返回的请求不再修改页面', async () => {
    const pending = Promise.withResolvers()
    const renderer = await mountRenderer(undefined, '1', undefined, { requestTheme: () => pending.promise })
    assert.equal(renderer.ipcRenderer.listenerCount('app:theme-changed'), 1)
    await renderer.close()
    pending.resolve({ colorHue: 39, dark: true })
    renderer.ipcRenderer.emit('app:theme-changed', {}, { colorHue: 292, dark: true })
    await renderer.settle()
    assert.equal(renderer.ipcRenderer.listenerCount('app:theme-changed'), 0)
    assert.equal(renderer.document.documentElement.style.getPropertyValue('--accent-hue'), '')
    assert.equal(renderer.body.classList.contains('dark'), false)
})

test('桌面歌词管道未启动时，控件仍从自身接口获取并显示歌词', async () => {
    const renderer = await mountRenderer()
    renderer.progress(15)
    assert.equal(renderer.text(), '第一句歌词')
    assert.ok(!renderer.calls.includes('lyric'), '播放控件不应依赖桌面歌词管道')
    renderer.progress(25)
    assert.equal(renderer.text(), '第二句歌词')
})

test('拖动实时预览，播放进度回调不抢回滑块，松手只提交一次', async t => {
    const renderer = await mountRenderer()
    t.after(renderer.close)
    const bar = renderer.element('progressBar')
    bar.trigger('pointerdown', { clientX: 150 })
    assert.equal(renderer.element('elapsed').textContent, '0:30')
    assert.equal(bar.hasPointerCapture(1), true)
    renderer.progress(5)
    assert.equal(renderer.element('elapsed').textContent, '0:30')
    bar.trigger('pointermove', { clientX: 250 })
    assert.equal(renderer.element('elapsed').textContent, '1:30')
    assert.equal(renderer.element('progressPreview').textContent, '1:30')
    assert.equal(renderer.commands.length, 0)
    bar.trigger('pointerup', { clientX: 250 })
    assert.deepEqual(renderer.commands, [':seek|90'])
    assert.equal(bar.hasPointerCapture(1), false)
    renderer.progress(6)
    assert.equal(renderer.element('elapsed').textContent, '1:30')
    renderer.progress(90)
    assert.equal(renderer.element('elapsed').textContent, '1:30')
})

test('拖出左右边界仍能释放，并限制在歌曲起止范围', async t => {
    const renderer = await mountRenderer()
    t.after(renderer.close)
    const bar = renderer.element('progressBar')
    bar.trigger('pointerdown', { clientX: 150 })
    bar.trigger('pointermove', { clientX: -100 })
    bar.trigger('pointerup', { clientX: -100 })
    bar.trigger('pointerdown', { clientX: 150 })
    bar.trigger('pointerup', { clientX: 500 })
    assert.deepEqual(renderer.commands, [':seek|0', ':seek|120'])
})

test('Escape、系统取消和丢失捕获均取消拖动，不发送跳转', async t => {
    const renderer = await mountRenderer()
    t.after(renderer.close)
    const bar = renderer.element('progressBar')
    renderer.progress(15)
    for (const type of ['keydown', 'pointercancel', 'lostpointercapture']) {
        bar.trigger('pointerdown', { clientX: 250 })
        assert.equal(bar.classList.contains('is-seeking'), true)
        bar.trigger(type, { key: 'Escape' })
        assert.equal(renderer.element('elapsed').textContent, '0:15')
        assert.equal(bar.classList.contains('is-seeking'), false)
    }
    assert.equal(renderer.commands.length, 0)
})

test('拖动时切歌取消旧歌曲跳转，忽略右键和第二个指针', async t => {
    const renderer = await mountRenderer()
    t.after(renderer.close)
    const bar = renderer.element('progressBar')
    bar.trigger('pointerdown', { button: 2, clientX: 250 })
    bar.trigger('pointerup', { button: 2, clientX: 250 })
    assert.equal(renderer.commands.length, 0)
    bar.trigger('pointerdown', { clientX: 150 })
    assert.equal(bar.hasPointerCapture(1), true)
    bar.trigger('pointerup', { pointerId: 2, clientX: 250 })
    assert.equal(renderer.commands.length, 0)
    await renderer.changeTrack('2')
    bar.trigger('pointerup', { clientX: 250 })
    assert.equal(renderer.commands.length, 0)
    assert.equal(bar.hasPointerCapture(1), false)
})

test('连续键盘调整使用最新目标时间，失败时恢复真实进度', async t => {
    const renderer = await mountRenderer()
    t.after(renderer.close)
    const bar = renderer.element('progressBar')
    bar.trigger('keydown', { key: 'ArrowRight' })
    bar.trigger('keydown', { key: 'ArrowRight' })
    bar.trigger('keydown', { key: 'ArrowLeft', shiftKey: true })
    assert.deepEqual(renderer.commands, [':seek|5', ':seek|10', ':seek|0'])

    const failed = await mountRenderer(async () => lrc, '1', async () => ({ error: '跳转失败' }))
    t.after(failed.close)
    failed.progress(15)
    failed.element('progressBar').trigger('pointerdown', { clientX: 250 })
    failed.element('progressBar').trigger('pointerup', { clientX: 250 })
    await failed.settle()
    assert.equal(failed.element('elapsed').textContent, '0:15')
})

test('没有歌曲时禁止拖动，键盘 Home 和 End 可以跳到起止位置', async t => {
    const empty = await mountRenderer(async () => lrc, null)
    t.after(empty.close)
    empty.element('progressBar').trigger('pointerdown', { clientX: 250 })
    empty.element('progressBar').trigger('pointerup', { clientX: 250 })
    assert.equal(empty.commands.length, 0)
    assert.equal(empty.element('progressBar').getAttribute('aria-disabled'), 'true')
    const renderer = await mountRenderer()
    t.after(renderer.close)
    renderer.element('progressBar').trigger('keydown', { key: 'End' })
    renderer.element('progressBar').trigger('keydown', { key: 'Home' })
    assert.deepEqual(renderer.commands, [':seek|120', ':seek|0'])
})

test('加载中与前奏状态不会被播放进度回调覆盖', async () => {
    let resolveLyrics
    const renderer = await mountRenderer(() => new Promise(resolve => { resolveLyrics = resolve }))
    renderer.progress(3)
    assert.equal(renderer.text(), '歌词加载中…')
    resolveLyrics(lrc)
    await renderer.settle()
    assert.equal(renderer.text(), '前奏 · 等待演唱')
})

test('空歌词和取词失败显示准确状态', async () => {
    const empty = await mountRenderer(async () => ({ lrc: { lyric: '' } }))
    empty.progress(15)
    assert.equal(empty.text(), '暂无歌词')
    const failed = await mountRenderer(async () => { throw new Error('请求失败') })
    failed.progress(15)
    assert.equal(failed.text(), '歌词加载失败')
})

test('优先显示逐字歌词中的句子', async () => {
    const renderer = await mountRenderer(async () => ({
        ...lrc, yrc: { lyric: '[10000,5000](10000,1000,0)逐字(11000,3000,0)歌词' },
    }))
    renderer.progress(12)
    assert.equal(renderer.text(), '逐字歌词')
})

test('切歌后旧请求迟到不会覆盖当前歌曲歌词', async () => {
    let resolveOld
    const renderer = await mountRenderer(id => id === '1'
        ? new Promise(resolve => { resolveOld = resolve })
        : Promise.resolve({ lrc: { lyric: '[00:01.00]新歌歌词' } }))
    await renderer.changeTrack('2')
    renderer.progress(15)
    assert.equal(renderer.text(), '新歌歌词')
    resolveOld(lrc)
    await renderer.settle()
    assert.equal(renderer.text(), '新歌歌词')
})

test('旧请求失败不会覆盖当前歌曲，无歌曲时显示等待播放', async () => {
    let rejectOld
    const renderer = await mountRenderer(id => id === '1'
        ? new Promise((resolve, reject) => { rejectOld = reject })
        : Promise.resolve(lrc))
    await renderer.changeTrack('2')
    renderer.progress(15)
    rejectOld(new Error('旧请求失败'))
    await renderer.settle()
    assert.equal(renderer.text(), '第一句歌词')
    await renderer.changeTrack(undefined)
    renderer.progress(15)
    assert.equal(renderer.text(), '等待播放')
})

test('键盘焦点保持操作态，离开焦点后才恢复歌词态', async t => {
    const renderer = await mountRenderer()
    t.after(renderer.close)
    const button = renderer.element('playBtn')
    renderer.body.append(button)
    renderer.body.trigger('mouseenter')
    renderer.body.trigger('keydown', { key: 'Tab' })
    button.focus()
    renderer.body.trigger('focusin', { target: button })
    renderer.body.trigger('mouseleave')
    await new Promise(resolve => setTimeout(resolve, 240))
    assert.equal(renderer.body.classList.contains('is-hovered'), true)
    renderer.document.activeElement = renderer.body
    renderer.body.trigger('focusout')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(renderer.body.classList.contains('is-hovered'), false)
})

test('歌单只在点击时打开，定位当前歌曲，Esc关闭并归还焦点', async t => {
    const renderer = await mountRenderer(undefined, '2', undefined, { queue: [
        { id: 1, name: '第一首' }, { id: 2, name: '当前歌曲' }, { id: 3, name: '第三首' },
    ] })
    t.after(renderer.close)
    renderer.body.trigger('mouseenter')
    assert.equal(renderer.element('queueBtn').getAttribute('aria-expanded'), 'false')
    renderer.element('queueBtn').trigger('click')
    await renderer.settle()
    const current = renderer.element('playlistList').children[1]
    assert.equal(current.getAttribute('aria-current'), 'true')
    assert.ok(current.scrollCalls > 0)
    renderer.body.trigger('keydown', { key: 'Escape' })
    assert.equal(renderer.element('queueBtn').getAttribute('aria-expanded'), 'false')
    assert.equal(renderer.document.activeElement, renderer.element('queueBtn'))
})

test('队列内容未变时不重建列表，更新失败保留内容并支持重试', async t => {
    const queue = [{ id: 1, name: '第一首' }, { id: 2, name: '第二首' }]
    const renderer = await mountRenderer(undefined, '1', undefined, { queue })
    t.after(renderer.close)
    const list = renderer.element('playlistList')
    const previous = list.children[0]
    const count = list.replaceCount
    list.scrollTop = 80
    renderer.setQueue(JSON.parse(JSON.stringify(queue)))
    await renderer.evaluate('loadPlaylist()')
    assert.equal(list.replaceCount, count)
    assert.equal(list.children[0], previous)
    assert.equal(list.scrollTop, 80)
    list.children[1].focus()
    renderer.setQueue([{ id: 2, name: '第二首' }, { id: 1, name: '第一首' }])
    await renderer.evaluate('loadPlaylist()')
    assert.equal(renderer.document.activeElement.dataset.audioId, '2')
    assert.equal(renderer.document.activeElement.dataset.index, '0')
    renderer.failStore(true)
    await renderer.evaluate('loadPlaylist()')
    assert.equal(list.children.length, 2)
    assert.equal(renderer.element('playlistRetry').hidden, false)
    assert.match(renderer.element('playlistStatus').textContent, /保留/)
    renderer.failStore(false)
    renderer.setQueue([...queue, { id: 3, name: '新加入歌曲' }])
    renderer.element('playlistRetry').trigger('click')
    await renderer.settle()
    assert.equal(list.children.length, 3)
    assert.equal(renderer.element('playlistRetry').hidden, true)
    assert.equal(list.scrollTop, 80)
})

test('Enter与双击播放指定索引，服务返回错误时反馈失败', async t => {
    const renderer = await mountRenderer(undefined, '1', undefined, {
        queue: [{ id: 1, name: '第一首' }, { id: 2, name: '第二首' }],
        playlistAction: async () => ({ error: '不可播放' }),
    })
    t.after(renderer.close)
    const list = renderer.element('playlistList')
    list.trigger('keydown', { key: 'Enter', target: list.children[1] })
    await renderer.settle()
    assert.deepEqual(renderer.commands, [':play|1'])
    assert.match(renderer.element('feedback').textContent, /播放失败/)
    await list.trigger('dblclick', { target: list.children[0] })
    assert.deepEqual(renderer.commands, [':play|1', ':play|0'])
    list.trigger('keydown', { key: 'Enter', repeat: true, target: list.children[1] })
    assert.equal(renderer.commands.length, 2)
})

test('歌词失败可在同一首歌曲直接重试恢复', async t => {
    let requests = 0
    const renderer = await mountRenderer(async () => {
        if (++requests === 1) throw new Error('网络失败')
        return lrc
    })
    t.after(renderer.close)
    assert.equal(renderer.element('lyricsRetry').hidden, false)
    renderer.element('lyricsRetry').trigger('click')
    await renderer.settle()
    renderer.progress(15)
    assert.equal(renderer.text(), '第一句歌词')
    assert.equal(renderer.element('lyricsRetry').hidden, true)
    assert.equal(requests, 2)
})
