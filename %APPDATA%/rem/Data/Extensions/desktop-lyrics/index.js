'use strict';

Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const extension_1 = require("extension");
const node_https_1 = tslib_1.__importDefault(require("node:https"));
function lyricServer() {
    const NETEASE_API = 'https://bot-neteaseapi.rgb39.top/';
    async function request(url) {
        const { promise, resolve, reject } = Promise.withResolvers();
        node_https_1.default.get(url, res => {
            let buf = Buffer.alloc(0);
            res.on('data', chunk => {
                buf = Buffer.concat([buf, chunk]);
            });
            res.on('end', () => {
                try {
                    resolve(buf);
                }
                catch (error) {
                    reject(error);
                }
            });
            res.on('error', err => reject(err));
        });
        return promise;
    }
    extension_1.ipc.server('lyric', async (sock) => {
        sock.on('data', async (buf) => {
            const id = buf.toString('utf-8');
            try {
                const lyrics = await request(`${NETEASE_API}lyric?id=${id}`);
                return sock.write(lyrics);
            }
            catch {
                return sock.write('null');
            }
        });
    });
}
function setupLyricWindow() {
    let winId;
    (0, extension_1.whenReady)(async () => {
        winId = await extension_1.win.openWindow('desktop-lyrics', {
            width: 720,
            height: 120,
            alwaysOnTop: true,
            frame: false,
            transparent: true,
            maximizable: false,
            minimizable: false,
            skipTaskbar: true,
            resizable: false,
        });
    });
    (0, extension_1.provide)('beforeDisable', () => extension_1.win.closeWindow(winId));
}
function settingServer() {
    extension_1.ipc.server('settings', (sock) => {
        sock.on('data', async (buf) => {
            const [flag, data] = JSON.parse(buf.toString('utf-8'));
            if (flag === 'get') {
                sock.write(JSON.stringify(await extension_1.settings.get()));
            }
            else if (flag === 'set') {
                await extension_1.settings.set(data);
            }
        });
    });
}
lyricServer();
settingServer();
setupLyricWindow();
