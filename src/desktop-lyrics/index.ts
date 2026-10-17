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
