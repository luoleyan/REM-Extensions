const { connect, subscribe, win } = window

const { ipcRenderer } = require('electron')

const progressBar = document.getElementById('progressBar')
const progressFill = document.getElementById('progressFill')
const progressThumb = document.querySelector('.progress-thumb')
const progressPreview = document.getElementById('progressPreview')
const elapsed = document.getElementById('elapsed')
const durationLabel = document.getElementById('duration')
const playButton = document.getElementById('playBtn')
const playIcon = playButton.querySelector('.fa')
const stateDot = document.getElementById('stateDot')
const playState = document.getElementById('playState')
const rhythmBars = document.getElementById('rhythmBars')
const expandButton = document.getElementById('expand')
const queueButton = document.getElementById('queueBtn')
const cover = document.querySelector('.cover')
const coverImage = document.getElementById('img')
const trackName = document.getElementById('trackName')
const trackArtist = document.getElementById('trackArtist')
const trackAlbum = document.getElementById('trackAlbum')
const idleLyricText = document.getElementById('idleLyricText')
const playlistPanel = document.getElementById('playlistPanel')
const playlistList = document.getElementById('playlistList')
const playlistCount = document.getElementById('playlistCount')
const playlistStatus = document.getElementById('playlistStatus')
const playlistEmpty = document.getElementById('playlistEmpty')
const playlistRetry = document.getElementById('playlistRetry')
const lyricsRetry = document.getElementById('lyricsRetry')
const preferencesButton = document.getElementById('preferencesBtn')
const keepExpandedInput = document.getElementById('keepExpanded')
const autoHideDelayInput = document.getElementById('autoHideDelay')
const feedback = document.getElementById('feedback')

const player = connect('player-controller')
const playlist = connect('playlist')

let duration = 0
let currentProgress = 0
let currentTime = 0
let isPlaying = false
let mainWinVisible = false
let currentAudioId
let currentCoverUrl = ''
let isHovered = false
let playlistOpen = false
let lyricGeneration = 0
let lyricStatus = 'idle'
let lyricLines = []
let timedLyricLines = []
let lastLyricText = ''
let lyricAnimationFrame = 0
let playlistItems = []
let playlistCurrentIndex = -1
let seekDrag
let pendingSeek
let pendingSeekTimer
let preferencesOpen = false
let keyboardFocusWithin = false
let keyboardMode = false
let hoverLeaveTimer
let focusTimer
let feedbackTimer
let playlistRefreshTimer
let playlistRequest
let playlistLocateRequested = false
let playlistSignature = ''
let playlistGeneration = 0
let playbackPending = false
let closed = false

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
}

function formatTime(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0))
    const minutes = Math.floor(seconds / 60)
    const rest = String(seconds % 60).padStart(2, '0')
    return String(minutes) + ':' + rest
}

function parseStoredValue(value) {
    if (typeof value !== 'string') return value
    try {
        return JSON.parse(value)
    } catch {
        return value
    }
}

function getTrackTitle(data) {
    return String(data?.name || data?.title || '').trim() || '未命名歌曲'
}

function getArtistText(data) {
    const artists = Array.isArray(data?.ar)
        ? data.ar.map(artist => typeof artist === 'string' ? artist : artist?.name).filter(Boolean)
        : []
    return artists.join(', ') || '未知艺人'
}

function getAlbumText(data) {
    return String(data?.al?.name || data?.album?.name || data?.album || '').trim() || '未知专辑'
}

function getCoverUrl(data) {
    return String(data?.al?.picUrl || data?.album?.picUrl || data?.picUrl || '').trim()
}

function updateProgress(progress = 0, seconds) {
    const ratio = clamp(Number(progress) || 0, 0, 1)
    currentProgress = ratio
    if (Number.isFinite(Number(seconds))) {
        currentTime = Math.max(0, Number(seconds))
    } else {
        currentTime = Math.max(0, duration * ratio)
    }

    if (pendingSeek && Math.abs(currentTime - pendingSeek.seconds) < 1.5) {
        clearPendingSeek()
    }
    renderProgress()
    updateIdleLyric()
}

function renderProgress() {
    const seconds = seekDrag?.seconds ?? pendingSeek?.seconds ?? currentTime
    const ratio = seekDrag || pendingSeek
        ? clamp(seconds / duration, 0, 1)
        : currentProgress
    const percent = String(ratio * 100) + '%'
    progressFill.style.width = percent
    progressThumb.style.left = percent
    cover.style.setProperty('--progress-angle', String(ratio * 360) + 'deg')
    elapsed.textContent = formatTime(seconds)
    durationLabel.textContent = formatTime(duration)
    progressBar.setAttribute('aria-valuemax', String(Math.max(0, duration)))
    progressBar.setAttribute('aria-valuenow', String(seconds))
    progressBar.setAttribute('aria-valuetext', formatTime(seconds) + ' / ' + formatTime(duration))
    progressBar.setAttribute('aria-disabled', String(!canSeek()))
}

function canSeek() {
    return Boolean(currentAudioId) && Number.isFinite(duration) && duration > 0
}

function getSeekTime(clientX) {
    const rect = progressBar.getBoundingClientRect()
    return clamp((clientX - rect.left) / rect.width, 0, 1) * duration
}

function showSeekPreview(seconds) {
    progressPreview.textContent = formatTime(seconds)
    progressBar.style.setProperty('--seek-preview-position', String(seconds / duration * 100) + '%')
    progressPreview.classList.add('is-visible')
}

function clearPendingSeek() {
    clearTimeout(pendingSeekTimer)
    pendingSeekTimer = undefined
    pendingSeek = undefined
}

function endSeekDrag() {
    const drag = seekDrag
    seekDrag = undefined
    progressBar.classList.remove('is-seeking')
    progressPreview.classList.remove('is-visible')
    if (drag && progressBar.hasPointerCapture(drag.pointerId)) {
        progressBar.releasePointerCapture(drag.pointerId)
    }
    if (drag) syncWindowExpansion()
    renderProgress()
    return drag
}

function resetSeekInteraction() {
    clearPendingSeek()
    endSeekDrag()
}

async function commitSeek(seconds) {
    clearPendingSeek()
    const request = { seconds: clamp(seconds, 0, duration) }
    pendingSeek = request
    renderProgress()
    // 播放器返回后，下一次进度广播才确认跳转，期间保留用户选择的位置。
    pendingSeekTimer = setTimeout(() => {
        if (pendingSeek !== request) return
        clearPendingSeek()
        renderProgress()
    }, 2000)
    try {
        const result = await player.invoke(':seek|' + request.seconds)
        if (result?.error) throw new Error(result.error)
    } catch (error) {
        if (pendingSeek === request) {
            clearPendingSeek()
            renderProgress()
        }
        console.warn('[control-widget] failed to seek:', error)
        showFeedback('进度调整失败，请重试')
    }
}

function updatePlayState(playing) {
    isPlaying = Boolean(playing)
    playIcon.classList.toggle('fa-play', !isPlaying)
    playIcon.classList.toggle('fa-pause', isPlaying)
    playButton.title = isPlaying ? '暂停' : '播放'
    playButton.setAttribute('aria-label', isPlaying ? '暂停' : '播放')
    stateDot.classList.toggle('is-playing', isPlaying)
    rhythmBars.classList.toggle('is-playing', isPlaying)
    playState.textContent = isPlaying ? '正在播放' : '已暂停'
    cover.classList.toggle('is-playing', isPlaying)
    playButton.classList.toggle('is-playing', isPlaying)
    document.body.classList.toggle('is-playing', isPlaying)
}

function updateMainWindowState(visible) {
    mainWinVisible = Boolean(visible)
    expandButton.classList.toggle('col', mainWinVisible)
    expandButton.title = mainWinVisible ? '隐藏主窗口' : '显示主窗口'
    expandButton.setAttribute('aria-label', expandButton.title)
}

function setTrackText(element, value, fallback) {
    const text = String(value || '').trim() || fallback
    element.textContent = text
    element.title = text
}

function syncWindowExpansion() {
    const expanded = playlistOpen || preferencesOpen
    document.body.classList.toggle('is-hovered', isHovered || keyboardFocusWithin || Boolean(seekDrag) || expanded)
    document.body.classList.toggle('is-playlist-open', playlistOpen)
    document.body.classList.toggle('is-preferences-open', preferencesOpen)
    document.body.classList.toggle('is-content-open', expanded)
    queueButton.classList.toggle('is-active', playlistOpen)
    queueButton.setAttribute('aria-pressed', String(playlistOpen))
    queueButton.setAttribute('aria-expanded', String(playlistOpen))
    queueButton.title = playlistOpen ? '关闭歌单' : '打开歌单'
    queueButton.setAttribute('aria-label', queueButton.title)
    preferencesButton.classList.toggle('is-active', preferencesOpen)
    preferencesButton.setAttribute('aria-expanded', String(preferencesOpen))
    ipcRenderer.send('control-widget:content-expanded', expanded)
    ipcRenderer.send('control-widget:content-pinned', expanded || keyboardFocusWithin || Boolean(seekDrag))
}

function showFeedback(message) {
    clearTimeout(feedbackTimer)
    feedback.textContent = message
    feedback.title = message
    feedbackTimer = setTimeout(() => { feedback.textContent = '' }, 5000)
}

function focusCurrentTrack() {
    const item = playlistList.querySelector('.playlist-item.is-current')
    item?.scrollIntoView({ block: 'center', behavior: 'instant' })
}

function setPlaylistOpen(open, returnFocus = false) {
    playlistOpen = open
    if (open) preferencesOpen = false
    clearTimeout(playlistRefreshTimer)
    syncWindowExpansion()
    if (open) {
        // 原生窗口先完成扩展，再测量列表滚动区。
        requestAnimationFrame(() => { if (playlistOpen) focusCurrentTrack() })
        void loadPlaylist(true)
    } else if (returnFocus) {
        queueButton.focus({ preventScroll: true })
    }
}

function setPreferencesOpen(open, returnFocus = false) {
    preferencesOpen = open
    if (open) {
        playlistOpen = false
        clearTimeout(playlistRefreshTimer)
    }
    syncWindowExpansion()
    if (!open && returnFocus) preferencesButton.focus({ preventScroll: true })
}

async function runPlaybackAction(button, message, action) {
    if (playbackPending) return
    playbackPending = true
    button.setAttribute('aria-disabled', 'true')
    button.setAttribute('aria-busy', 'true')
    try {
        const result = await action()
        if (result?.error) throw new Error(result.error)
        await render()
    } catch (error) {
        showFeedback(message + '失败，请重试')
        console.warn('[control-widget] playback action failed:', error)
    } finally {
        playbackPending = false
        button.removeAttribute('aria-disabled')
        button.removeAttribute('aria-busy')
    }
}

function setIdleLyric(text) {
    const next = String(text || '').trim() || '等待播放'
    if (next === lastLyricText) return
    lastLyricText = next
    idleLyricText.textContent = next
    idleLyricText.title = next
    idleLyricText.classList.remove('is-refreshing')
    if (lyricAnimationFrame) cancelAnimationFrame(lyricAnimationFrame)
    lyricAnimationFrame = requestAnimationFrame(() => {
        lyricAnimationFrame = 0
        idleLyricText.classList.add('is-refreshing')
    })
}

function getCurrentLyricText(timeSeconds) {
    const time = Math.max(0, Number(timeSeconds) || 0) * 1000
    const source = timedLyricLines.length ? timedLyricLines : lyricLines
    if (!source.length) return ''

    let current
    for (const line of source) {
        if (line.time > time) break
        current = line
    }
    return current?.lyric || current?.text || ''
}

function updateIdleLyric() {
    lyricsRetry.hidden = lyricStatus !== 'error'
    if (lyricStatus === 'ready') {
        setIdleLyric(getCurrentLyricText(currentTime) || '前奏 · 等待演唱')
        return
    }
    const statusText = {
        idle: '等待播放',
        loading: '歌词加载中…',
        empty: '暂无歌词',
        error: '歌词加载失败',
    }
    setIdleLyric(statusText[lyricStatus])
}

function extractLyricText(value) {
    if (typeof value === 'string') return value
    return value?.lyric || ''
}

function parseLrc(source) {
    if (!source) return []
    const parsed = []
    for (const rawLine of String(source).split(/\r?\n/)) {
        const tags = Array.from(rawLine.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g))
        if (!tags.length) continue
        const text = rawLine.replace(/^\s*(?:\[[^\]]+\])+/, '').trim()
        if (!text || /^\[(ar|ti|al|by|offset|re|ve):/i.test(text)) continue
        for (const tag of tags) {
            parsed.push({
                time: Math.max(0, Math.round((Number(tag[1]) * 60 + Number(tag[2])) * 1000)),
                lyric: text,
            })
        }
    }
    return parsed.sort((left, right) => left.time - right.time)
}

function parseYrc(source) {
    if (!source) return []
    return String(source).split(/\r?\n/).flatMap(line => {
        const header = /^\[(\d+),(\d+)\]/.exec(line)
        if (!header) return []

        const words = []
        const pattern = /\((\d+),(\d+),\d+\)([^()]*)/g
        let match
        while ((match = pattern.exec(line.slice(header[0].length))) !== null) {
            words.push({
                start: Number(match[1]),
                duration: Math.max(1, Number(match[2])),
                text: match[3],
            })
        }

        if (!words.length) return []
        return [{
            time: Number(header[1]),
            duration: Number(header[2]),
            lyric: words.map(word => word.text).join(''),
        }]
    })
}

async function loadLyrics(audioId) {
    const generation = ++lyricGeneration
    lyricLines = []
    timedLyricLines = []
    lyricStatus = audioId ? 'loading' : 'idle'
    updateIdleLyric()
    if (!audioId) return

    try {
        const data = await ipcRenderer.invoke('control-widget:lyrics', String(audioId))
        const response = typeof data === 'string' ? parseStoredValue(data) : data
        const lrc = response?.lrc || response?.data?.lrc
        const yrc = response?.yrc || response?.data?.yrc
        const nextLines = parseLrc(extractLyricText(lrc))
        const nextTimedLines = parseYrc(extractLyricText(yrc))
        if (generation !== lyricGeneration || String(currentAudioId) !== String(audioId)) return
        lyricLines = nextLines
        timedLyricLines = nextTimedLines
        lyricStatus = nextLines.length || nextTimedLines.length ? 'ready' : 'empty'
        updateIdleLyric()
    } catch (error) {
        if (generation === lyricGeneration && String(currentAudioId) === String(audioId)) {
            lyricLines = []
            timedLyricLines = []
            lyricStatus = 'error'
            updateIdleLyric()
        }
        console.warn('[control-widget] failed to load lyrics:', error)
    }
}

function formatPlaylistItem(item) {
    const title = getTrackTitle(item)
    const artist = getArtistText(item)
    const coverUrl = getCoverUrl(item)
    const durationValue = Number(item?.dt || item?.duration || item?.durationSeconds || 0)
    const durationSeconds = durationValue > 1000 ? durationValue / 1000 : durationValue
    return { title, artist, coverUrl, durationSeconds }
}

function renderPlaylist() {
    const scrollTop = playlistList.scrollTop
    const focused = playlistList.contains(document.activeElement) ? document.activeElement?.closest('.playlist-item') : undefined
    const focusedIndex = focused?.dataset.index
    const focusedAudioId = focused?.dataset.audioId
    playlistCount.textContent = String(playlistItems.length) + ' 首'
    playlistPanel.classList.toggle('is-empty', playlistItems.length === 0)
    if (!playlistItems.length) {
        playlistList.replaceChildren()
        if (focused) document.getElementById('closePlaylist').focus({ preventScroll: true })
        return
    }

    const fragment = document.createDocumentFragment()
    playlistItems.forEach((item, index) => {
        const info = formatPlaylistItem(item)
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'playlist-item'
        button.dataset.index = String(index)
        button.dataset.audioId = String(item?.id)
        button.setAttribute('aria-label', '播放 ' + info.title)
        button.title = '双击或按 Enter 播放 ' + info.title

        const number = document.createElement('span')
        number.className = 'playlist-index'
        number.textContent = String(index + 1).padStart(2, '0')

        const image = document.createElement('img')
        image.className = 'playlist-art'
        image.alt = ''
        image.draggable = false
        if (info.coverUrl) image.src = info.coverUrl
        image.addEventListener('error', () => image.removeAttribute('src'), { once: true })

        const copy = document.createElement('span')
        copy.className = 'playlist-copy'
        const title = document.createElement('span')
        title.className = 'playlist-title'
        title.textContent = info.title
        const artist = document.createElement('span')
        artist.className = 'playlist-artist'
        artist.textContent = info.artist
        copy.append(title, artist)

        const meta = document.createElement('span')
        meta.className = 'playlist-meta'
        const time = document.createElement('span')
        time.textContent = formatTime(info.durationSeconds)
        const playingIcon = document.createElement('span')
        playingIcon.className = 'icon-round'
        playingIcon.textContent = 'equalizer'
        playingIcon.setAttribute('aria-hidden', 'true')
        meta.append(time, playingIcon)

        button.append(number, image, copy, meta)
        button.classList.toggle('is-current', index === playlistCurrentIndex)
        if (index === playlistCurrentIndex) button.setAttribute('aria-current', 'true')
        fragment.append(button)
    })
    playlistList.replaceChildren(fragment)
    playlistList.scrollTop = scrollTop
    if (focusedIndex !== undefined) {
        const items = Array.from(playlistList.children)
        const sameTrack = items.find(item => item.dataset.audioId === focusedAudioId && item.dataset.index === focusedIndex)
            || items.find(item => item.dataset.audioId === focusedAudioId)
        const next = sameTrack || items[Math.min(Number(focusedIndex), items.length - 1)]
        next?.focus({ preventScroll: true })
    }
}

function loadPlaylist(locateCurrent = false) {
    playlistLocateRequested = playlistLocateRequested || locateCurrent
    if (playlistRequest) return playlistRequest
    const generation = ++playlistGeneration
    playlistPanel.setAttribute('aria-busy', 'true')
    if (!playlistItems.length) playlistEmpty.textContent = '正在读取播放列表…'
    playlistRequest = (async () => {
        try {
            const values = await Promise.all([
                ipcRenderer.invoke('store:get', 'listPlaying'),
                ipcRenderer.invoke('store:get', 'listElementPlaying'),
            ])
            const list = parseStoredValue(values[0])
            const indexValue = parseStoredValue(values[1])
            const nextItems = Array.isArray(list) ? list : []
            let nextIndex = Number(indexValue)
            if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= nextItems.length) {
                nextIndex = nextItems.findIndex(item => String(item?.id) === String(currentAudioId))
            }
            if (closed || generation !== playlistGeneration) return
            if (String(nextItems[nextIndex]?.id) !== String(currentAudioId)) {
                nextIndex = nextItems.findIndex(item => String(item?.id) === String(currentAudioId))
            }
            const signature = JSON.stringify(nextItems.map(item => [item?.id, formatPlaylistItem(item)]))
            const changed = signature !== playlistSignature
            playlistItems = nextItems
            playlistCurrentIndex = nextIndex
            playlistSignature = signature
            if (changed || !playlistList.children.length) renderPlaylist()
            else updatePlaylistSelection()
            playlistEmpty.textContent = '当前播放列表为空'
            playlistStatus.textContent = '双击或按 Enter 播放'
            playlistRetry.hidden = true
            if (playlistLocateRequested && playlistOpen) {
                requestAnimationFrame(() => { if (playlistOpen) focusCurrentTrack() })
            }
        } catch (error) {
            if (closed || generation !== playlistGeneration) return
            playlistEmpty.textContent = '播放列表读取失败'
            playlistStatus.textContent = playlistItems.length ? '列表更新失败，保留上次内容' : '读取失败，请重试'
            playlistRetry.hidden = false
            console.warn('[control-widget] failed to load playlist:', error)
        } finally {
            playlistPanel.setAttribute('aria-busy', 'false')
            playlistLocateRequested = false
            playlistRequest = undefined
            clearTimeout(playlistRefreshTimer)
            if (!closed && playlistOpen && document.visibilityState !== 'hidden') {
                playlistRefreshTimer = setTimeout(() => { void loadPlaylist() }, 2000)
            }
        }
    })()
    return playlistRequest
}

function updatePlaylistSelection() {
    playlistList.querySelectorAll('.playlist-item').forEach((item, itemIndex) => {
        const current = itemIndex === playlistCurrentIndex
        item.classList.toggle('is-current', current)
        if (current) item.setAttribute('aria-current', 'true')
        else item.removeAttribute('aria-current')
    })
}

function updatePlaylistCurrentIndex() {
    if (!playlistItems.length || !currentAudioId) return
    const index = playlistItems.findIndex(item => String(item?.id) === String(currentAudioId))
    if (index === playlistCurrentIndex) return
    playlistCurrentIndex = index
    updatePlaylistSelection()
}

const update = subscribe('playstate', payload => {
    const [playing, progress, nextDuration, seconds] = Array.isArray(payload) ? payload : []
    if (Number.isFinite(Number(nextDuration)) && Number(nextDuration) > 0) {
        duration = Number(nextDuration)
    }
    updatePlayState(playing)
    updateProgress(progress, seconds)
})

const playerUpdate = subscribe('player', () => {
    void render()
})

const mainWindowUpdate = subscribe('mainWindowVisible', payload => {
    const [visible] = Array.isArray(payload) ? payload : []
    updateMainWindowState(visible)
})

let themeUpdated = false

function applyTheme({ colorHue, dark }) {
    const hue = Number(colorHue)
    if (Number.isFinite(hue)) {
        document.documentElement.style.setProperty('--accent-hue', String(hue))
    }
    document.body.classList.toggle('dark', Boolean(dark))
}

function onThemeChanged(_event, theme) {
    themeUpdated = true
    applyTheme(theme)
}

ipcRenderer.on('app:theme-changed', onThemeChanged)

win.beforeClose = async () => {
    closed = true
    ipcRenderer.removeListener('app:theme-changed', onThemeChanged)
    lyricGeneration++
    playlistGeneration++
    clearPendingSeek()
    clearTimeout(hoverLeaveTimer)
    clearTimeout(focusTimer)
    clearTimeout(feedbackTimer)
    clearTimeout(playlistRefreshTimer)
    if (lyricAnimationFrame) cancelAnimationFrame(lyricAnimationFrame)
    await Promise.allSettled([
        player.close(),
        playlist.close(),
        update.close(),
        playerUpdate.close(),
        mainWindowUpdate.close(),
    ])
}

;(async () => {
    try {
        const theme = await ipcRenderer.invoke('app?theme')
        // 打开控件期间若已收到切换通知，迟到的初始查询不能覆盖最新主题。
        if (!closed && !themeUpdated) applyTheme(theme)
    } catch {
        if (!closed && !themeUpdated) document.body.classList.add('dark')
    }
})()

document.body.addEventListener('mouseenter', () => {
    clearTimeout(hoverLeaveTimer)
    ipcRenderer.send('control-widget:mouseenter')
    isHovered = true
    syncWindowExpansion()
})

document.body.addEventListener('mouseleave', () => {
    clearTimeout(hoverLeaveTimer)
    hoverLeaveTimer = setTimeout(() => {
        isHovered = false
        syncWindowExpansion()
    }, 220)
    ipcRenderer.send('control-widget:mouseleave')
})

document.body.addEventListener('pointerdown', () => {
    keyboardMode = false
    keyboardFocusWithin = false
    syncWindowExpansion()
})

document.body.addEventListener('focusin', event => {
    clearTimeout(focusTimer)
    keyboardFocusWithin = keyboardMode || Boolean(event.target.matches(':focus-visible'))
    syncWindowExpansion()
})

document.body.addEventListener('focusout', () => {
    clearTimeout(focusTimer)
    focusTimer = setTimeout(() => {
        const active = document.activeElement
        keyboardFocusWithin = active !== document.body && document.body.contains(active)
            && (keyboardMode || active.matches(':focus-visible'))
        syncWindowExpansion()
    }, 0)
})

document.body.addEventListener('keydown', event => {
    if (event.key === 'Tab') keyboardMode = true
    if (event.key !== 'Escape' || event.defaultPrevented) return
    if (seekDrag) {
        event.preventDefault()
        endSeekDrag()
    } else if (playlistOpen) {
        event.preventDefault()
        setPlaylistOpen(false, true)
    } else if (preferencesOpen) {
        event.preventDefault()
        setPreferencesOpen(false, true)
    }
})

window.addEventListener('blur', () => {
    keyboardFocusWithin = false
    keyboardMode = false
    isHovered = false
    clearTimeout(hoverLeaveTimer)
    clearTimeout(focusTimer)
    syncWindowExpansion()
    ipcRenderer.send('control-widget:mouseleave')
})

window.addEventListener('focus', () => {
    if (playlistOpen) void loadPlaylist()
})

queueButton.addEventListener('click', () => {
    setPlaylistOpen(!playlistOpen)
})

document.getElementById('closePlaylist').addEventListener('click', () => setPlaylistOpen(false, true))
document.getElementById('locateCurrent').addEventListener('click', focusCurrentTrack)
playlistRetry.addEventListener('click', () => { void loadPlaylist() })
lyricsRetry.addEventListener('click', () => { void loadLyrics(currentAudioId) })

function playPlaylistItem(event) {
    const item = event.target.closest('.playlist-item')
    if (!item) return
    const index = Number(item.dataset.index)
    if (!Number.isInteger(index) || index < 0 || index >= playlistItems.length) return
    return runPlaybackAction(item, '歌曲播放', () => playlist.invoke(':play|' + index))
}

playlistList.addEventListener('dblclick', playPlaylistItem)
playlistList.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (!event.repeat) void playPlaylistItem(event)
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        const item = event.target.closest('.playlist-item')
        if (!item) return
        event.preventDefault()
        let index = Number(item.dataset.index)
        if (event.key === 'ArrowUp') index--
        if (event.key === 'ArrowDown') index++
        if (event.key === 'Home') index = 0
        if (event.key === 'End') index = playlistItems.length - 1
        playlistList.children[clamp(index, 0, playlistItems.length - 1)]?.focus()
    }
})

preferencesButton.addEventListener('click', () => setPreferencesOpen(!preferencesOpen))
document.getElementById('closePreferences').addEventListener('click', () => setPreferencesOpen(false, true))

let savedPreferences = { keepExpanded: false, autoHideDelay: 800 }
function applyPreferences(preferences) {
    savedPreferences = preferences
    keepExpandedInput.checked = preferences.keepExpanded
    autoHideDelayInput.value = String(preferences.autoHideDelay)
    autoHideDelayInput.disabled = preferences.keepExpanded
}

async function savePreferences() {
    keepExpandedInput.disabled = true
    autoHideDelayInput.disabled = true
    try {
        applyPreferences(await ipcRenderer.invoke('control-widget:preferences-save', {
            keepExpanded: keepExpandedInput.checked,
            autoHideDelay: Number(autoHideDelayInput.value),
        }))
    } catch (error) {
        applyPreferences(savedPreferences)
        showFeedback('偏好保存失败，请重试')
    } finally {
        keepExpandedInput.disabled = false
        autoHideDelayInput.disabled = savedPreferences.keepExpanded
    }
}

keepExpandedInput.addEventListener('change', savePreferences)
autoHideDelayInput.addEventListener('change', savePreferences)
document.getElementById('resetPosition').addEventListener('click', async () => {
    try {
        await ipcRenderer.invoke('control-widget:reset-position')
        showFeedback('已回到主屏')
    } catch (error) { showFeedback('位置恢复失败，请重试') }
})

void ipcRenderer.invoke('control-widget:preferences').then(applyPreferences).catch(() => {
    applyPreferences(savedPreferences)
    showFeedback('控件偏好读取失败，请重新打开控件')
})

progressBar.addEventListener('pointerdown', event => {
    if (!canSeek() || event.button !== 0 || !event.isPrimary || seekDrag) return
    event.preventDefault()
    progressBar.focus({ preventScroll: true })
    seekDrag = { pointerId: event.pointerId, seconds: getSeekTime(event.clientX) }
    progressBar.setPointerCapture(event.pointerId)
    progressBar.classList.add('is-seeking')
    syncWindowExpansion()
    showSeekPreview(seekDrag.seconds)
    renderProgress()
})

progressBar.addEventListener('pointermove', event => {
    if (!canSeek()) return
    if (seekDrag) {
        if (event.pointerId !== seekDrag.pointerId) return
        seekDrag.seconds = getSeekTime(event.clientX)
        renderProgress()
    }
    showSeekPreview(seekDrag?.seconds ?? getSeekTime(event.clientX))
})

progressBar.addEventListener('pointerleave', () => {
    if (!seekDrag) progressPreview.classList.remove('is-visible')
})

progressBar.addEventListener('pointerup', event => {
    if (!seekDrag || event.pointerId !== seekDrag.pointerId) return
    seekDrag.seconds = getSeekTime(event.clientX)
    const drag = endSeekDrag()
    void commitSeek(drag.seconds)
})

for (const eventName of ['pointercancel', 'lostpointercapture']) {
    progressBar.addEventListener(eventName, event => {
        if (seekDrag?.pointerId === event.pointerId) endSeekDrag()
    })
}

progressBar.addEventListener('keydown', event => {
    if (event.key === 'Escape' && seekDrag) {
        event.preventDefault()
        endSeekDrag()
        return
    }
    if (!canSeek() || seekDrag) return

    const current = pendingSeek?.seconds ?? currentTime
    const step = event.shiftKey ? 10 : 5
    let next
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = current - step
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + step
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = duration
    if (next === undefined) return

    event.preventDefault()
    next = clamp(next, 0, duration)
    void commitSeek(next)
})

expandButton.addEventListener('click', () => {
    mainWinVisible
        ? ipcRenderer.send('app:hideMainWindow')
        : ipcRenderer.send('app:restoreMainWindow')
})

playButton.addEventListener('click', () => {
    return runPlaybackAction(playButton, '播放操作', async () => {
        const playing = await player.invoke('.isPlaying')
        const result = await player.invoke(playing ? ':pause' : ':play')
        if (!result?.error) updatePlayState(!playing)
        return result
    })
})

document.getElementById('prevBtn').addEventListener('click', event => {
    return runPlaybackAction(event.currentTarget, '上一首', () => playlist.invoke(':previous'))
})

document.getElementById('nextBtn').addEventListener('click', event => {
    return runPlaybackAction(event.currentTarget, '下一首', () => playlist.invoke(':next'))
})

coverImage.addEventListener('error', () => {
    cover.classList.add('cover-empty')
})

async function render() {
    try {
        const audioData = await player.invoke('.audioData') || {}
        const nextDuration = Number(await player.invoke('.duration')) || 0
        const nextId = audioData?.id
        const trackChanged = String(nextId || '') !== String(currentAudioId || '')
        duration = nextDuration
        currentAudioId = nextId
        if (trackChanged) resetSeekInteraction()

        setTrackText(trackName, getTrackTitle(audioData), '暂无歌曲')
        setTrackText(trackArtist, getArtistText(audioData), '等待播放')
        setTrackText(trackAlbum, getAlbumText(audioData), '播放控件')

        const picture = getCoverUrl(audioData)
        cover.classList.toggle('cover-empty', !picture)
        if (picture && picture !== currentCoverUrl) {
            currentCoverUrl = picture
            coverImage.src = picture
        } else if (!picture) {
            currentCoverUrl = ''
            coverImage.removeAttribute('src')
        }

        updateProgress(currentProgress, currentTime)
        updatePlaylistCurrentIndex()
        if (trackChanged) {
            void loadLyrics(nextId)
            void loadPlaylist()
        }
    } catch (error) {
        duration = 0
        currentAudioId = undefined
        resetSeekInteraction()
        setTrackText(trackName, '', '暂无歌曲')
        setTrackText(trackArtist, '', '等待播放')
        setTrackText(trackAlbum, '', '播放控件')
        cover.classList.add('cover-empty')
        void loadLyrics(undefined)
        updateProgress(0, 0)
        console.warn('[control-widget] failed to render player state:', error)
    }
}

updatePlayState(false)
updateMainWindowState(false)
updateIdleLyric()
syncWindowExpansion()
void loadPlaylist()
void render()
