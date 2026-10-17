const { app } = require('electron')
const { createRequire } = require('node:module')
const path = require('node:path')

const REQUEST_TIMEOUT_MS = 8000

async function requestLyrics(audioId) {
    // 扩展安装在 AppData，依赖从宿主目录解析，兼容开发版和安装版的 app.asar。
    const hostRequire = createRequire(path.join(app.getAppPath(), 'package.json'))
    const { lyric_new } = hostRequire('NeteaseCloudMusicApi')
    let timer
    try {
        const response = await Promise.race([
            Promise.resolve().then(() => lyric_new({ id: String(audioId) })),
            new Promise((resolve, reject) => {
                timer = setTimeout(() => reject(new Error('歌词请求超时')), REQUEST_TIMEOUT_MS)
            }),
        ])
        if (!response || response.status < 200 || response.status >= 300) {
            throw new Error('歌词接口请求失败')
        }
        const body = response.body
        if (!body || typeof body !== 'object' || (body.code !== undefined && body.code !== 200)) {
            throw new Error('歌词接口返回异常')
        }
        return body
    } finally {
        clearTimeout(timer)
    }
}

module.exports = { requestLyrics }
