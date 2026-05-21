export const VISIBLE_LINES_MIN = 2
export const VISIBLE_LINES_MAX = 9
export const WINDOW_WIDTH_MIN = 320
export const WINDOW_WIDTH_MAX = 1920
export const WINDOW_HEIGHT_MIN = 60
export const WINDOW_HEIGHT_MAX = 600
export const TEXT_ALIGN_LEFT = 'left'
export const TEXT_ALIGN_CENTER = 'center'
export const TEXT_ALIGN_RIGHT = 'right'

export const defaultSettings = {
    colorCurrent: 'gold',
    colorNext: 'aquamarine',
    fontSize: 'x-large',
    lock: false,
    showTranslation: false,
    showRomaji: false,
    colorTranslation: 'rgba(255,255,255,0.85)',
    fontSizeTranslation: 'large',
    visibleLines: 2,
    karaokeMode: false,
    bgColorLocked: 'rgba(0,0,0,0)',
    bgColorUnlocked: 'rgba(0,0,0,0.5)',
    bgBlurEnabled: false,
    bgBlurRadius: 8,
    strokeWidth: 0.5,
    strokeColor: '#ffffff',
    shadowBlur: 2,
    shadowColor: 'rgba(0,0,0,0.8)',
    textAlign: TEXT_ALIGN_CENTER,
    windowWidth: 720,
    windowHeight: 120,
}

export const i18nZhCN = {
    colorCurrent: '正在播放的歌词颜色',
    colorNext: '未播放的歌词颜色',
    fontSize: '歌词字体大小',
    lock: '歌词锁定',
    showTranslation: '显示翻译歌词',
    showRomaji: '显示罗马音',
    colorTranslation: '翻译歌词颜色',
    fontSizeTranslation: '翻译歌词字号',
    visibleLines: '可见歌词行数',
    karaokeMode: '卡拉OK逐字高亮',
    bgColorLocked: '锁定时背景色',
    bgColorUnlocked: '解锁时背景色',
    bgBlurEnabled: '启用毛玻璃',
    bgBlurRadius: '毛玻璃强度(px)',
    strokeWidth: '文字描边粗细(px)',
    strokeColor: '描边颜色',
    shadowBlur: '阴影强度(px)',
    shadowColor: '阴影颜色',
    textAlign: '歌词对齐方式(left/center/right)',
    windowWidth: '窗口宽度(px)',
    windowHeight: '窗口高度(px)',
}

export function normalizeBlurRadius(value: unknown): number {
    const raw = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value)
            : typeof value === 'object' && value !== null && 'value' in value
                ? Number((value as { value: number }).value)
                : 8

    if (!Number.isFinite(raw)) {
        return 8
    }

    const rounded = Math.round(raw)
    return Math.max(0, Math.min(48, rounded))
}

export function normalizeStrokeWidth(value: unknown): number {
    const raw = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value)
            : typeof value === 'object' && value !== null && 'value' in value
                ? Number((value as { value: number }).value)
                : 0.5

    if (!Number.isFinite(raw)) {
        return 0.5
    }

    return Math.max(0, Math.min(5, raw))
}

export function normalizeShadowBlur(value: unknown): number {
    const raw = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value)
            : typeof value === 'object' && value !== null && 'value' in value
                ? Number((value as { value: number }).value)
                : 2

    if (!Number.isFinite(raw)) {
        return 2
    }

    return Math.max(0, Math.min(20, raw))
}

export function normalizeTextAlign(value: unknown): string {
    const str = String(value ?? '').toLowerCase().trim()
    if (str === TEXT_ALIGN_LEFT || str === TEXT_ALIGN_CENTER || str === TEXT_ALIGN_RIGHT) {
        return str
    }
    return TEXT_ALIGN_CENTER
}

export function normalizeWindowWidth(value: unknown): number {
    const raw = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value)
            : typeof value === 'object' && value !== null && 'value' in value
                ? Number((value as { value: number }).value)
                : 720

    if (!Number.isFinite(raw)) {
        return 720
    }

    const rounded = Math.round(raw)
    return Math.min(WINDOW_WIDTH_MAX, Math.max(WINDOW_WIDTH_MIN, rounded))
}

export function normalizeWindowHeight(value: unknown): number {
    const raw = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value)
            : typeof value === 'object' && value !== null && 'value' in value
                ? Number((value as { value: number }).value)
                : 120

    if (!Number.isFinite(raw)) {
        return 120
    }

    const rounded = Math.round(raw)
    return Math.min(WINDOW_HEIGHT_MAX, Math.max(WINDOW_HEIGHT_MIN, rounded))
}

export function normalizeVisibleLines(value: unknown): number {
    const raw = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value)
            : typeof value === 'object' && value !== null && 'value' in value
                ? Number((value as { value: number }).value)
                : VISIBLE_LINES_MIN

    if (!Number.isFinite(raw)) {
        return VISIBLE_LINES_MIN
    }

    const rounded = Math.round(raw)
    return Math.min(VISIBLE_LINES_MAX, Math.max(VISIBLE_LINES_MIN, rounded))
}

export async function readSettings(store: { get: (v?: unknown) => Promise<unknown> }) {
    const saved = await store.get(defaultSettings)
    const merged = { ...defaultSettings, ...(saved as object ?? {}) }

    return {
        ...merged,
        visibleLines: normalizeVisibleLines(merged.visibleLines),
        bgBlurRadius: normalizeBlurRadius(merged.bgBlurRadius),
        strokeWidth: normalizeStrokeWidth(merged.strokeWidth),
        shadowBlur: normalizeShadowBlur(merged.shadowBlur),
        textAlign: normalizeTextAlign(merged.textAlign),
        windowWidth: normalizeWindowWidth(merged.windowWidth),
        windowHeight: normalizeWindowHeight(merged.windowHeight),
    }
}
