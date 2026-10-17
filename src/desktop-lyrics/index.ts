import { ipc, provide, whenReady, win, settings } from 'extension'
import https from 'node:https'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Socket } from 'net'

function lyricServer() {
    const NETEASE_API = 'https://bot-neteaseapi.rgb39.top/'
    const REQUEST_TIMEOUT = 8000
    const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
    const CACHE_TTL = 5 * 60 * 1000
    const CACHE_LIMIT = 8
    // 安装版扩展从 resources/builtin-extensions 启动，process.cwd() 可能是
    // 快捷方式指定的任意目录。由宿主显式传递 app.getAppPath()，确保能加载
    // REM 自带的 NeteaseCloudMusicApi 及其依赖。
    const hostRequire = createRequire(path.join(process.env.REM_APP_PATH ?? process.cwd(), 'package.json'))
    const cache = new Map<string, { value: Buffer | string, expiresAt: number }>()

    function getCached(id: string) {
        const cached = cache.get(id)
        if (!cached) return undefined
        if (cached.expiresAt <= Date.now()) {
            cache.delete(id)
            return undefined
        }
        cache.delete(id)
        cache.set(id, cached)
        return cached.value
    }

    function setCached(id: string, value: Buffer | string) {
        cache.delete(id)
        cache.set(id, { value, expiresAt: Date.now() + CACHE_TTL })
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
    }

    function requestRemote(url: string): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const request = https.get(url, res => {
                const statusCode = res.statusCode ?? 0
                if (statusCode < 200 || statusCode >= 300) {
                    res.resume()
                    reject(new Error(`歌词接口返回 HTTP ${statusCode}`))
                    return
                }

                const chunks: Buffer[] = []
                let size = 0
                res.on('data', (chunk: Buffer) => {
                    size += chunk.length
                    if (size > MAX_RESPONSE_BYTES) {
                        request.destroy(new Error('歌词响应超过大小限制'))
                        return
                    }
                    chunks.push(chunk)
                })
                res.on('end', () => resolve(Buffer.concat(chunks)))
                res.on('error', reject)
            })
            const timer = setTimeout(() => request.destroy(new Error('歌词请求超时')), REQUEST_TIMEOUT)
            request.on('error', reject)
            request.on('close', () => clearTimeout(timer))
        })
    }

    async function requestLyrics(id: string): Promise<Buffer | string> {
        const cached = getCached(id)
        if (cached !== undefined) return cached

        let result: Buffer | string
        try {
            // REM 自带的 lyric_new 使用 /api/song/lyric/v1，能返回 yrc 逐字时间。
            // 远程代理目前会把 yrc 丢掉，因此只保留为旧环境的回退路径。
            const { lyric_new } = hostRequire('NeteaseCloudMusicApi') as {
                lyric_new?: (query: { id: string }) => Promise<{ status?: number, body?: unknown }>
            }
            if (typeof lyric_new === 'function') {
                const response = await lyric_new({ id })
                if (response?.status !== undefined && (response.status < 200 || response.status >= 300)) {
                    throw new Error(`本地歌词接口返回 HTTP ${response.status}`)
                }
                if (response?.body) {
                    result = JSON.stringify(response.body)
                    setCached(id, result)
                    return result
                }
            }
        } catch (error) {
            console.warn('[desktop-lyrics] local lyric_new unavailable, using remote fallback:', error)
        }

        result = await requestRemote(`${NETEASE_API}lyric/new?id=${encodeURIComponent(id)}`)
        setCached(id, result)
        return result
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

function validateTheme(theme: unknown): boolean {
    if (!theme || typeof theme !== 'object') return false
    const t = theme as Record<string, unknown>
    return Boolean(
        typeof t.id === 'string' &&
        typeof t.name === 'string' &&
        typeof t.createdAt === 'number' &&
        t.settings && typeof t.settings === 'object'
    )
}

// 读取设置
async function readExtensionSettings() {
    const saved = await settings.get()
    const parsedRaw = typeof saved === 'string'
        ? JSON.parse(saved)
        : saved
    const parsed = parsedRaw && typeof parsedRaw === 'object' && !Array.isArray(parsedRaw)
        ? parsedRaw as Record<string, unknown>
        : {}

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
                if (!id) throw new Error('歌词请求缺少歌曲 ID')
                const lyrics = await requestLyrics(id)
                return sock.write(lyrics)
            } catch {
                return sock.write('null')
            }
        })
    })
}

function setupLyricWindow() {
    let winId: string

    whenReady(async () => {
        winId = await win.openWindow('desktop-lyrics', {})
    })

    provide('beforeDisable', () => win.closeWindow(winId))
}

function settingServer() {
    ipc.server('settings', (sock: Socket) => {
        sock.on('data', async buf => {
            try {
                const [ flag, data ] = JSON.parse(buf.toString('utf-8'))
                if (flag === 'set') {
                    const serialized = JSON.stringify(data)
                    await settings.set(serialized)
                    if (await settings.get() !== serialized) throw new Error('歌词设置保存失败')
                }
                sock.write(JSON.stringify(await settings.get()))
            } catch (error) {
                sock.write(JSON.stringify({ error: String(error) }))
            }
        })
    })
}

lyricServer()
settingServer()
setupLyricWindow()
