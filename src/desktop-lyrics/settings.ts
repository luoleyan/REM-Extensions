import { NumberField, TextField, ToggleField } from 'extension/ui/index'
import {
    defaultSettings,
    i18nZhCN,
    normalizeVisibleLines,
    normalizeBlurRadius,
    normalizeStrokeWidth,
    normalizeShadowBlur,
    normalizeTextAlign,
    normalizeWindowWidth,
    normalizeWindowHeight,
    normalizeControlsPosition,
    normalizeControlsOpacity,
    readSettings,
} from './settings-defaults'

export { defaultSettings }

export const onSetting: UIExports.OnSetting = async store => {
    const data = await readSettings(store)
    const {
        colorCurrent,
        colorNext,
        fontSize,
        lock,
        showTranslation,
        showRomaji,
        colorTranslation,
        fontSizeTranslation,
        visibleLines,
        karaokeMode,
        bgBlurEnabled,
        bgBlurRadius,
        bgColorLocked,
        bgColorUnlocked,
        strokeWidth,
        strokeColor,
        shadowBlur,
        shadowColor,
        textAlign,
        windowWidth,
        windowHeight,
        showControlsOnHover,
        controlsPosition,
        controlsOpacity,
    } = data

    return [
        TextField(
            i18nZhCN.colorCurrent,
            String(colorCurrent),
            'colorCurrent',
        ),
        TextField(
            i18nZhCN.colorNext,
            String(colorNext),
            'colorNext',
        ),
        TextField(
            i18nZhCN.fontSize,
            String(fontSize),
            'fontSize',
        ),
        ToggleField(
            i18nZhCN.lock,
            Boolean(lock),
            'lock',
        ),
        ToggleField(
            i18nZhCN.showTranslation,
            Boolean(showTranslation),
            'showTranslation',
        ),
        ToggleField(
            i18nZhCN.showRomaji,
            Boolean(showRomaji),
            'showRomaji',
        ),
        TextField(
            i18nZhCN.colorTranslation,
            String(colorTranslation),
            'colorTranslation',
        ),
        TextField(
            i18nZhCN.fontSizeTranslation,
            String(fontSizeTranslation),
            'fontSizeTranslation',
        ),
        ToggleField(
            i18nZhCN.karaokeMode,
            Boolean(karaokeMode),
            'karaokeMode',
        ),
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
            i18nZhCN.strokeWidth,
            Number(strokeWidth),
            0,
            5,
            'strokeWidth',
        ),
        TextField(
            i18nZhCN.strokeColor,
            String(strokeColor),
            'strokeColor',
        ),
        NumberField(
            i18nZhCN.shadowBlur,
            Number(shadowBlur),
            0,
            20,
            'shadowBlur',
        ),
        TextField(
            i18nZhCN.shadowColor,
            String(shadowColor),
            'shadowColor',
        ),
        TextField(
            i18nZhCN.textAlign,
            String(textAlign),
            'textAlign',
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
        NumberField(
            i18nZhCN.windowWidth,
            Number(windowWidth),
            320,
            1920,
            'windowWidth',
        ),
        NumberField(
            i18nZhCN.windowHeight,
            Number(windowHeight),
            60,
            600,
            'windowHeight',
        ),
        ToggleField(
            i18nZhCN.showControlsOnHover,
            Boolean(showControlsOnHover),
            'showControlsOnHover',
        ),
        TextField(
            i18nZhCN.controlsPosition,
            String(controlsPosition),
            'controlsPosition',
        ),
        TextField(
            i18nZhCN.controlsOpacity,
            String(controlsOpacity),
            'controlsOpacity',
        ),
    ]
}

export const onSetSetting: UIExports.OnSetSetting = async (store, name, value) => {
    const next = name === 'visibleLines'
        ? normalizeVisibleLines(value)
        : name === 'bgBlurRadius'
            ? normalizeBlurRadius(value)
            : name === 'strokeWidth'
                ? normalizeStrokeWidth(value)
                : name === 'shadowBlur'
                    ? normalizeShadowBlur(value)
                    : name === 'textAlign'
                        ? normalizeTextAlign(value)
                        : name === 'windowWidth'
                            ? normalizeWindowWidth(value)
                            : name === 'windowHeight'
                                ? normalizeWindowHeight(value)
                                : name === 'controlsPosition'
                                    ? normalizeControlsPosition(value)
                                    : name === 'controlsOpacity'
                                        ? normalizeControlsOpacity(value)
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
    if (name === 'strokeWidth') {
        return String(data.strokeWidth)
    }
    if (name === 'shadowBlur') {
        return String(data.shadowBlur)
    }
    if (name === 'windowWidth') {
        return String(data.windowWidth)
    }
    if (name === 'windowHeight') {
        return String(data.windowHeight)
    }
    if (name === 'controlsOpacity') {
        return String(data.controlsOpacity)
    }

    return data[name as keyof typeof defaultSettings]
}
