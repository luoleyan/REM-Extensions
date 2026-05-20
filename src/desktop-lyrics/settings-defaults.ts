export const VISIBLE_LINES_MIN = 2
export const VISIBLE_LINES_MAX = 9

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
    }
}
