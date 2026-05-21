import { fromObject, NumberField, TextField, ToggleField } from 'extension/ui/index'
import {
    defaultSettings,
    i18nZhCN,
    normalizeVisibleLines,
    normalizeBlurRadius,
    readSettings
} from './settings-defaults'

export { defaultSettings }

export const onSetting: UIExports.OnSetting = async store => {
    const data = await readSettings(store)
    const {
        visibleLines,
        bgBlurEnabled,
        bgBlurRadius,
        bgColorLocked,
        bgColorUnlocked,
        ...rest
    } = data

    return [
        ...fromObject(rest, i18nZhCN),
        ToggleField(
            i18nZhCN.bgBlurEnabled,
            Boolean(bgBlurEnabled),
            'bgBlurEnabled',
        ),
        TextField(
            i18nZhCN.bgColorLocked,
            String(bgColorLocked),
            'bgColorLocked',
        ),
        TextField(
            i18nZhCN.bgColorUnlocked,
            String(bgColorUnlocked),
            'bgColorUnlocked',
        ),
        NumberField(
            i18nZhCN.bgBlurRadius,
            Number(bgBlurRadius),
            0,
            48,
            'bgBlurRadius',
        ),
        NumberField(
            i18nZhCN.visibleLines,
            Number(visibleLines),
            2,
            9,
            'visibleLines',
        ),
    ]
}

export const onSetSetting: UIExports.OnSetSetting = async (store, name, value) => {
    const next = name === 'visibleLines'
        ? normalizeVisibleLines(value)
        : name === 'bgBlurRadius'
            ? normalizeBlurRadius(value)
            : value

    return store.set({ ...await readSettings(store), [name]: next })
}

export const onGetSetting: UIExports.OnGetSetting = async (store, name) => {
    const data = await readSettings(store)

    if (name === 'visibleLines') {
        return String(data.visibleLines)
    }
    if (name === 'bgBlurRadius') {
        return String(data.bgBlurRadius)
    }

    return data[name as keyof typeof defaultSettings]
}

