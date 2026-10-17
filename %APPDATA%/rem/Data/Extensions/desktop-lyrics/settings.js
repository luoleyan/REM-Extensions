import { fromObject } from '../../node_modules/extension/ui/index.js';

const defaultSettings = {
    colorCurrent: 'gold',
    colorNext: 'aquamarine',
    fontSize: 'x-large',
    lock: false,
};
const i18nZhCN = {
    colorCurrent: '正在播放的歌词颜色',
    colorNext: '未播放的歌词颜色',
    fontSize: '歌词字体大小',
    lock: '歌词锁定',
};
const onSetting = async (settings) => fromObject(await settings.get(defaultSettings), i18nZhCN);
const onSetSetting = async (store, name, value) => store.set({ ...await store.get(defaultSettings), [name]: value });
const onGetSetting = async (store, name) => (await store.get(defaultSettings))[name];

export { onGetSetting, onSetSetting, onSetting };
