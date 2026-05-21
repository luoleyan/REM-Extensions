import { ipc, settings, store } from 'extension'
import { Socket } from 'net'

const VISIBLE_LINES_MIN = 2
const VISIBLE_LINES_MAX = 9
const BG_BLUR_MIN = 0
const BG_BLUR_MAX = 48
const STROKE_WIDTH_MIN = 0
const STROKE_WIDTH_MAX = 5
const SHADOW_BLUR_MIN = 0
const SHADOW_BLUR_MAX = 20
const WINDOW_WIDTH_MIN = 320
const WINDOW_WIDTH_MAX = 1920
const WINDOW_HEIGHT_MIN = 60
const WINDOW_HEIGHT_MAX = 600
const TEXT_ALIGN_LEFT = 'left'
const TEXT_ALIGN_CENTER = 'center'
const TEXT_ALIGN_RIGHT = 'right'
const CONTROLS_POSITION_LEFT = 'left'
const CONTROLS_POSITION_CENTER = 'center'
const CONTROLS_POSITION_RIGHT = 'right'

function normalizeVisibleLines(value: unknown): number {
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

function normalizeBlurRadius(value: unknown): number {
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
    return Math.min(BG_BLUR_MAX, Math.max(BG_BLUR_MIN, rounded))
}

function normalizeStrokeWidth(value: unknown): number {
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

    return Math.min(STROKE_WIDTH_MAX, Math.max(STROKE_WIDTH_MIN, raw))
}

function normalizeShadowBlur(value: unknown): number {
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

    return Math.min(SHADOW_BLUR_MAX, Math.max(SHADOW_BLUR_MIN, raw))
}

function normalizeTextAlign(value: unknown): string {
    const str = String(value ?? '').toLowerCase().trim()
    if (str === TEXT_ALIGN_LEFT || str === TEXT_ALIGN_CENTER || str === TEXT_ALIGN_RIGHT) {
        return str
    }
    return TEXT_ALIGN_CENTER
}

function normalizeWindowWidth(value: unknown): number {
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

function normalizeWindowHeight(value: unknown): number {
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

function normalizeControlsPosition(value: unknown): string {
    const str = String(value ?? '').toLowerCase().trim()
    if (
        str === CONTROLS_POSITION_LEFT
        || str === CONTROLS_POSITION_CENTER
        || str === CONTROLS_POSITION_RIGHT
    ) {
        return str
    }
    return CONTROLS_POSITION_CENTER
}

function normalizeControlsOpacity(value: unknown): number {
    const raw = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value)
            : typeof value === 'object' && value !== null && 'value' in value
                ? Number((value as { value: number }).value)
                : 0.9

    if (!Number.isFinite(raw)) {
        return 0.9
    }

    return Math.min(1, Math.max(0.2, raw))
}

const defaultSettings = {
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
    textAlign: 'center',
    windowWidth: 720,
    windowHeight: 120,
    showControlsOnHover: true,
    controlsPosition: 'center',
    controlsOpacity: 0.9,
}

async function readExtensionSettings() {
    const saved = await settings.get()
    const parsed = typeof saved === 'string'
        ? JSON.parse(saved)
        : saved ?? {}

    return {
        ...defaultSettings,
        ...parsed,
        visibleLines: normalizeVisibleLines(parsed.visibleLines),
        bgBlurRadius: normalizeBlurRadius(parsed.bgBlurRadius),
        strokeWidth: normalizeStrokeWidth(parsed.strokeWidth),
        shadowBlur: normalizeShadowBlur(parsed.shadowBlur),
        textAlign: normalizeTextAlign(parsed.textAlign),
        windowWidth: normalizeWindowWidth(parsed.windowWidth),
        windowHeight: normalizeWindowHeight(parsed.windowHeight),
        showControlsOnHover: typeof parsed.showControlsOnHover === 'boolean'
            ? parsed.showControlsOnHover
            : true,
        controlsPosition: normalizeControlsPosition(parsed.controlsPosition),
        controlsOpacity: normalizeControlsOpacity(parsed.controlsOpacity),
    }
}

function parseCookie(cookie: unknown): unknown {
    if (!cookie) {
        return null
    }

    if (typeof cookie === 'string') {
        try {
            return JSON.parse(cookie)
        } catch {
            return cookie
        }
    }

    return cookie
}

async function fetchLyrics(id: string, cookie: unknown) {
    const { lyric_new, lyric } = require('NeteaseCloudMusicApi')
    const parsedCookie = parseCookie(cookie)

    if (!parsedCookie) {
        return null
    }

    const legacyResult = await lyric({ id, cookie: parsedCookie }).catch((e: { status?: number }) => e)
    const newResult = await lyric_new({ id, cookie: parsedCookie }).catch((e: { status?: number }) => e)

    if (legacyResult?.status === 200 && legacyResult.body?.lrc?.lyric?.trim()) {
        return {
            ...legacyResult.body,
            yrc: newResult?.body?.yrc ?? legacyResult.body?.yrc ?? { lyric: '' },
        }
    }

    if (newResult?.status === 200 && newResult.body?.lrc?.lyric?.trim()) {
        return newResult.body
    }

    return null
}

function lyricServer() {
    ipc.server('lyric', async (sock: Socket) => {
        sock.on('data', async buf => {
            const id = buf.toString('utf-8').trim()

            try {
                const cookie = await store.get('cookie')
                if (!cookie) {
                    sock.write(JSON.stringify({
                        code: 301,
                        lrc: { lyric: '' },
                        tlyric: { lyric: '' },
                        romalrc: { lyric: '' },
                        yrc: { lyric: '' },
                    }))
                    return
                }

                const body = await fetchLyrics(id, cookie)
                if (!body) {
                    sock.write(JSON.stringify({
                        code: 404,
                        lrc: { lyric: '' },
                        tlyric: { lyric: '' },
                        romalrc: { lyric: '' },
                        yrc: { lyric: '' },
                    }))
                    return
                }

                sock.write(JSON.stringify(body))
            } catch (err) {
                console.error('[desktop-lyrics] lyric fetch error:', err)
                sock.write(JSON.stringify(null))
            }
        })
    })
}

function settingServer() {
    ipc.server('settings', (sock: Socket) => {
        sock.on('data', async buf => {
            try {
                const msg = buf.toString('utf-8').trim()

                if (msg === 'get') {
                    sock.write(JSON.stringify(await readExtensionSettings()))
                    return
                }

                if (msg.startsWith('set:')) {
                    const data = JSON.parse(msg.slice(4))
                    await settings.set(data)
                }
            } catch (err) {
                console.error('[desktop-lyrics] settings IPC error:', err)
                sock.write(JSON.stringify({ error: String(err) }))
            }
        })
    })
}

lyricServer()
settingServer()