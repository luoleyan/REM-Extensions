import { ipcRenderer } from "electron"

const { subscribe, connect } = window
const player = connect('player-controller')
const playlist = connect('playlist')

interface Lyric {
    time: number
    lyric: string
    translation?: string
    romanization?: string
    translationWords?: TimedWord[]
    romanizationWords?: TimedWord[]
}

interface TimedWord {
    start: number
    duration: number
    text: string
}

type TimingMode = 'exact' | 'uniform'

interface TimedLyricLine {
    time: number
    duration: number
    words: TimedWord[]
    timing: TimingMode
}

interface LyricSettings {
    highlightColor: string
    colorNext: string
    backgroundColor: string
    fontFamily: string
    fontFilePath: string
    fontDisplayName: string
    textShadow: boolean
    fontSize: number
    lyricsOpacity: number
    customPresets: StylePreset[]
    lock: boolean
    showTranslatedLyric: boolean
    showRomaLyric: boolean
    clickToSeek: boolean
}

type IncomingLyricSettings = Partial<LyricSettings> & { colorCurrent?: unknown }

interface ImportedFont {
    path: string
    name: string
    dataUrl: string
}

interface StylePreset {
    id: string
    name: string
    description: string
    highlightColor: string
    colorNext: string
    backgroundColor: string
    fontFamily: string
    fontFilePath: string
    fontDisplayName: string
    fontSize: number
    lyricsOpacity: number
    textShadow: boolean
}

const stylePresets: StylePreset[] = [
    {
        id: 'aurora',
        name: '极光',
        description: '清透冷色 · 现代感',
        highlightColor: '#9cf8ff',
        colorNext: '#b9d9e5',
        backgroundColor: 'rgba(9, 22, 34, .82)',
        fontFamily: 'system-ui',
        fontFilePath: '',
        fontDisplayName: '',
        fontSize: 30,
        lyricsOpacity: 100,
        textShadow: true,
    },
    {
        id: 'sunset',
        name: '暮光',
        description: '暖金高亮 · 舞台感',
        highlightColor: '#ffd166',
        colorNext: '#ffd7a3',
        backgroundColor: 'rgba(40, 20, 16, .82)',
        fontFamily: 'Georgia',
        fontFilePath: '',
        fontDisplayName: '',
        fontSize: 30,
        lyricsOpacity: 100,
        textShadow: true,
    },
    {
        id: 'mono',
        name: '银幕',
        description: '黑白对比 · 极简',
        highlightColor: '#ffffff',
        colorNext: '#a9b0bc',
        backgroundColor: 'rgba(0, 0, 0, .72)',
        fontFamily: 'Segoe UI',
        fontFilePath: '',
        fontDisplayName: '',
        fontSize: 28,
        lyricsOpacity: 100,
        textShadow: false,
    },
    {
        id: 'violet',
        name: '霓虹',
        description: '高饱和色 · 夜间氛围',
        highlightColor: '#ff8cff',
        colorNext: '#b8b7ff',
        backgroundColor: 'rgba(31, 17, 44, .82)',
        fontFamily: 'Segoe UI',
        fontFilePath: '',
        fontDisplayName: '',
        fontSize: 30,
        lyricsOpacity: 100,
        textShadow: true,
    },
]

const FONT_SIZE_MIN = 12
const FONT_SIZE_MAX = 72
const LYRICS_OPACITY_MIN = 20
const LYRICS_OPACITY_MAX = 100
const CUSTOM_PRESET_MAX = 12
const fontSizeKeywords: Record<string, number> = {
    small: 16,
    medium: 20,
    large: 24,
    'x-large': 28,
    'xx-large': 32,
}

let lyrics: Lyric[] = []
let timedLyrics: TimedLyricLine[] = []
let currentSettings: LyricSettings = {
    highlightColor: 'gold',
    colorNext: 'aquamarine',
    backgroundColor: 'transparent',
    fontFamily: 'system-ui',
    fontFilePath: '',
    fontDisplayName: '',
    textShadow: true,
    fontSize: 28,
    lyricsOpacity: 100,
    customPresets: [],
    lock: false,
    showTranslatedLyric: true,
    showRomaLyric: true,
    clickToSeek: false,
}
let playbackTime = 0
let isPlaying = false
let activeLineIndex = -1
type RenderedState = number | 'prelude' | 'empty'
let renderedState: RenderedState = 'empty'
let lastFrameTime = 0
let frameHandle = 0
let lastPlaybackSyncTime = 0
let playbackCorrection = 0
let playbackSyncInFlight = false
let lockState = true
let loadGeneration = 0
let lyricsStatus: 'loading' | 'empty' | 'error' | '' = 'loading'
let refreshingLyrics = false
let transportBusy = false

const PLAYBACK_SYNC_INTERVAL = 2500
const PLAYBACK_HARD_DRIFT = 450
const PLAYBACK_SMOOTH_DRIFT = 120

const lineTop = document.getElementById('top') as HTMLDivElement
const lineBottom = document.getElementById('bottom') as HTMLDivElement
const translation = document.getElementById('translation') as HTMLDivElement
const romanization = document.getElementById('romanization') as HTMLDivElement
const translationButton = document.getElementById('toggle-translation') as HTMLButtonElement
const romanizationButton = document.getElementById('toggle-romanization') as HTMLButtonElement
const previousButton = document.getElementById('previous') as HTMLButtonElement
const playButton = document.getElementById('play-pause') as HTMLButtonElement
const nextButton = document.getElementById('next') as HTMLButtonElement
const lockButton = document.getElementById('lock') as HTMLButtonElement
const settingsButton = document.getElementById('settings') as HTMLButtonElement
const settingsPanel = document.getElementById('settings-panel') as HTMLElement
const settingsFontSize = document.getElementById('settings-font-size') as HTMLInputElement
const settingsFontSizeDecrease = document.getElementById('settings-font-size-decrease') as HTMLButtonElement
const settingsFontSizeIncrease = document.getElementById('settings-font-size-increase') as HTMLButtonElement
const settingsHighlightColor = document.getElementById('settings-highlight-color') as HTMLInputElement
const settingsNextColor = document.getElementById('settings-next-color') as HTMLInputElement
const settingsBackgroundColor = document.getElementById('settings-background-color') as HTMLInputElement
const settingsHighlightPicker = document.getElementById('settings-highlight-picker') as HTMLInputElement
const settingsNextPicker = document.getElementById('settings-next-picker') as HTMLInputElement
const settingsBackgroundPicker = document.getElementById('settings-background-picker') as HTMLInputElement
const settingsHighlightValue = document.getElementById('settings-highlight-value') as HTMLOutputElement
const settingsNextValue = document.getElementById('settings-next-value') as HTMLOutputElement
const settingsBackgroundValue = document.getElementById('settings-background-value') as HTMLOutputElement
const settingsBackgroundOpacity = document.getElementById('settings-background-opacity') as HTMLInputElement
const settingsBackgroundOpacityValue = document.getElementById('settings-background-opacity-value') as HTMLOutputElement
const settingsLyricsOpacity = document.getElementById('settings-lyrics-opacity') as HTMLInputElement
const settingsLyricsOpacityValue = document.getElementById('settings-lyrics-opacity-value') as HTMLOutputElement
const settingsFontFamily = document.getElementById('settings-font-family') as HTMLInputElement
const settingsFontPreset = document.getElementById('settings-font-preset') as HTMLSelectElement
const settingsFontImport = document.getElementById('settings-font-import') as HTMLButtonElement
const settingsFontClear = document.getElementById('settings-font-clear') as HTMLButtonElement
const settingsFontMeta = document.getElementById('settings-font-meta') as HTMLDivElement
const settingsTextShadow = document.getElementById('settings-text-shadow') as HTMLInputElement
const settingsDismiss = document.getElementById('settings-dismiss') as HTMLButtonElement
const settingsSaveStatus = document.getElementById('settings-save-status') as HTMLSpanElement
const settingsPresetButtons = [...settingsPanel.querySelectorAll<HTMLButtonElement>('[data-preset]')]
const settingsCustomPresets = document.getElementById('settings-custom-presets') as HTMLDivElement
const settingsPresetName = document.getElementById('settings-preset-name') as HTMLInputElement
const settingsSavePreset = document.getElementById('settings-save-preset') as HTMLButtonElement
const settingsTabs = [...settingsPanel.querySelectorAll<HTMLButtonElement>('[data-settings-tab]')]
const settingsSections = [...settingsPanel.querySelectorAll<HTMLElement>('[data-settings-section]')]
const settingsPanelControls = [...settingsPanel.querySelectorAll('input, select, button')] as Array<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>
const playIcon = playButton.querySelector('.icon-round') as HTMLElement
const lockIcon = lockButton.querySelector('.icon-round') as HTMLElement
const lyricsWindow = document.getElementById('lyrics-window') as HTMLDivElement
const controls = document.querySelector('.controls') as HTMLElement
const status = document.getElementById('status') as HTMLDivElement
const statusMessage = document.getElementById('status-message') as HTMLSpanElement
const retryButton = document.getElementById('retry') as HTMLButtonElement
const timingMode = document.getElementById('timing-mode') as HTMLSpanElement
let dragPointerId: number | null = null
let settingsOpen = false
let settingsRevealPending = false
let activeSettingsTab = 'theme'
let importedFontFace: FontFace | undefined
let importedFontPath = ''
let windowFitTimer: ReturnType<typeof setTimeout> | undefined
let lastRequestedWindowHeight = 0

function textValue(value: unknown, fallback: string) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function parseCssColor(value: string) {
    if (typeof getComputedStyle !== 'function' || !document.body) return null
    const probe = document.createElement('span')
    probe.style.color = value
    if (!probe.style.color) return null
    document.body.append(probe)
    const computed = getComputedStyle(probe).color
    probe.remove()
    const channels = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/u)
    if (!channels) return null
    return {
        red: Number(channels[1]),
        green: Number(channels[2]),
        blue: Number(channels[3]),
        alpha: channels[4] === undefined ? 1 : Number(channels[4]),
    }
}

function cssColorToHex(value: string, fallback: string) {
    const parsed = parseCssColor(value)
    if (!parsed) return fallback
    return `#${[parsed.red, parsed.green, parsed.blue].map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}

function cssColorAlpha(value: string) {
    return Math.round((parseCssColor(value)?.alpha ?? 1) * 100)
}

function composeBackgroundColor(hex: string, alpha: number) {
    const parsed = parseCssColor(hex)
    if (!parsed || alpha <= 0) return 'transparent'
    if (alpha >= 100) return hex
    return `rgba(${parsed.red}, ${parsed.green}, ${parsed.blue}, ${(alpha / 100).toFixed(2)})`
}

function updateColorValue(output: HTMLOutputElement, value: string) {
    output.value = value
    output.textContent = value
}

function updateBackgroundOpacityLabel(value: string) {
    const normalized = Math.min(100, Math.max(0, Number(value) || 0))
    settingsBackgroundOpacityValue.value = `${normalized}%`
    settingsBackgroundOpacityValue.textContent = `${normalized}%`
}

function isPresetActive(preset: StylePreset) {
    return currentSettings.highlightColor.toLowerCase() === preset.highlightColor.toLowerCase()
        && currentSettings.colorNext.toLowerCase() === preset.colorNext.toLowerCase()
        && currentSettings.backgroundColor.toLowerCase() === preset.backgroundColor.toLowerCase()
        && currentSettings.fontFamily === preset.fontFamily
        && currentSettings.fontFilePath === preset.fontFilePath
        && currentSettings.fontDisplayName === preset.fontDisplayName
        && currentSettings.fontSize === preset.fontSize
        && currentSettings.lyricsOpacity === preset.lyricsOpacity
        && currentSettings.textShadow === preset.textShadow
}

function presetSettings(preset: StylePreset): Partial<LyricSettings> {
    return {
        highlightColor: preset.highlightColor,
        colorNext: preset.colorNext,
        backgroundColor: preset.backgroundColor,
        fontFamily: preset.fontFamily,
        fontFilePath: preset.fontFilePath,
        fontDisplayName: preset.fontDisplayName,
        fontSize: preset.fontSize,
        lyricsOpacity: preset.lyricsOpacity,
        textShadow: preset.textShadow,
    }
}

function currentStylePreset(id: string, name: string, description = '自定义歌词样式'): StylePreset {
    return {
        id,
        name,
        description,
        highlightColor: currentSettings.highlightColor,
        colorNext: currentSettings.colorNext,
        backgroundColor: currentSettings.backgroundColor,
        fontFamily: currentSettings.fontFamily,
        fontFilePath: currentSettings.fontFilePath,
        fontDisplayName: currentSettings.fontDisplayName,
        fontSize: currentSettings.fontSize,
        lyricsOpacity: currentSettings.lyricsOpacity,
        textShadow: currentSettings.textShadow,
    }
}

function updatePresetState() {
    for (const button of settingsPresetButtons) {
        const preset = stylePresets.find(item => item.id === button.dataset.preset)
        button.setAttribute('aria-pressed', String(Boolean(preset && isPresetActive(preset))))
    }
    for (const button of settingsCustomPresets.querySelectorAll<HTMLButtonElement>('[data-custom-preset-apply]')) {
        const preset = currentSettings.customPresets.find(item => item.id === button.dataset.customPresetApply)
        button.setAttribute('aria-pressed', String(Boolean(preset && isPresetActive(preset))))
    }
}

function renderCustomPresets() {
    settingsCustomPresets.textContent = ''
    if (!currentSettings.customPresets.length) {
        const empty = document.createElement('div')
        empty.className = 'settings-custom-empty'
        empty.textContent = '还没有自定义主题，调整好样式后即可保存。'
        settingsCustomPresets.append(empty)
        return
    }

    for (const preset of currentSettings.customPresets) {
        const card = document.createElement('div')
        card.className = 'settings-custom-preset'

        const apply = document.createElement('button')
        apply.type = 'button'
        apply.className = 'settings-preset settings-custom-preset-apply'
        apply.dataset.customPresetApply = preset.id
        apply.setAttribute('aria-pressed', 'false')
        apply.title = `应用主题：${preset.name}`

        const swatches = document.createElement('span')
        swatches.className = 'settings-preset-swatches'
        swatches.setAttribute('aria-hidden', 'true')
        const highlight = document.createElement('i')
        highlight.style.background = preset.highlightColor
        const next = document.createElement('i')
        next.style.background = preset.colorNext
        swatches.append(highlight, next)

        const copy = document.createElement('span')
        copy.className = 'settings-preset-copy'
        const name = document.createElement('strong')
        name.textContent = preset.name
        const description = document.createElement('small')
        description.textContent = preset.description
        copy.append(name, description)
        apply.append(swatches, copy)
        apply.addEventListener('click', () => {
            if (!preset.fontFilePath) clearImportedFont()
            void saveSettings(presetSettings(preset))
        })

        const remove = document.createElement('button')
        remove.type = 'button'
        remove.className = 'settings-custom-preset-delete'
        remove.title = `删除主题：${preset.name}`
        remove.setAttribute('aria-label', `删除主题：${preset.name}`)
        const removeIcon = document.createElement('span')
        removeIcon.className = 'icon-round'
        removeIcon.setAttribute('aria-hidden', 'true')
        removeIcon.textContent = 'delete'
        remove.append(removeIcon)
        remove.addEventListener('click', () => {
            if (!window.confirm(`确定删除主题“${preset.name}”吗？`)) return
            void saveSettings({
                customPresets: currentSettings.customPresets.filter(item => item.id !== preset.id),
            })
        })

        card.append(apply, remove)
        settingsCustomPresets.append(card)
    }
}

function initializePresetSwatches() {
    for (const button of settingsPresetButtons) {
        const preset = stylePresets.find(item => item.id === button.dataset.preset)
        const swatches = button.querySelectorAll<HTMLElement>('.settings-preset-swatches i')
        if (!preset || swatches.length < 2) continue
        swatches[0].style.background = preset.highlightColor
        swatches[1].style.background = preset.colorNext
    }
}

async function installImportedFont(font: ImportedFont) {
    if (!font.dataUrl) return false
    try {
        const face = new FontFace('DesktopLyricsImported', `url(${font.dataUrl})`)
        await face.load()
        if (importedFontFace) document.fonts.delete(importedFontFace)
        document.fonts.add(face)
        importedFontFace = face
        importedFontPath = font.path
        return true
    } catch (error) {
        console.warn('[desktop-lyrics] failed to load imported font:', error)
        return false
    }
}

function clearImportedFont() {
    if (importedFontFace) document.fonts.delete(importedFontFace)
    importedFontFace = undefined
    importedFontPath = ''
}

async function restoreImportedFont(filePath: string) {
    if (!filePath || importedFontPath === filePath) return
    const font = await ipcRenderer.invoke('desktop-lyrics-load-font', filePath) as ImportedFont | null
    if (!font || !await installImportedFont(font)) return
    if (currentSettings.fontFilePath === filePath) {
        applyVisualSettings()
        syncSettingsForm()
    }
}

function fontSizeValue(value: unknown, fallback = currentSettings.fontSize) {
    let size: number | undefined
    if (typeof value === 'number' && Number.isFinite(value)) size = value
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        size = fontSizeKeywords[normalized]
        if (size === undefined && /^(?:\d+(?:\.\d+)?)(?:px)?$/u.test(normalized)) size = Number.parseFloat(normalized)
    }
    if (!Number.isFinite(size)) size = fallback
    return Math.round(Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size!)))
}

function lyricsOpacityValue(value: unknown, fallback = currentSettings.lyricsOpacity) {
    const opacity = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(opacity)) return fallback
    return Math.round(Math.min(LYRICS_OPACITY_MAX, Math.max(LYRICS_OPACITY_MIN, opacity)))
}

function normalizeCustomPresets(value: unknown): StylePreset[] {
    if (!Array.isArray(value)) return []
    const ids = new Set<string>()
    return value.slice(0, CUSTOM_PRESET_MAX).flatMap((item, index) => {
        if (!item || typeof item !== 'object') return []
        const stored = item as Record<string, unknown>
        let id = textValue(stored.id, `custom-${index + 1}`)
        while (ids.has(id)) id = `${id}-${index + 1}`
        ids.add(id)
        return [{
            id,
            name: textValue(stored.name, `我的主题 ${index + 1}`).slice(0, 24),
            description: textValue(stored.description, '自定义歌词样式').slice(0, 40),
            highlightColor: textValue(stored.highlightColor, 'gold'),
            colorNext: textValue(stored.colorNext, 'aquamarine'),
            backgroundColor: textValue(stored.backgroundColor, 'transparent'),
            fontFamily: textValue(stored.fontFamily, 'system-ui'),
            fontFilePath: textValue(stored.fontFilePath, ''),
            fontDisplayName: textValue(stored.fontDisplayName, ''),
            textShadow: typeof stored.textShadow === 'boolean' ? stored.textShadow : true,
            fontSize: fontSizeValue(stored.fontSize, 28),
            lyricsOpacity: lyricsOpacityValue(stored.lyricsOpacity, 100),
        }]
    })
}

function normalizeSettings(value: unknown): LyricSettings {
    const stored = value && typeof value === 'object' ? value as IncomingLyricSettings : {}
    return {
        highlightColor: textValue(stored.highlightColor ?? stored.colorCurrent, 'gold'),
        colorNext: textValue(stored.colorNext, 'aquamarine'),
        backgroundColor: textValue(stored.backgroundColor, 'transparent'),
        fontFamily: textValue(stored.fontFamily, 'system-ui'),
        fontFilePath: textValue(stored.fontFilePath, ''),
        fontDisplayName: textValue(stored.fontDisplayName, ''),
        textShadow: typeof stored.textShadow === 'boolean' ? stored.textShadow : true,
        fontSize: fontSizeValue(stored.fontSize),
        lyricsOpacity: lyricsOpacityValue(stored.lyricsOpacity),
        customPresets: normalizeCustomPresets(stored.customPresets),
        lock: typeof stored.lock === 'boolean' ? stored.lock : false,
        showTranslatedLyric: typeof stored.showTranslatedLyric === 'boolean' ? stored.showTranslatedLyric : true,
        showRomaLyric: typeof stored.showRomaLyric === 'boolean' ? stored.showRomaLyric : true,
        clickToSeek: typeof stored.clickToSeek === 'boolean' ? stored.clickToSeek : false,
    }
}

function stopDragging() {
    if (dragPointerId !== null && lyricsWindow.hasPointerCapture(dragPointerId)) {
        lyricsWindow.releasePointerCapture(dragPointerId)
    }
    dragPointerId = null
    ipcRenderer.send('desktop-lyrics-drag', 'end')
}

lyricsWindow.addEventListener('pointerdown', event => {
    if (lockState || event.button !== 0 || (event.target as Element).closest('button, input, select, textarea, label, .settings-panel')) return
    dragPointerId = event.pointerId
    lyricsWindow.setPointerCapture(event.pointerId)
    ipcRenderer.send('desktop-lyrics-drag', 'start')
})
lyricsWindow.addEventListener('pointermove', event => {
    if (!lockState && lyricsWindow.hasPointerCapture(event.pointerId)) {
        ipcRenderer.send('desktop-lyrics-drag', 'move')
    }
})
lyricsWindow.addEventListener('pointerup', stopDragging)
lyricsWindow.addEventListener('pointercancel', stopDragging)
lyricsWindow.addEventListener('lostpointercapture', stopDragging)

function reportHitRegions() {
    const bounds = lyricsWindow.getBoundingClientRect()
    const controlsBounds = controls.getBoundingClientRect()
    const settingsBounds = settingsOpen ? settingsPanel.getBoundingClientRect() : controlsBounds
    const controlsLeft = Math.min(controlsBounds.x, settingsBounds.x)
    const controlsTop = Math.min(controlsBounds.y, settingsBounds.y)
    const controlsRight = Math.max(controlsBounds.right, settingsBounds.right)
    const controlsBottom = Math.max(controlsBounds.bottom, settingsBounds.bottom)
    ipcRenderer.send('desktop-lyrics-regions', {
        lyrics: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        controls: {
            x: controlsLeft,
            y: controlsTop,
            width: controlsRight - controlsLeft,
            height: controlsBottom - controlsTop,
        },
        viewport: { width: innerWidth, height: innerHeight },
    })
}

function requestWindowFit() {
    if (windowFitTimer !== undefined) clearTimeout(windowFitTimer)
    windowFitTimer = setTimeout(() => {
        windowFitTimer = undefined
        const naturalHeight = Math.max(lyricsWindow.scrollHeight, lyricsWindow.getBoundingClientRect().height)
        // 保持窗口高度覆盖设置面板；歌词内容由 body 锚定到窗口底部，避免透明窗口把歌词垫离任务栏。
        const minimumHeight = 320
        const height = Math.max(minimumHeight, Math.ceil(naturalHeight + 8))
        if (height === lastRequestedWindowHeight) return
        lastRequestedWindowHeight = height
        ipcRenderer.send('desktop-lyrics-window-size', { height })
    }, 0)
}

function positionSettingsPanel() {
    if (!settingsOpen) return
    const margin = 12
    settingsPanel.style.top = `${margin}px`
    settingsPanel.style.bottom = `${margin}px`
    settingsPanel.style.maxHeight = `${Math.max(1, innerHeight - margin * 2)}px`
}

function setSettingsTab(tab: string) {
    const nextTab = settingsSections.some(section => section.dataset.settingsSection === tab) ? tab : 'theme'
    activeSettingsTab = nextTab

    for (const button of settingsTabs) {
        const active = button.dataset.settingsTab === nextTab
        button.setAttribute('aria-selected', String(active))
        button.tabIndex = active ? 0 : -1
    }

    for (const section of settingsSections) {
        section.hidden = section.dataset.settingsSection !== nextTab
    }
}

function revealSettingsPanel() {
    if (!settingsOpen || !settingsRevealPending) return
    settingsRevealPending = false
    settingsPanel.hidden = false
    lyricsWindow.classList.add('settings-open')
    requestAnimationFrame(() => {
        positionSettingsPanel()
        reportHitRegions()
    })
}

const regionObserver = new ResizeObserver(() => {
    reportHitRegions()
    requestWindowFit()
})
regionObserver.observe(lyricsWindow)
regionObserver.observe(controls)
regionObserver.observe(settingsPanel)
window.addEventListener('resize', () => {
    if (innerHeight >= 320 && settingsRevealPending) requestAnimationFrame(revealSettingsPanel)
    positionSettingsPanel()
    reportHitRegions()
})
const onLockedHover = (_event: unknown, hovering: boolean) => document.body.classList.toggle('lyrics-hover', hovering)
ipcRenderer.on('desktop-lyrics-hover', onLockedHover)

async function requestSettings(command: ['get'] | ['set', LyricSettings]): Promise<LyricSettings> {
    const settings = connect('settings')
    try {
        const response = await settings.invoke(JSON.stringify(command))
        if (response?.error) throw new Error(response.error)
        return normalizeSettings(typeof response === 'string' ? JSON.parse(response) : response)
    } finally {
        void settings.close()
    }
}

async function loadLyrics() {
    const generation = ++loadGeneration
    const hadLyrics = lyrics.length > 0
    refreshingLyrics = hadLyrics
    lyricsStatus = 'loading'
    if (!hadLyrics) {
        lyrics = []
        timedLyrics = []
        activeLineIndex = -1
        renderedState = 'empty'
    }
    renderLines(playbackTime)
    const requestPlayer = connect('player-controller')
    const requestLyrics = connect('lyric')
    try {
        const audioData = await requestPlayer.invoke('.audioData')
        if (!audioData?.id) {
            if (generation !== loadGeneration) return
            refreshingLyrics = false
            lyrics = []
            timedLyrics = []
            activeLineIndex = -1
            renderedState = 'empty'
            lyricsStatus = 'empty'
            renderLines(playbackTime)
            return
        }

        const data = await requestLyrics.invoke(String(audioData.id))
        const response = typeof data === 'string' ? JSON.parse(data) : data
        const lineLyrics = response?.lrc ?? response?.data?.lrc
        const wordLyrics = response?.yrc ?? response?.data?.yrc
        const translationSource = response?.tlyric ?? response?.data?.tlyric
        const romanizationSource = response?.romalrc ?? response?.data?.romalrc
        const timedTranslationSource = response?.ytlrc ?? response?.data?.ytlrc
        const timedRomanizationSource = response?.yromalrc ?? response?.data?.yromalrc
        const translations = parseLrc(translationSource?.lyric)
        const romanizations = parseLrc(romanizationSource?.lyric)
        const timedTranslations = parseYrc(timedTranslationSource?.lyric)
        const timedRomanizations = parseYrc(timedRomanizationSource?.lyric)
        const originalLines = parseLrc(lineLyrics?.lyric).map(line => ({
            ...line,
            translation: findAuxiliaryLine(translations, line)?.lyric ?? timedLineText(findAuxiliaryTimedLine(timedTranslations, line)),
            romanization: findAuxiliaryLine(romanizations, line)?.lyric ?? timedLineText(findAuxiliaryTimedLine(timedRomanizations, line)),
            translationWords: findAuxiliaryTimedLine(timedTranslations, line)?.words,
            romanizationWords: findAuxiliaryTimedLine(timedRomanizations, line)?.words,
        }))
        const parsedTimedLyrics = parseYrc(wordLyrics?.lyric)
        let nextLyrics = originalLines
        let nextTimedLyrics = parsedTimedLyrics

        if (parsedTimedLyrics.length) {
            nextLyrics = parsedTimedLyrics.map((line, index) => {
                const text = line.words.map(word => word.text).join('')
                // YRC 可能省略元数据行并调整起点，优先按文本和最近时间关联普通歌词。
                const original = findLyricLine(originalLines, text, line.time) ??
                    (originalLines.length === parsedTimedLyrics.length ? originalLines[index] : undefined)
                return {
                    time: line.time,
                    lyric: text,
                    translation: original?.translation ?? findAuxiliaryLine(translations, { time: line.time, lyric: text })?.lyric ?? timedLineText(findAuxiliaryTimedLine(timedTranslations, line)),
                    romanization: original?.romanization ?? findAuxiliaryLine(romanizations, { time: line.time, lyric: text })?.lyric ?? timedLineText(findAuxiliaryTimedLine(timedRomanizations, line)),
                    translationWords: original?.translationWords ?? findAuxiliaryTimedLine(timedTranslations, line)?.words,
                    romanizationWords: original?.romanizationWords ?? findAuxiliaryTimedLine(timedRomanizations, line)?.words,
                }
            })
        } else {
            const songDuration = Number(await requestPlayer.invoke('.duration')) * 1000
            const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
            // 普通歌词按句子时长均分到字形，换行后也按阅读顺序推进。
            nextTimedLyrics = nextLyrics.map((line, index) => {
                const end = nextLyrics[index + 1]?.time ?? (songDuration > line.time ? songDuration : line.time + 4000)
                const duration = Math.max(1, end - line.time)
                const characters = Array.from(segmenter.segment(line.lyric), part => part.segment)
                return {
                    time: line.time,
                    duration,
                    words: characters.map((text, characterIndex) => ({
                        start: line.time + duration * characterIndex / characters.length,
                        duration: duration / characters.length,
                        text,
                    })),
                    timing: 'uniform',
                }
            })
        }

        const latestAudioData = await requestPlayer.invoke('.audioData')
        if (generation !== loadGeneration || latestAudioData?.id !== audioData.id) return
        lyrics = nextLyrics
        timedLyrics = nextTimedLyrics
        refreshingLyrics = false
        lyricsStatus = lyrics.length ? '' : 'empty'
        activeLineIndex = -1
        renderedState = 'empty'
        renderLines(playbackTime)
    } catch (error) {
        if (generation === loadGeneration) {
            refreshingLyrics = false
            if (!hadLyrics) {
                lyrics = []
                timedLyrics = []
                activeLineIndex = -1
                renderedState = 'empty'
            }
            lyricsStatus = 'error'
            renderLines(playbackTime)
        }
        console.error('[desktop-lyrics] failed to load lyrics:', error)
    } finally {
        void requestPlayer.close()
        void requestLyrics.close()
    }
}

function parseLrc(source?: string): Lyric[] {
    if (!source) return []
    let offset = 0
    const parsed: Lyric[] = []
    for (const rawLine of source.split(/\r?\n/)) {
        const offsetMatch = /^\[offset:([+-]?\d+)\]/i.exec(rawLine.trim())
        if (offsetMatch) {
            offset = Number(offsetMatch[1])
            continue
        }
        const tags = [...rawLine.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]
        if (!tags.length) continue
        const text = rawLine.replace(/^\s*(?:\[[^\]]+\])+/, '')
        if (!text.trim() || isMetadataLine(text)) continue
        for (const tag of tags) {
            parsed.push({
                time: Math.max(0, Math.round((Number(tag[1]) * 60 + Number(tag[2])) * 1000) + offset),
                lyric: text,
            })
        }
    }
    return parsed.sort((a, b) => a.time - b.time)
}

function isMetadataLine(value: string) {
    return /^(作词|作曲|编曲|制作|监制|混音|母带|原唱|录音|和声|词|曲|publisher|produced|lyrics|composer|arranger)\s*[:：]/i.test(value.trim())
}

function normalizeLyricText(value: string) {
    return value.normalize('NFKC').replace(/[\s\u3000]+/g, '').trim().toLocaleLowerCase()
}

function findLyricLine(lines: Lyric[], text: string, time: number) {
    const normalized = normalizeLyricText(text)
    return lines
        .filter(line => normalizeLyricText(line.lyric) === normalized)
        .sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0]
}

function findAuxiliaryLine(lines: Lyric[], line: Lyric) {
    return lines
        .filter(candidate => Math.abs(candidate.time - line.time) <= 500)
        .sort((a, b) => Math.abs(a.time - line.time) - Math.abs(b.time - line.time))[0]
}

function findAuxiliaryTimedLine(lines: TimedLyricLine[], line: { time: number }) {
    return lines
        .filter(candidate => Math.abs(candidate.time - line.time) <= 500)
        .sort((a, b) => Math.abs(a.time - line.time) - Math.abs(b.time - line.time))[0]
}

function timedLineText(line?: TimedLyricLine) {
    return line?.words.map(word => word.text).join('')
}

function parseYrc(source?: string): TimedLyricLine[] {
    if (!source) return []
    return source.split('\n').flatMap(line => {
        const header = /^\[(\d+),(\d+)\]/.exec(line)
        if (!header) return []

        const words: TimedWord[] = []
        const pattern = /\((\d+),(\d+),\d+\)([^()]*)/g
        let match: RegExpExecArray | null
        while ((match = pattern.exec(line.slice(header[0].length))) !== null) {
            const start = Number(match[1])
            words.push({
                start,
                duration: Math.max(1, Number(match[2])),
                text: match[3],
            })
        }
        return words.length ? [{
            time: Number(header[1]),
            duration: Number(header[2]),
            words,
            timing: 'exact',
        }] : []
    })
}

function getLineIndex(time: number): number {
    if (!lyrics.length || time < lyrics[0].time) return -1
    let index = 0
    for (let i = 1; i < lyrics.length; i++) {
        if (lyrics[i].time > time) break
        index = i
    }
    return index
}

async function renderLines(time: number) {
    playbackTime = time
    if (!lyrics.length) {
        lyricsWindow.classList.remove('lyrics-refreshing', 'lyrics-stale')
        delete status.dataset.mode
        timingMode.hidden = true
        if (renderedState !== 'empty') {
            lineTop.textContent = ''
            lineBottom.textContent = ''
            delete lineTop.dataset.timing
            delete lineBottom.dataset.timing
            delete lineTop.dataset.lineIndex
            delete lineBottom.dataset.lineIndex
        }
        renderSupplementaryLyrics()
        activeLineIndex = -1
        renderedState = 'empty'
        status.hidden = !lyricsStatus
        statusMessage.textContent = lyricsStatus === 'loading'
            ? '歌词加载中…'
            : lyricsStatus === 'error' ? '歌词加载失败' : '暂无歌词'
        retryButton.hidden = lyricsStatus === 'loading'
        retryButton.disabled = lyricsStatus === 'loading'
        return
    }

    const loadingExistingLyrics = lyricsStatus === 'loading' && refreshingLyrics
    const failedWithExistingLyrics = lyricsStatus === 'error'
    lyricsWindow.classList.toggle('lyrics-refreshing', loadingExistingLyrics)
    lyricsWindow.classList.toggle('lyrics-stale', failedWithExistingLyrics)
    status.hidden = !loadingExistingLyrics && !failedWithExistingLyrics
    status.dataset.mode = loadingExistingLyrics ? 'refreshing' : failedWithExistingLyrics ? 'error' : ''
    statusMessage.textContent = loadingExistingLyrics ? '歌词更新中…' : '歌词加载失败'
    retryButton.hidden = !failedWithExistingLyrics
    retryButton.disabled = false

    const nextIndex = getLineIndex(time)
    updateTimingMode(nextIndex < 0 ? timedLyrics[0]?.timing : timedLyrics[nextIndex]?.timing)
    if (nextIndex < 0) {
        if (renderedState !== 'prelude') {
            lineTop.textContent = ''
            lineBottom.textContent = lyrics[0].lyric
            delete lineTop.dataset.timing
            delete lineBottom.dataset.timing
            lineBottom.dataset.lineIndex = '0'
            lineTop.classList.remove('focus', 'lyric-enter')
            lineBottom.classList.remove('focus', 'lyric-enter')
        }
        applyLineVisualSettings(lineTop, currentSettings.colorNext)
        applyLineVisualSettings(lineBottom, currentSettings.colorNext)
        renderSupplementaryLyrics()
        activeLineIndex = -1
        renderedState = 'prelude'
        return
    }
    const current = nextIndex % 2 ? lineBottom : lineTop
    const next = current === lineTop ? lineBottom : lineTop
    next.classList.remove('focus', 'lyric-enter')
    current.classList.add('focus')

    if (renderedState !== nextIndex) {
        current.classList.remove('lyric-enter')
        void current.offsetWidth
        current.classList.add('lyric-enter')
        renderLine(current, nextIndex)
        current.dataset.lineIndex = String(nextIndex)
        current.after(romanization, translation)
    }
    activeLineIndex = nextIndex
    renderedState = nextIndex

    next.textContent = lyrics[nextIndex + 1]?.lyric ?? ''
    delete next.dataset.timing
    if (lyrics[nextIndex + 1]) next.dataset.lineIndex = String(nextIndex + 1)
    else delete next.dataset.lineIndex
    applyLineVisualSettings(current, currentSettings.highlightColor)
    applyLineVisualSettings(next, currentSettings.colorNext)
    setStyleValue(lyricsWindow, 'font-size', String(currentSettings.fontSize) + 'px')
    setStyleValue(lyricsWindow, '--word-fill-color', currentSettings.highlightColor)
    setStyleValue(lyricsWindow, '--word-rest-color', currentSettings.colorNext)
    renderSupplementaryLyrics(lyrics[nextIndex])
    updateWordProgress(time, current)
}

function updateTimingMode(mode: TimingMode | undefined) {
    if (!mode) {
        timingMode.hidden = true
        return
    }
    timingMode.hidden = false
    timingMode.textContent = mode === 'exact' ? '逐字' : '均速'
    timingMode.title = mode === 'exact'
        ? '当前歌词包含逐字时间'
        : '当前歌词没有逐字时间，按句内字形均匀推进'
    timingMode.setAttribute('aria-label', timingMode.title)
    timingMode.dataset.timing = mode
}

function renderSupplementaryLyrics(line?: Lyric) {
    renderSupplementaryLine(romanization, currentSettings.showRomaLyric ? line?.romanization : undefined, line?.romanizationWords)
    renderSupplementaryLine(translation, currentSettings.showTranslatedLyric ? line?.translation : undefined, line?.translationWords)
    translation.hidden = !translation.textContent
    romanization.hidden = !romanization.textContent
}

function renderSupplementaryLine(element: HTMLDivElement, text?: string, timedWords?: TimedWord[]) {
    const value = text?.trim() ?? ''
    const timingKey = timedWords?.map(word => `${word.start}:${word.duration}:${word.text}`).join('|') ?? ''
    if (element.textContent === value && element.dataset.timingKey === timingKey) return
    element.textContent = ''
    element.dataset.timingKey = timingKey
    element.dataset.timing = timedWords?.length ? 'exact' : 'uniform'
    if (!value) return

    if (timedWords?.length) {
        element.append(...timedWords.map(word => createSupplementaryWord(word.text)))
        return
    }

    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    const parts = value.split(/(\s+)/u).filter(Boolean)
    const nodes: Node[] = []
    parts.forEach(part => {
        if (/^\s+$/u.test(part)) {
            nodes.push(document.createTextNode(part))
            return
        }
        const characters = Array.from(segmenter.segment(part), item => item.segment)
        // CJK 没有空格分词，按字形拆分以保留自然换行；罗马音和英文按单词整体换行。
        const tokens = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(part)
            ? characters
            : [part]
        tokens.forEach(token => {
            const tokenElement = document.createElement('span')
            tokenElement.className = 'supplementary-token'
            tokenElement.append(...Array.from(segmenter.segment(token), item => createSupplementaryWord(item.segment)))
            nodes.push(tokenElement)
        })
    })
    element.append(...nodes)
}

function createSupplementaryWord(character: string) {
        const span = document.createElement('span')
        span.className = 'supplementary-word'
        span.textContent = character
        span.dataset.progress = 'pending'
        span.style.setProperty('--word-progress', '0%')
        return span
}

function renderLine(element: HTMLDivElement, index: number) {
    const timedLine = timedLyrics[index]
    element.dataset.timing = timedLine?.timing ?? 'uniform'
    if (!timedLine?.words.length) {
        element.textContent = lyrics[index].lyric
        return
    }

    element.textContent = ''
    element.append(...timedLine.words.map(word => {
        const span = document.createElement('span')
        span.className = 'word'
        span.textContent = word.text
        span.style.setProperty('--word-progress', '0%')
        return span
    }))
}

function updateWordProgress(time: number, current = lineTop.classList.contains('focus') ? lineTop : lineBottom) {
    const line = timedLyrics[activeLineIndex]
    const lyric = lyrics[activeLineIndex]
    if (!line || !lyric) return

    const spans = current.querySelectorAll('.word')
    Array.from(spans).forEach((element, index) => {
        const span = element as HTMLElement
        const word = line.words[index]
        const absoluteStart = word.start < line.time ? line.time + word.start : word.start
        setWordProgress(span, (time - absoluteStart) / word.duration)
    })

    // 翻译和音译只有逐句时间，按同一句的进度均匀扫过各自字形。
    const lineProgress = (time - line.time) / Math.max(1, line.duration)
    for (const [element, timedWords] of [
        [romanization, lyric.romanizationWords],
        [translation, lyric.translationWords],
    ] as const) {
        const characters = element.querySelectorAll('.supplementary-word')
        if (timedWords?.length === characters.length) {
            characters.forEach((span, index) => {
                const word = timedWords[index]
                const absoluteStart = word.start < line.time ? line.time + word.start : word.start
                setWordProgress(span as HTMLElement, (time - absoluteStart) / word.duration)
            })
        } else {
            characters.forEach((span, index) => setWordProgress(span as HTMLElement, lineProgress * characters.length - index))
        }
    }
}

function setWordProgress(span: HTMLElement, value: number) {
    const progress = Math.min(1, Math.max(0, value))
    const state = progress === 1 ? 'complete' : progress > 0 ? 'partial' : 'pending'
    const valueText = `${(progress * 100).toFixed(1)}%`
    if (span.dataset.progress !== state) {
        span.dataset.progress = state
    }
    const previous = Number.parseFloat(span.style.getPropertyValue('--word-progress'))
    if (!Number.isFinite(previous) || Math.abs(progress * 100 - previous) >= .5 || progress === 0 || progress === 1) {
        span.style.setProperty('--word-progress', valueText)
    }
}

function setStyleValue(element: HTMLElement, property: string, value: string) {
    if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value)
}

function applyLineVisualSettings(element: HTMLElement, color: string) {
    setStyleValue(element, 'color', color)
    setStyleValue(element, 'font-size', String(currentSettings.fontSize) + 'px')
    setStyleValue(element, '--word-fill-color', currentSettings.highlightColor)
    setStyleValue(element, '--word-rest-color', currentSettings.colorNext)
}

function applyVisualSettings() {
    setStyleValue(lyricsWindow, 'background-color', currentSettings.backgroundColor)
    setStyleValue(lyricsWindow, 'font-family', currentSettings.fontFamily)
    setStyleValue(lyricsWindow, 'font-size', String(currentSettings.fontSize) + 'px')
    setStyleValue(lyricsWindow, '--lyrics-opacity', String(currentSettings.lyricsOpacity / 100))
    setStyleValue(lyricsWindow, '--word-fill-color', currentSettings.highlightColor)
    setStyleValue(lyricsWindow, '--word-rest-color', currentSettings.colorNext)
    applyLineVisualSettings(lineTop, lineTop.classList.contains('focus') ? currentSettings.highlightColor : currentSettings.colorNext)
    applyLineVisualSettings(lineBottom, lineBottom.classList.contains('focus') ? currentSettings.highlightColor : currentSettings.colorNext)
    lyricsWindow.classList.toggle('lyrics-shadow-off', !currentSettings.textShadow)
    requestWindowFit()
}

function syncSettingsForm() {
    settingsFontSize.value = String(currentSettings.fontSize)
    settingsHighlightColor.value = currentSettings.highlightColor
    settingsNextColor.value = currentSettings.colorNext
    settingsBackgroundColor.value = currentSettings.backgroundColor
    settingsHighlightPicker.value = cssColorToHex(currentSettings.highlightColor, '#ffd700')
    settingsNextPicker.value = cssColorToHex(currentSettings.colorNext, '#7fffd4')
    settingsBackgroundPicker.value = cssColorToHex(currentSettings.backgroundColor, '#101827')
    updateColorValue(settingsHighlightValue, currentSettings.highlightColor)
    updateColorValue(settingsNextValue, currentSettings.colorNext)
    updateColorValue(settingsBackgroundValue, currentSettings.backgroundColor === 'transparent' ? '透明' : currentSettings.backgroundColor)
    settingsBackgroundOpacity.value = String(cssColorAlpha(currentSettings.backgroundColor))
    updateBackgroundOpacityLabel(settingsBackgroundOpacity.value)
    settingsLyricsOpacity.value = String(currentSettings.lyricsOpacity)
    settingsLyricsOpacityValue.value = `${currentSettings.lyricsOpacity}%`
    settingsLyricsOpacityValue.textContent = `${currentSettings.lyricsOpacity}%`
    settingsFontFamily.value = currentSettings.fontFamily
    settingsFontPreset.value = currentSettings.fontFamily
    settingsFontMeta.textContent = currentSettings.fontDisplayName
        ? `已导入：${currentSettings.fontDisplayName}`
        : '使用系统字体'
    settingsFontClear.hidden = !currentSettings.fontFilePath
    settingsTextShadow.checked = currentSettings.textShadow
    renderCustomPresets()
    updatePresetState()
}

function setSettingsSaveStatus(state: 'saved' | 'saving' | 'error', text: string) {
    settingsSaveStatus.dataset.state = state
    settingsSaveStatus.textContent = text
}

function setSettingsPanelOpen(open: boolean) {
    settingsOpen = open
    settingsRevealPending = open
    settingsPanel.hidden = true
    settingsButton.setAttribute('aria-expanded', String(open))
    settingsButton.title = open ? '关闭歌词设置' : '打开歌词设置'
    settingsButton.setAttribute('aria-label', settingsButton.title)
    if (open) {
        setSettingsTab(activeSettingsTab)
        settingsPanel.scrollTop = 0
        syncSettingsForm()
        setSettingsSaveStatus('saved', '已保存')
        requestAnimationFrame(() => {
            reportHitRegions()
            requestWindowFit()
            if (innerHeight >= 320) revealSettingsPanel()
        })
    } else {
        settingsRevealPending = false
        lyricsWindow.classList.remove('settings-open')
        settingsPanel.style.removeProperty('max-height')
        requestWindowFit()
    }
    requestAnimationFrame(reportHitRegions)
}

function applySettings(value: IncomingLyricSettings) {
    currentSettings = normalizeSettings(value)
    applyVisualSettings()
    syncSettingsForm()
    void restoreImportedFont(currentSettings.fontFilePath)
    lockState = currentSettings.lock
    if (currentSettings.lock) stopDragging()
    ipcRenderer.invoke('desktop-lyrics-lock', currentSettings.lock)
    ipcRenderer.invoke('desktop-lyrics-click-to-seek', Boolean(currentSettings.clickToSeek))
    document.body.classList.toggle('unlock', !currentSettings.lock)
    document.body.classList.toggle('lyrics-locked', currentSettings.lock)
    lockIcon.textContent = currentSettings.lock ? 'lock' : 'lock_open'
    lockButton.title = currentSettings.lock ? '解锁歌词' : '锁定歌词'
    lockButton.setAttribute('aria-label', lockButton.title)
    for (const [button, enabled, label] of [
        [translationButton, currentSettings.showTranslatedLyric, '歌词翻译'],
        [romanizationButton, currentSettings.showRomaLyric, '歌词音译（罗马音）'],
    ] as const) {
        button.setAttribute('aria-pressed', String(enabled))
        button.title = `${enabled ? '隐藏' : '显示'}${label}`
        button.setAttribute('aria-label', button.title)
    }
}

async function seekToLyric(event: MouseEvent) {
    if (!lockState || !currentSettings.clickToSeek) return
    const target = event.target as HTMLElement | null
    if (!target || target.closest('button')) return
    const lineElement = target.closest('.lrc') as HTMLDivElement | null
    if (!lineElement) return
    const lineIndex = Number(lineElement.dataset.lineIndex)
    if (!Number.isInteger(lineIndex) || !lyrics[lineIndex]) return
    const wordElement = target.closest('.word') as HTMLElement | null
    const timedLine = timedLyrics[lineIndex]
    const wordIndex = wordElement ? Array.from(lineElement.querySelectorAll('.word')).indexOf(wordElement) : -1
    const word = wordIndex >= 0 ? timedLine?.words[wordIndex] : undefined
    const wordStart = word ? (word.start < timedLine.time ? timedLine.time + word.start : word.start) : lyrics[lineIndex].time
    try {
        await player.invoke(`:seek|${Math.max(0, wordStart / 1000)}`)
    } catch (error) {
        console.warn('[desktop-lyrics] failed to seek from lyric:', error)
    }
}

function setSettingsBusy(busy: boolean) {
    for (const button of [translationButton, romanizationButton, lockButton, settingsButton]) button.disabled = busy
    for (const control of [
        ...settingsPanelControls,
        ...settingsCustomPresets.querySelectorAll<HTMLButtonElement>('button'),
    ]) control.disabled = busy
}

function setTransportBusy(busy: boolean) {
    transportBusy = busy
    for (const button of [previousButton, playButton, nextButton]) {
        button.disabled = busy
        button.setAttribute('aria-busy', String(busy))
    }
}

async function runTransport(action: () => Promise<unknown>) {
    if (transportBusy) return
    setTransportBusy(true)
    try {
        await action()
    } catch (error) {
        console.warn('[desktop-lyrics] transport action failed:', error)
    } finally {
        setTransportBusy(false)
    }
}

function onPlaybackState([playing, , , current]: [boolean, number, number, number]) {
    isPlaying = Boolean(playing)
    const nextTime = Number(current) * 1000
    if (Number.isFinite(nextTime)) playbackTime = nextTime
    lastFrameTime = 0
    playbackCorrection = 0
    lastPlaybackSyncTime = 0
    playIcon.textContent = isPlaying ? 'pause' : 'play_arrow'
    playButton.title = isPlaying ? '暂停' : '播放'
    playButton.setAttribute('aria-label', playButton.title)
    renderLines(playbackTime)
}

async function synchronizePlaybackTime() {
    if (playbackSyncInFlight || !isPlaying) return
    playbackSyncInFlight = true
    try {
        const current = Number(await player.invoke(':seek'))
        if (!Number.isFinite(current)) return

        const actualTime = current * 1000
        const drift = actualTime - playbackTime
        if (Math.abs(drift) >= PLAYBACK_HARD_DRIFT) {
            playbackTime = actualTime
            playbackCorrection = 0
            lastFrameTime = 0
            renderLines(playbackTime)
        } else if (Math.abs(drift) >= PLAYBACK_SMOOTH_DRIFT) {
            playbackCorrection = drift
        }
    } catch (error) {
        // 播放器暂时不可读时继续使用 RAF，本次校准失败不应中断歌词动画。
        console.warn('[desktop-lyrics] failed to synchronize playback time:', error)
    } finally {
        playbackSyncInFlight = false
    }
}

function animate(timestamp: number) {
    const elapsed = lastFrameTime ? Math.max(0, timestamp - lastFrameTime) : 0
    if (isPlaying && elapsed) {
        const correctionStep = Math.sign(playbackCorrection) * Math.min(Math.abs(playbackCorrection), Math.max(1, elapsed * .18))
        playbackTime += elapsed + correctionStep
        playbackCorrection -= correctionStep
    }
    lastFrameTime = timestamp
    if (isPlaying && (!lastPlaybackSyncTime || timestamp - lastPlaybackSyncTime >= PLAYBACK_SYNC_INTERVAL)) {
        lastPlaybackSyncTime = timestamp
        void synchronizePlaybackTime()
    }
    if (lyrics.length) {
        const lineIndex = getLineIndex(playbackTime)
        const expectedState: RenderedState = lineIndex < 0 ? 'prelude' : lineIndex
        if (renderedState !== expectedState) renderLines(playbackTime)
    }
    updateWordProgress(playbackTime)
    frameHandle = requestAnimationFrame(animate)
}

const playerEvents = subscribe('playstate', onPlaybackState)
const playlistEvents = subscribe('player', loadLyrics)
const settingsEvents = subscribe('ext-settings', async ([id]) => {
    if (id !== '23dc60b0-4621-4ab3-92f7-50baf8b6ec1a') return
    const value = await requestSettings(['get'])
    applySettings(value)
    renderLines(playbackTime)
})

async function saveSettings(patch: Partial<LyricSettings>): Promise<boolean> {
    setSettingsSaveStatus('saving', '保存中…')
    setSettingsBusy(true)
    try {
        const value = await requestSettings(['set', { ...currentSettings, ...patch }])
        applySettings(value)
        renderLines(playbackTime)
        setSettingsSaveStatus('saved', '已保存')
        return true
    } catch (error) {
        console.error('[desktop-lyrics] failed to save lyrics setting:', error)
        setSettingsSaveStatus('error', '保存失败')
        return false
    } finally {
        setSettingsBusy(false)
    }
}

previousButton.addEventListener('click', () => void runTransport(() => playlist.invoke(':previous')))
nextButton.addEventListener('click', () => void runTransport(() => playlist.invoke(':next')))
playButton.addEventListener('click', () => void runTransport(() => player.invoke(isPlaying ? ':pause' : ':play')))
for (const [button, name] of [
    [translationButton, 'showTranslatedLyric'],
    [romanizationButton, 'showRomaLyric'],
] as const) {
    button.addEventListener('click', async () => {
        setSettingsBusy(true)
        try {
            const value = await requestSettings(['set', { ...currentSettings, [name]: !currentSettings[name] }])
            applySettings(value)
            renderLines(playbackTime)
        } catch (error) {
            console.error('[desktop-lyrics] failed to save display setting:', error)
        } finally {
            setSettingsBusy(false)
        }
    })
}

settingsButton.addEventListener('click', event => {
    event.stopPropagation()
    setSettingsPanelOpen(!settingsOpen)
})
settingsPanel.addEventListener('click', event => event.stopPropagation())
for (const button of settingsTabs) {
    button.addEventListener('click', () => setSettingsTab(button.dataset.settingsTab ?? 'theme'))
    button.addEventListener('keydown', event => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
        event.preventDefault()
        const index = settingsTabs.indexOf(button)
        const offset = event.key === 'ArrowRight' ? 1 : -1
        const next = settingsTabs[(index + offset + settingsTabs.length) % settingsTabs.length]
        setSettingsTab(next.dataset.settingsTab ?? 'theme')
        next.focus()
    })
}
settingsDismiss.addEventListener('click', () => setSettingsPanelOpen(false))
settingsPanel.querySelector('[data-action="close"]')!.addEventListener('click', () => setSettingsPanelOpen(false))
settingsPanel.querySelector('[data-action="reset"]')!.addEventListener('click', () => void saveSettings({
    highlightColor: 'gold',
    colorNext: 'aquamarine',
    backgroundColor: 'transparent',
    fontFamily: 'system-ui',
    fontFilePath: '',
    fontDisplayName: '',
    textShadow: true,
    fontSize: 28,
    lyricsOpacity: 100,
}))

for (const button of settingsPresetButtons) {
    button.addEventListener('click', () => {
        const preset = stylePresets.find(item => item.id === button.dataset.preset)
        if (!preset) return
        if (!preset.fontFilePath) clearImportedFont()
        void saveSettings(presetSettings(preset))
    })
}

settingsSavePreset.addEventListener('click', () => {
    const name = settingsPresetName.value.trim()
    if (!name) {
        setSettingsSaveStatus('error', '请输入主题名称')
        settingsPresetName.focus()
        return
    }

    const existingIndex = currentSettings.customPresets.findIndex(item => item.name.toLowerCase() === name.toLowerCase())
    if (existingIndex < 0 && currentSettings.customPresets.length >= CUSTOM_PRESET_MAX) {
        setSettingsSaveStatus('error', `最多保存 ${CUSTOM_PRESET_MAX} 个自定义主题`)
        return
    }

    const existing = existingIndex >= 0 ? currentSettings.customPresets[existingIndex] : undefined
    const nextPreset = currentStylePreset(existing?.id ?? `custom-${Date.now()}`, name)
    const nextPresets = currentSettings.customPresets.slice()
    if (existingIndex >= 0) nextPresets[existingIndex] = nextPreset
    else nextPresets.push(nextPreset)

    void (async () => {
        if (!await saveSettings({ customPresets: nextPresets })) return
        settingsPresetName.value = ''
    })()
})
settingsPresetName.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    settingsSavePreset.click()
})

const commitFontSize = (value: number) => void saveSettings({
    fontSize: Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value))),
})
settingsFontSizeDecrease.addEventListener('click', () => commitFontSize(currentSettings.fontSize - 1))
settingsFontSizeIncrease.addEventListener('click', () => commitFontSize(currentSettings.fontSize + 1))
settingsFontSize.addEventListener('change', () => commitFontSize(Number(settingsFontSize.value)))
settingsHighlightColor.addEventListener('change', () => void saveSettings({ highlightColor: settingsHighlightColor.value }))
settingsNextColor.addEventListener('change', () => void saveSettings({ colorNext: settingsNextColor.value }))
settingsBackgroundColor.addEventListener('change', () => void saveSettings({ backgroundColor: settingsBackgroundColor.value }))
settingsHighlightPicker.addEventListener('input', () => updateColorValue(settingsHighlightValue, settingsHighlightPicker.value))
settingsNextPicker.addEventListener('input', () => updateColorValue(settingsNextValue, settingsNextPicker.value))
settingsBackgroundPicker.addEventListener('input', () => updateColorValue(settingsBackgroundValue, settingsBackgroundPicker.value))
settingsBackgroundOpacity.addEventListener('input', () => updateBackgroundOpacityLabel(settingsBackgroundOpacity.value))
settingsHighlightPicker.addEventListener('change', () => void saveSettings({ highlightColor: settingsHighlightPicker.value }))
settingsNextPicker.addEventListener('change', () => void saveSettings({ colorNext: settingsNextPicker.value }))
settingsBackgroundPicker.addEventListener('change', () => void saveSettings({
    backgroundColor: composeBackgroundColor(settingsBackgroundPicker.value, Number(settingsBackgroundOpacity.value)),
}))
settingsBackgroundOpacity.addEventListener('change', () => void saveSettings({
    backgroundColor: composeBackgroundColor(settingsBackgroundPicker.value, Number(settingsBackgroundOpacity.value)),
}))
settingsLyricsOpacity.addEventListener('input', () => {
    const normalized = lyricsOpacityValue(settingsLyricsOpacity.value)
    settingsLyricsOpacityValue.value = `${normalized}%`
    settingsLyricsOpacityValue.textContent = `${normalized}%`
})
settingsLyricsOpacity.addEventListener('change', () => void saveSettings({
    lyricsOpacity: lyricsOpacityValue(settingsLyricsOpacity.value),
}))
settingsFontFamily.addEventListener('change', () => {
    clearImportedFont()
    void saveSettings({ fontFamily: settingsFontFamily.value, fontFilePath: '', fontDisplayName: '' })
})
settingsFontPreset.addEventListener('change', () => {
    clearImportedFont()
    void saveSettings({ fontFamily: settingsFontPreset.value, fontFilePath: '', fontDisplayName: '' })
})
settingsFontImport.addEventListener('click', async () => {
    setSettingsBusy(true)
    try {
        const font = await ipcRenderer.invoke('desktop-lyrics-import-font') as ImportedFont | null
        if (!font || !await installImportedFont(font)) return
        await saveSettings({ fontFamily: 'DesktopLyricsImported', fontFilePath: font.path, fontDisplayName: font.name })
    } catch (error) {
        console.error('[desktop-lyrics] failed to import lyrics font:', error)
        setSettingsSaveStatus('error', '字体导入失败')
    } finally {
        setSettingsBusy(false)
    }
})
settingsFontClear.addEventListener('click', () => {
    clearImportedFont()
    void saveSettings({ fontFamily: 'system-ui', fontFilePath: '', fontDisplayName: '' })
})
settingsTextShadow.addEventListener('change', () => void saveSettings({ textShadow: settingsTextShadow.checked }))

lockButton.addEventListener('click', async () => {
    setSettingsBusy(true)
    try {
        const value = await requestSettings(['set', { ...currentSettings, lock: !lockState }])
        applySettings(value)
    } catch (error) {
        console.error('[desktop-lyrics] failed to save lock state:', error)
    } finally {
        setSettingsBusy(false)
    }
})
document.getElementById('close')!.addEventListener('click', () =>
    ipcRenderer.send('extension:deactive', '23dc60b0-4621-4ab3-92f7-50baf8b6ec1a'))
retryButton.addEventListener('click', () => {
    if (lyricsStatus !== 'loading') void loadLyrics()
})
lyricsWindow.addEventListener('click', event => {
    const target = event.target as HTMLElement | null
    if (settingsOpen && target && !target.closest('#settings-panel, #settings')) setSettingsPanelOpen(false)
    void seekToLyric(event)
})

document.addEventListener('keydown', event => {
    const target = event.target as HTMLElement | null
    if (target && typeof target.matches === 'function' && target.matches('input, textarea, select')) return
    if (event.key === 'Escape' && settingsOpen) {
        event.preventDefault()
        setSettingsPanelOpen(false)
        return
    }
    if (event.code === 'Space') {
        event.preventDefault()
        void playButton.click()
    } else if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault()
        void runTransport(() => playlist.invoke(':previous'))
    } else if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault()
        void runTransport(() => playlist.invoke(':next'))
    }
})

window.addEventListener('beforeunload', () => {
    stopDragging()
    regionObserver.disconnect()
    if (windowFitTimer !== undefined) clearTimeout(windowFitTimer)
    ipcRenderer.removeListener('desktop-lyrics-hover', onLockedHover)
    cancelAnimationFrame(frameHandle)
    void playerEvents.close()
    void playlistEvents.close()
    void settingsEvents.close()
    void player.close()
    void playlist.close()
})

async function initialize() {
    try {
        const value = await requestSettings(['get'])
        applySettings(value)
        // 此连接用单次 data 事件接收结果，同一连接上的请求需要顺序发送。
        const playing = await player.invoke('.isPlaying')
        const time = await player.invoke(':seek')
        onPlaybackState([playing, 0, 0, time])
    } catch (error) {
        console.error('[desktop-lyrics] failed to initialize player state:', error)
    }
    await loadLyrics()
    frameHandle = requestAnimationFrame(animate)
}

initializePresetSwatches()
setSettingsTab(activeSettingsTab)
void initialize()
