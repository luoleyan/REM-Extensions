import { NumberField, TextField, ToggleField } from 'extension/ui/index'

const FONT_SIZE_MIN = 12
const FONT_SIZE_MAX = 72
const LYRICS_OPACITY_MIN = 20
const LYRICS_OPACITY_MAX = 100
const CUSTOM_PRESET_MAX = 12

interface StoredPreset {
    id: string
    name: string
    description: string
    highlightColor: string
    colorNext: string
    backgroundColor: string
    fontFamily: string
    fontFilePath: string
    fontDisplayName: string
    textShadow: boolean
    fontSize: number
    lyricsOpacity: number
}

const defaultSettings = {
    highlightColor: 'gold',
    colorNext: 'aquamarine',
    backgroundColor: 'transparent',
    fontFamily: 'system-ui',
    fontFilePath: '',
    fontDisplayName: '',
    textShadow: true,
    fontSize: 28,
    lyricsOpacity: 100,
    customPresets: [] as StoredPreset[],
    lock: false,
    showTranslatedLyric: true,
    showRomaLyric: true,
    clickToSeek: false,
}

const i18nZhCN = {
    highlightColor: '歌词高亮颜色（支持 CSS 颜色）',
    colorNext: '未播放的歌词颜色（支持 CSS 颜色）',
    backgroundColor: '歌词底色（支持 CSS 颜色）',
    fontFamily: '歌词字体（支持系统字体名称）',
    textShadow: '歌词阴影',
    fontSize: '歌词字体大小（px）',
    lyricsOpacity: '歌词透明度（%）',
    lock: '歌词锁定',
    showTranslatedLyric: '显示歌词翻译',
    showRomaLyric: '显示歌词音译（罗马音）',
    clickToSeek: '点击歌词跳转播放位置',
}

const fontSizeKeywords: Record<string, number> = {
    small: 16,
    medium: 20,
    large: 24,
    'x-large': 28,
    'xx-large': 32,
}

function textValue(value: unknown, fallback: string) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function fontSizeValue(value: unknown) {
    let size: number | undefined
    if (typeof value === 'number' && Number.isFinite(value)) size = value
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        size = fontSizeKeywords[normalized]
        if (size === undefined && /^(?:\d+(?:\.\d+)?)(?:px)?$/u.test(normalized)) size = Number.parseFloat(normalized)
    }
    if (!Number.isFinite(size)) size = defaultSettings.fontSize
    return Math.round(Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size!)))
}

function lyricsOpacityValue(value: unknown) {
    const opacity = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(opacity)) return defaultSettings.lyricsOpacity
    return Math.round(Math.min(LYRICS_OPACITY_MAX, Math.max(LYRICS_OPACITY_MIN, opacity)))
}

function normalizeCustomPresets(value: unknown): StoredPreset[] {
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
            highlightColor: textValue(stored.highlightColor, defaultSettings.highlightColor),
            colorNext: textValue(stored.colorNext, defaultSettings.colorNext),
            backgroundColor: textValue(stored.backgroundColor, defaultSettings.backgroundColor),
            fontFamily: textValue(stored.fontFamily, defaultSettings.fontFamily),
            fontFilePath: textValue(stored.fontFilePath, defaultSettings.fontFilePath),
            fontDisplayName: textValue(stored.fontDisplayName, defaultSettings.fontDisplayName),
            textShadow: typeof stored.textShadow === 'boolean' ? stored.textShadow : defaultSettings.textShadow,
            fontSize: fontSizeValue(stored.fontSize),
            lyricsOpacity: lyricsOpacityValue(stored.lyricsOpacity),
        }]
    })
}

function normalizeSettings(value: unknown) {
    const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    return {
        highlightColor: textValue(stored.highlightColor ?? stored.colorCurrent, defaultSettings.highlightColor),
        colorNext: textValue(stored.colorNext, defaultSettings.colorNext),
        backgroundColor: textValue(stored.backgroundColor, defaultSettings.backgroundColor),
        fontFamily: textValue(stored.fontFamily, defaultSettings.fontFamily),
        fontFilePath: textValue(stored.fontFilePath, defaultSettings.fontFilePath),
        fontDisplayName: textValue(stored.fontDisplayName, defaultSettings.fontDisplayName),
        textShadow: typeof stored.textShadow === 'boolean' ? stored.textShadow : defaultSettings.textShadow,
        fontSize: fontSizeValue(stored.fontSize),
        lyricsOpacity: lyricsOpacityValue(stored.lyricsOpacity),
        customPresets: normalizeCustomPresets(stored.customPresets),
        lock: typeof stored.lock === 'boolean' ? stored.lock : defaultSettings.lock,
        showTranslatedLyric: typeof stored.showTranslatedLyric === 'boolean'
            ? stored.showTranslatedLyric : defaultSettings.showTranslatedLyric,
        showRomaLyric: typeof stored.showRomaLyric === 'boolean'
            ? stored.showRomaLyric : defaultSettings.showRomaLyric,
        clickToSeek: typeof stored.clickToSeek === 'boolean' ? stored.clickToSeek : defaultSettings.clickToSeek,
    }
}

function toUiSettings(settings: ReturnType<typeof normalizeSettings>) {
    return [
        TextField(i18nZhCN.highlightColor, settings.highlightColor, 'highlightColor'),
        TextField(i18nZhCN.colorNext, settings.colorNext, 'colorNext'),
        TextField(i18nZhCN.backgroundColor, settings.backgroundColor, 'backgroundColor'),
        TextField(i18nZhCN.fontFamily, settings.fontFamily, 'fontFamily'),
        ToggleField(i18nZhCN.textShadow, settings.textShadow, 'textShadow'),
        NumberField(i18nZhCN.fontSize, settings.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX, 'fontSize'),
        NumberField(i18nZhCN.lyricsOpacity, settings.lyricsOpacity, LYRICS_OPACITY_MIN, LYRICS_OPACITY_MAX, 'lyricsOpacity'),
        ToggleField(i18nZhCN.lock, settings.lock, 'lock'),
        ToggleField(i18nZhCN.showTranslatedLyric, settings.showTranslatedLyric, 'showTranslatedLyric'),
        ToggleField(i18nZhCN.showRomaLyric, settings.showRomaLyric, 'showRomaLyric'),
        ToggleField(i18nZhCN.clickToSeek, settings.clickToSeek, 'clickToSeek'),
    ]
}

export const onSetting: UIExports.OnSetting = async settings =>
    toUiSettings(normalizeSettings(await settings.get(defaultSettings)))

export const onSetSetting: UIExports.OnSetSetting = async (store, name, value) => {
    const current = normalizeSettings(await store.get(defaultSettings))
    const next = name === 'colorCurrent'
        ? { ...current, highlightColor: value }
        : { ...current, [name]: value }
    return store.set(normalizeSettings(next))
}

export const onGetSetting: UIExports.OnGetSetting = async (store, name) =>
    normalizeSettings(await store.get(defaultSettings))[name as keyof ReturnType<typeof normalizeSettings>]
