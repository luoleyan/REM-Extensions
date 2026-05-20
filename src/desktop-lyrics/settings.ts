import { fromObject, TextField } from 'extension/ui/index'
import { defaultSettings, i18nZhCN, normalizeVisibleLines, readSettings } from './settings-defaults'

export { defaultSettings }

export const onSetting: UIExports.OnSetting = async store => {
    const data = await readSettings(store)
    const { visibleLines, ...rest } = data

    return [
        ...fromObject(rest, i18nZhCN),
        TextField(
            i18nZhCN.visibleLines,
            String(visibleLines),
            'visibleLines',
        ),
    ]
}

export const onSetSetting: UIExports.OnSetSetting = async (store, name, value) => {
    const next = name === 'visibleLines'
        ? normalizeVisibleLines(value)
        : value

    return store.set({ ...await readSettings(store), [name]: next })
}

export const onGetSetting: UIExports.OnGetSetting = async (store, name) => {
    const data = await readSettings(store)

    if (name === 'visibleLines') {
        return String(data.visibleLines)
    }

    return data[name as keyof typeof defaultSettings]
}
