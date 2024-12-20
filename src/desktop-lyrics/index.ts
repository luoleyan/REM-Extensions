import { ipc, provide, whenReady, win, settings } from 'extension'
import https from 'node:https'
import { Socket } from 'net'

function lyricServer() {
    const NETEASE_API = 'https://bot-neteaseapi.rgb39.top/'

    async function request(url: string): Promise<any> {
        const { promise, resolve, reject } = Promise.withResolvers()
        https.get(url, res => {
            let buf = Buffer.alloc(0)
            res.on('data', chunk => {
                buf = Buffer.concat([ buf, chunk ])
            })

            res.on('end', () => {
                try {
                    resolve(buf)
                } catch (error) {
                    reject(error)
                }
            })

            res.on('error', err => reject(err))
        })

        return promise
    }

    ipc.server('lyric', async (sock: Socket) => {
        sock.on('data', async buf => {
            const id = buf.toString('utf-8')
            try {
                const lyrics = await request(`${NETEASE_API}lyric?id=${id}`)
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
        winId = await win.openWindow('desktop-lyrics', {
            width: 720,
            height: 120,
            alwaysOnTop: true,
            frame: false,
            transparent: true,
            maximizable: false,
            minimizable: false,
            skipTaskbar: true,
            resizable: false,
        })
    })

    provide('beforeDisable', () => win.closeWindow(winId))
}

function settingServer() {
    ipc.server('settings', (sock: Socket) => {
        sock.on('data', async buf => {
            const [ flag, data ] = JSON.parse(buf.toString('utf-8'))

            if (flag === 'get') {
                sock.write(JSON.stringify(await settings.get()))
            } else if (flag === 'set') {
                await settings.set(data)
            }
        })
    })
}

lyricServer()
settingServer()
setupLyricWindow()