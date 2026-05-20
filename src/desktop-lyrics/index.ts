import { ipc, settings, store } from 'extension'
import { Socket } from 'net'

const VISIBLE_LINES_MIN = 2
const VISIBLE_LINES_MAX = 9

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