import { ipcRenderer } from "electron"

const { subscribe, connect } = window
const player = connect('player-controller')
const lyricServer = connect('lyric')
const settingsConn = connect('settings')

const VISIBLE_LINES_MIN = 2
const VISIBLE_LINES_MAX = 9

interface Lyric {
    time: number
    lyric: string
}

interface WordTiming {
    text: string
    start: number
    duration: number
}

interface KaraokeLine {
    time: number
    duration: number
    words: WordTiming[]
}

interface DesktopLyricsSettings {
    colorCurrent: string
    colorNext: string
    fontSize: string
    lock: boolean
    showTranslation: boolean
    showRomaji: boolean
    colorTranslation: string
    fontSizeTranslation: string
    visibleLines: number
    karaokeMode: boolean
    bgColorLocked: string
    bgColorUnlocked: string
    bgBlurEnabled: boolean
    bgBlurRadius: number
}

interface LyricLineRefs {
    line: HTMLDivElement
    roma: HTMLDivElement
    text: HTMLDivElement
    trans: HTMLDivElement
    romaViewport: HTMLDivElement
    textViewport: HTMLDivElement
    transViewport: HTMLDivElement
}

let lrc: Lyric[] | null
let romalrc: Lyric[] | null
let tlyric: Lyric[] | null
let klyric: KaraokeLine[] | null

const defaultSettingsLocal: DesktopLyricsSettings = {
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
    bgColorLocked: 'rgba(0,0,0,0)',
    bgColorUnlocked: 'rgba(0,0,0,0.5)',
    bgBlurEnabled: false,
    bgBlurRadius: 8,
}

let cachedSettings: DesktopLyricsSettings = { ...defaultSettingsLocal }
let settingsInflight: Promise<DesktopLyricsSettings> | null = null
let domLines: LyricLineRefs[] = []
let domLineCount = 0

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

    return Math.max(0, Math.min(48, Math.round(raw)))
}

function parseSettingsResponse(raw: unknown): DesktopLyricsSettings {
    const base = { ...defaultSettingsLocal }
    let obj: Record<string, unknown> | null = null

    if (typeof raw === 'string') {
        obj = JSON.parse(raw) as Record<string, unknown>
    } else if (raw && typeof raw === 'object') {
        obj = raw as Record<string, unknown>
    }

    if (!obj) {
        return { ...base }
    }

    return {
        ...base,
        ...(obj as object),
        visibleLines: normalizeVisibleLines(obj.visibleLines),
        bgBlurRadius: normalizeBlurRadius(obj.bgBlurRadius),
    }
}

interface LyricBody {
    code?: number
    lrc?: { lyric?: string }
    tlyric?: { lyric?: string }
    romalrc?: { lyric?: string }
    yrc?: { lyric?: string; version?: number }
}

async function refreshSettings() {
    if (settingsInflight) {
        return settingsInflight
    }

    settingsInflight = settingsConn.invoke('get')
        .then(raw => {
            cachedSettings = parseSettingsResponse(raw)
            ensureDOM(cachedSettings.visibleLines)
            return cachedSettings
        })
        .catch(() => cachedSettings)
        .finally(() => {
            settingsInflight = null
        })

    return settingsInflight
}

async function loadLyrics() {
    try {
        const audioData = await player.invoke('.audioData')
        if (!audioData?.id) {
            lrc = romalrc = tlyric = klyric = null
            return
        }

        const raw = await lyricServer.invoke(String(audioData.id))
        const body = (raw && typeof raw === 'object' && 'lrc' in (raw as object))
            ? raw as LyricBody
            : null

        if (!body?.lrc?.lyric?.trim()) {
            lrc = romalrc = tlyric = klyric = null
            return
        }

        lrc = parseLrc(body.lrc?.lyric)
        romalrc = parseLrc(body.romalrc?.lyric)
        tlyric = parseLrc(body.tlyric?.lyric)
        klyric = parseYrc(body.yrc?.lyric)
    } catch {
        lrc = romalrc = tlyric = klyric = null
    }
}

const LINE_SWITCH_EARLY_MS = 220
const LRC_LINE_SWITCH_EARLY_MS = 140
const SEEK_POLL_INTERVAL_MS = 100
const AUX_SYNC_WINDOW_MS = 3200
const SEEK_THRESHOLD_MS = 2000

let isSeeking = false
let lastPlayTimeMs = -1
let lastL1Dual = -1
let lastL1Multi = -1
let lineHeight = 0
let pendingDualAnimationFrame = 0
let pendingMultiAnimationFrame = 0

function getLineIndex(lrcArr: Lyric[], time: number, earlyMs = 0): [ number, number? ] {
    const lrclen = lrcArr.length

    if (time >= lrcArr.at(-1)!.time) {
        return [ lrclen - 1 ]
    }

    for (let i = 1; i < lrclen; i++) {
        const cur = lrcArr[i]

        if (cur.time > time + earlyMs) {
            return [ i - 1, i ]
        }
    }

    return [ lrclen - 2, lrclen - 1 ]
}

function closestLrcIndex(targetTime: number): number {
    if (!lrc?.length) {
        return 0
    }

    let best = 0
    let bestDiff = Math.abs(lrc[0].time - targetTime)

    for (let i = 1; i < lrc.length; i++) {
        const diff = Math.abs(lrc[i].time - targetTime)
        if (diff < bestDiff) {
            bestDiff = diff
            best = i
        }
    }

    return best
}

function getActiveLineIndex(time: number, s: DesktopLyricsSettings): [ number, number? ] {
    if (s.karaokeMode && klyric?.length) {
        return getLineIndex(
            klyric.map(line => ({ time: karaokeLineStart(line), lyric: '' })),
            time,
            LINE_SWITCH_EARLY_MS,
        )
    }

    return getLineIndex(lrc!, time, LRC_LINE_SWITCH_EARLY_MS)
}

function resolveLrcIndex(lineIndex: number, s: DesktopLyricsSettings): number {
    if (!lrc?.length) {
        return 0
    }

    if (s.karaokeMode && klyric?.[lineIndex]) {
        return closestLrcIndex(karaokeLineStart(klyric[lineIndex]))
    }

    return Math.min(lineIndex, lrc.length - 1)
}

function lineStartTime(lineIndex: number, lrcIndex: number, s: DesktopLyricsSettings): number {
    if (s.karaokeMode && klyric?.[lineIndex]) {
        return karaokeLineStart(klyric[lineIndex])
    }

    return lrc?.[lrcIndex]?.time ?? 0
}

function closestLyricIndexByTime(arr: Lyric[] | null, targetTime: number, fallbackIdx: number): number {
    if (!arr?.length) {
        return -1
    }

    let best = Math.max(0, Math.min(fallbackIdx, arr.length - 1))
    let bestDiff = Math.abs(arr[best].time - targetTime)

    for (let i = 0; i < arr.length; i++) {
        const diff = Math.abs(arr[i].time - targetTime)
        if (diff < bestDiff) {
            bestDiff = diff
            best = i
        }
    }

    return bestDiff <= AUX_SYNC_WINDOW_MS ? best : -1
}

function lyricAtTime(arr: Lyric[] | null, targetTime: number, fallbackIdx: number): string {
    const idx = closestLyricIndexByTime(arr, targetTime, fallbackIdx)
    if (idx < 0) {
        return ''
    }

    return arr?.[idx]?.lyric.trim() ?? ''
}

function parseLrc(lrcstr: string | undefined): Lyric[] | null {
    if (!lrcstr) {
        return null
    }

    const fractionToMs = (fraction: string) => {
        if (!fraction) return 0
        const digits = fraction.replace(/[^\d]/g, '')
        if (!digits) return 0

        // LRC has mixed precision in the wild: .x / .xx / .xxx
        // Convert by precision instead of assuming centiseconds only.
        if (digits.length === 1) return Number(digits) * 100
        if (digits.length === 2) return Number(digits) * 10
        if (digits.length === 3) return Number(digits)
        return Number(digits.slice(0, 3))
    }

    return lrcstr.split('\n').map(
        line => {
            const [ time, lyric ] = line.split(']')
            if (!time || !lyric) {
                return {
                    time: 0,
                    lyric: ''
                }
            }

            const [ _, min, sec, frac ] = /(\d+):(\d+)\.(\d+)/g.exec(time.slice(1)) as string[]
            return {
                time: Number(min) * 60 * 1000 + Number(sec) * 1000 + fractionToMs(frac),
                lyric
            }
        }
    ).filter(
        line => line.lyric.trim()
    )
}

function parseYrc(yrcStr: string | undefined): KaraokeLine[] | null {
    if (!yrcStr) return null

    const lines = yrcStr.split('\n')
    const result: KaraokeLine[] = []

    for (const line of lines) {
        const headMatch = /^\[(\d+),(\d+)\]/.exec(line)
        if (!headMatch) continue

        const time = Number(headMatch[1])
        const duration = Number(headMatch[2])
        const rest = line.slice(headMatch[0].length)

        const words: WordTiming[] = []
        const wordRe = /\((\d+),(\d+),\d+\)([^(]+)/g
        let m
        while ((m = wordRe.exec(rest)) !== null) {
            words.push({
                text: m[3],
                start: Number(m[1]),
                duration: Number(m[2]),
            })
        }

        const durationScale = inferDurationScale(words)
        for (let i = 0; i < words.length; i++) {
            const gapToNext = i < words.length - 1
                ? words[i + 1].start - words[i].start
                : Math.max(words[i].duration, 280)

            words[i].duration = normalizeWordDurationMs(
                words[i].duration * durationScale,
                gapToNext,
            )
        }

        if (words.length > 0) {
            result.push({ time, duration, words })
        }
    }

    return result.length > 0 ? result : null
}

function inferDurationScale(words: WordTiming[]) {
    if (words.length < 2) {
        return 1
    }

    let plainErr = 0
    let centiErr = 0
    let samples = 0

    for (let i = 0; i < words.length - 1; i++) {
        const gap = words[i + 1].start - words[i].start
        if (!Number.isFinite(gap) || gap <= 0) {
            continue
        }

        samples++
        plainErr += Math.abs(words[i].duration - gap)
        centiErr += Math.abs(words[i].duration * 10 - gap)
    }

    if (!samples) {
        return 1
    }

    return centiErr < plainErr * 0.92 ? 10 : 1
}

function normalizeWordDurationMs(raw: number, gapToNext: number) {
    const asPlain = raw
    const floor = 36
    const ceil = Math.max(floor + 1, gapToNext > 0 ? gapToNext * 1.2 : 1800)
    return Math.max(floor, Math.min(asPlain, ceil))
}

interface KaraokeWordMeta {
    start: number
    rampMs: number
    endMs: number
}

interface KaraokeDomCache {
    signature: string
    spans: HTMLSpanElement[]
    metas: KaraokeWordMeta[]
}

const karaokeDomCache = new WeakMap<HTMLDivElement, KaraokeDomCache>()

let playbackClock = {
    playMs: 0,
    perfAt: 0,
    playing: false,
}

let lyricsRafId = 0
let seekPollInflight: Promise<void> | null = null
let lastSeekPollAt = 0

function clamp01(v: number) {
    return Math.min(1, Math.max(0, v))
}

function smoothstep(t: number) {
    const x = clamp01(t)
    return x * x * (3 - 2 * x)
}

function buildKaraokeWordMetas(words: WordTiming[]): KaraokeWordMeta[] {
    return words.map((word, index) => {
        const nextStart = index < words.length - 1
            ? words[index + 1].start
            : word.start + Math.max(word.duration, 360)

        const gapMs = Math.max(32, nextStart - word.start)
        const syllableMs = Math.max(word.duration, 32)
        const rampMs = Math.max(48, Math.min(gapMs, syllableMs * 0.92))

        return {
            start: word.start,
            rampMs,
            endMs: nextStart,
        }
    })
}

function wordHighlightBlend(meta: KaraokeWordMeta, now: number) {
    if (now < meta.start) {
        return 0
    }

    if (now >= meta.endMs) {
        return 1
    }

    return smoothstep((now - meta.start) / meta.rampMs)
}

function syncPlaybackClock(playing: unknown, currentSec: number) {
    playbackClock = {
        playMs: currentSec * 1000,
        perfAt: performance.now(),
        playing: !!playing,
    }
}

function playbackNowMs() {
    if (!playbackClock.playing) {
        return playbackClock.playMs
    }

    return playbackClock.playMs + (performance.now() - playbackClock.perfAt)
}

function pollPlaybackPosition() {
    if (!playbackClock.playing) {
        return
    }

    const perfNow = performance.now()
    if (perfNow - lastSeekPollAt < SEEK_POLL_INTERVAL_MS || seekPollInflight) {
        return
    }

    lastSeekPollAt = perfNow
    seekPollInflight = player.invoke(':seek')
        .then(sec => {
            if (typeof sec === 'number' && Number.isFinite(sec)) {
                syncPlaybackClock(true, sec)
            }
        })
        .catch(() => {})
        .finally(() => {
            seekPollInflight = null
        })
}

function shouldRunLyricsAnimation() {
    return !!lrc?.length && playbackClock.playing
}

function stopLyricsAnimation() {
    if (lyricsRafId) {
        cancelAnimationFrame(lyricsRafId)
        lyricsRafId = 0
    }
}

function scheduleLyricsAnimation() {
    if (!shouldRunLyricsAnimation()) {
        stopLyricsAnimation()
        return
    }

    if (lyricsRafId) {
        return
    }

    const tick = () => {
        lyricsRafId = 0

        if (!shouldRunLyricsAnimation()) {
            return
        }

        pollPlaybackPosition()
        void renderLines(playbackNowMs())
        lyricsRafId = requestAnimationFrame(tick)
    }

    lyricsRafId = requestAnimationFrame(tick)
}

function ensureKaraokeSpans(textEl: HTMLDivElement, line: KaraokeLine) {
    const signature = line.words.map(w => `${w.start}:${w.duration}:${w.text}`).join('|')
    let cache = karaokeDomCache.get(textEl)

    if (!cache || cache.signature !== signature) {
        textEl.replaceChildren()
        const spans = line.words.map(w => {
            const span = document.createElement('span')
            span.className = 'word'
            span.textContent = w.text
            span.style.setProperty('--p', '0')
            textEl.appendChild(span)
            return span
        })
        cache = {
            signature,
            spans,
            metas: buildKaraokeWordMetas(line.words),
        }
        karaokeDomCache.set(textEl, cache)
    }

    return cache
}

function renderKaraokeLine(
    viewport: HTMLDivElement,
    textEl: HTMLDivElement,
    line: KaraokeLine,
    now: number,
    colorCurrent: string,
    colorNext: string,
) {
    textEl.classList.add('karaoke-line')
    textEl.style.setProperty('--lrc-current', colorCurrent)
    textEl.style.setProperty('--lrc-next', colorNext)

    const { spans, metas } = ensureKaraokeSpans(textEl, line)

    for (let i = 0; i < spans.length; i++) {
        const blend = wordHighlightBlend(metas[i], now)
        spans[i].style.setProperty('--p', blend.toFixed(4))
    }

    updateKaraokeScroll(viewport, textEl, metas, spans, now)
}

function resetLyricLayout(viewport: HTMLDivElement, textEl: HTMLDivElement) {
    viewport.classList.remove('scroll-karaoke', 'fit-static', 'is-overflow')
    textEl.style.removeProperty('--scroll-x')
    textEl.style.removeProperty('--fit-scale')
}

function fitStaticLyricInViewport(viewport: HTMLDivElement, textEl: HTMLDivElement) {
    resetLyricLayout(viewport, textEl)
    viewport.classList.add('fit-static')
    textEl.style.setProperty('--fit-scale', '1')

    const maxW = viewport.clientWidth
    if (maxW <= 0) {
        return
    }

    const contentW = textEl.scrollWidth
    if (contentW > maxW) {
        viewport.classList.add('is-overflow')
        const scale = Math.max(0.48, (maxW - 6) / contentW)
        textEl.style.setProperty('--fit-scale', scale.toFixed(4))
    }
}

function updateKaraokeScroll(
    viewport: HTMLDivElement,
    textEl: HTMLDivElement,
    metas: KaraokeWordMeta[],
    spans: HTMLSpanElement[],
    now: number,
) {
    viewport.classList.remove('fit-static')
    viewport.classList.add('scroll-karaoke')
    textEl.style.removeProperty('--fit-scale')

    const maxW = viewport.clientWidth
    if (maxW <= 0 || spans.length === 0) {
        return
    }

    const contentW = textEl.scrollWidth
    if (contentW <= maxW) {
        textEl.style.setProperty('--scroll-x', '0px')
        return
    }

    viewport.classList.add('is-overflow')

    let anchorIndex = 0
    for (let i = 0; i < metas.length; i++) {
        if (now >= metas[i].start) {
            anchorIndex = i
        }
    }

    const focusRatio = 0.36
    const anchorSpan = spans[anchorIndex]
    let targetCenter = anchorSpan.offsetLeft + anchorSpan.offsetWidth / 2

    if (anchorIndex < metas.length - 1) {
        const curMeta = metas[anchorIndex]
        const nextMeta = metas[anchorIndex + 1]
        const nextSpan = spans[anchorIndex + 1]
        const gapStart = curMeta.start + curMeta.rampMs * 0.35
        const gapEnd = nextMeta.start

        if (now >= gapStart && gapEnd > gapStart) {
            const curCenter = anchorSpan.offsetLeft + anchorSpan.offsetWidth / 2
            const nextCenter = nextSpan.offsetLeft + nextSpan.offsetWidth / 2
            const t = smoothstep((now - gapStart) / (gapEnd - gapStart))
            targetCenter = curCenter + (nextCenter - curCenter) * t
        }
    }

    const maxScroll = contentW - maxW
    const offset = Math.max(0, Math.min(targetCenter - maxW * focusRatio, maxScroll))
    textEl.style.setProperty('--scroll-x', `${-offset}px`)
}

function layoutAuxiliaryLyrics(refs: LyricLineRefs) {
    if (refs.roma.innerText.trim()) {
        fitStaticLyricInViewport(refs.romaViewport, refs.roma)
    } else {
        resetLyricLayout(refs.romaViewport, refs.roma)
    }

    if (refs.trans.innerText.trim()) {
        fitStaticLyricInViewport(refs.transViewport, refs.trans)
    } else {
        resetLyricLayout(refs.transViewport, refs.trans)
    }
}

function lyricAt(arr: Lyric[] | null, index: number): string {
    return arr?.[index]?.lyric.trim() ?? ''
}

function karaokeLineStart(line: KaraokeLine): number {
    return line.words?.[0]?.start ?? line.time
}

function findKaraokeLineAtTime(now: number): KaraokeLine | null {
    if (!klyric?.length) {
        return null
    }

    const windowStart = now + LINE_SWITCH_EARLY_MS

    for (let i = 0; i < klyric.length; i++) {
        const line = klyric[i]
        const lineStart = karaokeLineStart(line)
        const nextTime = i < klyric.length - 1
            ? karaokeLineStart(klyric[i + 1])
            : line.time + Math.max(line.duration, 400)

        if (windowStart >= lineStart && now < nextTime) {
            return line
        }
    }

    let best = klyric[0]
    let bestDiff = Math.abs(karaokeLineStart(best) - now)

    for (const line of klyric) {
        const diff = Math.abs(karaokeLineStart(line) - now)
        if (diff < bestDiff) {
            bestDiff = diff
            best = line
        }
    }

    return bestDiff <= 6000 ? best : null
}

function renderMainLyricText(
    viewport: HTMLDivElement,
    textEl: HTMLDivElement,
    lrcIndex: number,
    now: number,
    s: DesktopLyricsSettings,
): boolean {
    const kLine = s.karaokeMode ? findKaraokeLineAtTime(now) : null

    if (kLine) {
        renderKaraokeLine(viewport, textEl, kLine, now, s.colorCurrent, s.colorNext)
        return true
    }

    textEl.classList.remove('karaoke-line')
    karaokeDomCache.delete(textEl)
    textEl.innerText = lrc![lrcIndex].lyric
    fitStaticLyricInViewport(viewport, textEl)
    return false
}

const container = document.getElementById('container') as HTMLDivElement
const setLock = lock()

let lastWindowHeight = 0

function wrapInViewport(content: HTMLDivElement): HTMLDivElement {
    const viewport = document.createElement('div')
    viewport.className = 'lrc-viewport'
    viewport.appendChild(content)
    return viewport
}

function clearLineAnimationClasses(refs: LyricLineRefs) {
    refs.line.classList.remove('entering', 'leaving')
}

function resetAnimationState() {
    if (pendingDualAnimationFrame) {
        cancelAnimationFrame(pendingDualAnimationFrame)
        pendingDualAnimationFrame = 0
    }
    if (pendingMultiAnimationFrame) {
        cancelAnimationFrame(pendingMultiAnimationFrame)
        pendingMultiAnimationFrame = 0
    }

    lastL1Dual = -1
    lastL1Multi = -1
    isSeeking = false
    lastPlayTimeMs = -1
    lineHeight = 0

    container.classList.remove('multi-animating')
    container.style.removeProperty('--multi-shift')

    for (const refs of domLines) {
        clearLineAnimationClasses(refs)
        refs.line.style.removeProperty('transform')
    }
}

function createLineElement(): LyricLineRefs {
    const line = document.createElement('div')
    line.className = 'lrc-line'

    const roma = document.createElement('div')
    roma.className = 'lrc romaji'

    const text = document.createElement('div')
    text.className = 'lrc'

    const trans = document.createElement('div')
    trans.className = 'lrc translation'

    const romaViewport = wrapInViewport(roma)
    const textViewport = wrapInViewport(text)
    const transViewport = wrapInViewport(trans)

    line.append(romaViewport, textViewport, transViewport)

    return { line, roma, text, trans, romaViewport, textViewport, transViewport }
}

function initDOM(visibleLines: number) {
    container.innerHTML = ''
    container.classList.toggle('dual-line', visibleLines === 2)
    domLines = []

    for (let i = 0; i < visibleLines; i++) {
        const refs = createLineElement()
        domLines.push(refs)
        container.appendChild(refs.line)
    }

    domLineCount = visibleLines
    resetAnimationState()
}

function ensureDOM(visibleLines: number) {
    const n = normalizeVisibleLines(visibleLines)

    if (n === domLineCount && domLines.length === n) {
        container.classList.toggle('dual-line', n === 2)
        return
    }

    initDOM(n)
}

function updateWindowHeight() {
    const h = container.offsetHeight
    if (Math.abs(h - lastWindowHeight) > 5) {
        lastWindowHeight = h
        ipcRenderer.send('desktop-lyrics-resize', h)
    }
}

function applyBackgroundStyle(s: DesktopLyricsSettings) {
    const unlocked = !s.lock
    const bgColor = unlocked ? s.bgColorUnlocked : s.bgColorLocked
    document.body.style.setProperty('--bg-color', bgColor)

    if (s.bgBlurEnabled && s.bgBlurRadius > 0) {
        document.body.style.setProperty('--bg-blur', `blur(${s.bgBlurRadius}px)`)
    } else {
        document.body.style.removeProperty('--bg-blur')
    }
}

function applyTranslationStyle(el: HTMLDivElement, color: string, fontSize: string, focused: boolean) {
    el.style.color = color
    el.style.fontSize = fontSize
    el.classList.toggle('focus', focused)
}

function applyRomajiStyle(el: HTMLDivElement, focused: boolean) {
    el.classList.toggle('focus', focused)
}

function clearLineState(refs: LyricLineRefs) {
    refs.line.classList.remove('past', 'current', 'future')
    refs.text.classList.remove('focus')
    refs.roma.classList.remove('focus')
    refs.trans.classList.remove('focus')
    if (!refs.text.classList.contains('karaoke-line')) {
        resetLyricLayout(refs.textViewport, refs.text)
    }
    resetLyricLayout(refs.romaViewport, refs.roma)
    resetLyricLayout(refs.transViewport, refs.trans)
}

function ensureLineHeight() {
    if (lineHeight > 0) {
        return
    }

    const first = domLines[0]?.line
    lineHeight = first ? Math.max(48, first.offsetHeight + 4) : 56
}

function fillRomajiAndTranslation(
    refs: LyricLineRefs,
    s: DesktopLyricsSettings,
    lyricIdx: number,
    lineTime: number,
    focused: boolean,
) {
    if (s.showRomaji) {
        refs.roma.innerText = lyricAtTime(romalrc, lineTime, lyricIdx)
        applyRomajiStyle(refs.roma, focused)
    } else {
        refs.roma.innerText = ''
    }

    if (s.showTranslation) {
        refs.trans.innerText = lyricAtTime(tlyric, lineTime, lyricIdx)
        applyTranslationStyle(refs.trans, s.colorTranslation, s.fontSizeTranslation, focused)
    } else {
        refs.trans.innerText = ''
    }
}

function renderPlaceholder(s: DesktopLyricsSettings) {
    const visibleLines = normalizeVisibleLines(s.visibleLines)

    for (let i = 0; i < domLines.length; i++) {
        const refs = domLines[i]
        clearLineState(refs)

        if (i < 2) {
            refs.line.style.display = ''
            refs.text.style.fontSize = s.fontSize
            refs.text.style.color = i === 0 ? s.colorCurrent : s.colorNext
            refs.text.innerText = i === 0 ? '桌面歌词' : '播放歌曲后显示歌词'
            fitStaticLyricInViewport(refs.textViewport, refs.text)
            refs.roma.innerText = ''
            refs.trans.innerText = ''
        } else {
            refs.line.style.display = 'none'
        }
    }

    container.classList.toggle('dual-line', visibleLines === 2)
}

function renderDualLine(s: DesktopLyricsSettings, l1: number, time: number, l2?: number) {
    const top = domLines[0]
    const bottom = domLines[1]

    for (const refs of domLines) {
        refs.line.style.display = ''
        clearLineState(refs)
    }

    let current: LyricLineRefs
    let next: LyricLineRefs

    if (s.karaokeMode) {
        current = top
        next = bottom
    } else if (l1 % 2) {
        current = bottom
        next = top
    } else {
        current = top
        next = bottom
    }

    current.text.classList.add('focus')
    next.text.classList.remove('focus')

    for (const refs of domLines) {
        refs.text.style.fontSize = s.fontSize
    }

    const currentLrcIndex = resolveLrcIndex(l1, s)
    const currentLineTime = lineStartTime(l1, currentLrcIndex, s)
    const nextLrcIndex = resolveLrcIndex(l2 ?? l1, s)
    const nextLineTime = lineStartTime(l2 ?? l1, nextLrcIndex, s)

    const applyDualContent = () => {
        const currentIsKaraoke = renderMainLyricText(
            current.textViewport,
            current.text,
            currentLrcIndex,
            time,
            s,
        )
        if (!currentIsKaraoke) {
            current.text.style.color = s.colorCurrent
        }

        next.text.classList.remove('karaoke-line')
        karaokeDomCache.delete(next.text)
        next.text.innerText = l2 !== undefined ? lrc![nextLrcIndex].lyric : ' '
        next.text.style.color = s.colorNext
        fitStaticLyricInViewport(next.textViewport, next.text)

        fillRomajiAndTranslation(current, s, currentLrcIndex, currentLineTime, true)
        fillRomajiAndTranslation(next, s, nextLrcIndex, nextLineTime, false)
        layoutAuxiliaryLyrics(current)
        layoutAuxiliaryLyrics(next)
    }

    const lineChanged = lastL1Dual >= 0 && lastL1Dual !== l1
    lastL1Dual = l1
    const shouldAnimate = lineChanged && !isSeeking && !s.karaokeMode

    if (shouldAnimate) {
        current.line.classList.add('leaving')
        next.line.classList.add('entering')

        if (pendingDualAnimationFrame) {
            cancelAnimationFrame(pendingDualAnimationFrame)
        }

        pendingDualAnimationFrame = requestAnimationFrame(() => {
            pendingDualAnimationFrame = 0
            applyDualContent()
            current.line.classList.remove('leaving')
            next.line.classList.remove('entering')
        })
    } else {
        clearLineAnimationClasses(current)
        clearLineAnimationClasses(next)
        applyDualContent()
    }
}

function renderMultiLine(s: DesktopLyricsSettings, l1: number, time: number) {
    const visibleLines = normalizeVisibleLines(s.visibleLines)
    const half = Math.floor(visibleLines / 2)
    const useKaraokeTimeline = s.karaokeMode && !!klyric?.length
    const lineCount = useKaraokeTimeline ? klyric!.length : lrc!.length
    const startIdx = Math.max(0, l1 - half)
    const endIdx = Math.min(lineCount - 1, l1 + half)

    const prevL1 = lastL1Multi
    const lineDelta = prevL1 >= 0 ? l1 - prevL1 : 0
    const lineChanged = prevL1 >= 0 && prevL1 !== l1
    lastL1Multi = l1
    ensureLineHeight()

    const shouldAnimate = lineChanged
        && Math.abs(lineDelta) <= 1
        && !isSeeking
        && !s.karaokeMode

    container.classList.remove('multi-animating')
    container.style.removeProperty('--multi-shift')

    if (shouldAnimate) {
        const shift = lineDelta > 0 ? lineHeight : -lineHeight
        container.classList.add('multi-animating')
        container.style.setProperty('--multi-shift', `${shift}px`)

        if (pendingMultiAnimationFrame) {
            cancelAnimationFrame(pendingMultiAnimationFrame)
        }
    }

    for (let slot = 0; slot < visibleLines; slot++) {
        const refs = domLines[slot]
        const lyricIdx = startIdx + slot
        clearLineState(refs)

        if (lyricIdx > endIdx || lyricIdx >= lineCount) {
            refs.line.style.display = 'none'
            continue
        }

        refs.line.style.display = ''
        refs.text.style.fontSize = s.fontSize

        const lrcIndex = resolveLrcIndex(lyricIdx, s)
        const lineTime = lineStartTime(lyricIdx, lrcIndex, s)
        const isKaraoke = lyricIdx === l1
            && renderMainLyricText(refs.textViewport, refs.text, lrcIndex, time, s)

        if (!isKaraoke) {
            refs.text.classList.remove('karaoke-line')
            karaokeDomCache.delete(refs.text)
            refs.text.innerText = lrc![lrcIndex].lyric
            fitStaticLyricInViewport(refs.textViewport, refs.text)
        }

        if (lyricIdx < l1) {
            refs.line.classList.add('past')
            if (!isKaraoke) {
                refs.text.style.color = s.colorNext
            }
        } else if (lyricIdx === l1) {
            refs.line.classList.add('current')
            if (!isKaraoke) {
                refs.text.style.color = s.colorCurrent
            }
        } else {
            refs.line.classList.add('future')
            if (!isKaraoke) {
                refs.text.style.color = s.colorNext
            }
        }

        fillRomajiAndTranslation(refs, s, lrcIndex, lineTime, lyricIdx === l1)
        layoutAuxiliaryLyrics(refs)
    }

    if (shouldAnimate) {
        const firstLine = domLines[0]
        const lastLine = domLines[visibleLines - 1]
        if (lineDelta > 0) {
            firstLine?.line.classList.add('leaving')
            lastLine?.line.classList.add('entering')
        } else {
            firstLine?.line.classList.add('entering')
            lastLine?.line.classList.add('leaving')
        }

        pendingMultiAnimationFrame = requestAnimationFrame(() => {
            pendingMultiAnimationFrame = 0
            container.style.setProperty('--multi-shift', '0px')
            firstLine?.line.classList.remove('entering', 'leaving')
            lastLine?.line.classList.remove('entering', 'leaving')
        })
    } else {
        for (const refs of domLines) {
            clearLineAnimationClasses(refs)
        }
    }
}

async function renderLines(time: number) {
    const s = cachedSettings
    const visibleLines = normalizeVisibleLines(s.visibleLines)
    applyBackgroundStyle(s)

    ensureDOM(visibleLines)

    if (!lrc?.length) {
        renderPlaceholder(s)
        setLock(s.lock)
        updateWindowHeight()
        return
    }

    const [ l1, l2 ] = getActiveLineIndex(time, s)

    if (visibleLines === 2) {
        renderDualLine(s, l1, time, l2)
    } else {
        renderMultiLine(s, l1, time)
    }

    setLock(s.lock)

    updateWindowHeight()
}

function lock() {
    let lockState = true
    return (newState: boolean) => {
        if (newState !== lockState) {
            ipcRenderer.invoke('desktop-lyrics-lock', lockState = newState)
            return true
        }

        return false
    }
}

const EXTENSION_ID = '23dc60b0-4621-4ab3-92f7-50baf8b6ec1a'

function applyLockFromSettings(s: DesktopLyricsSettings) {
    setLock(s.lock)
    applyBackgroundStyle(s)
}

subscribe('player', loadLyrics)
subscribe('playstate', ([ playing, , , current ]) => {
    const currentMs = current * 1000
    if (lastPlayTimeMs >= 0) {
        isSeeking = Math.abs(currentMs - lastPlayTimeMs) > SEEK_THRESHOLD_MS
    } else {
        isSeeking = false
    }
    lastPlayTimeMs = currentMs

    syncPlaybackClock(playing, current)
    void renderLines(playbackNowMs())
    scheduleLyricsAnimation()
})
subscribe('ext-settings', ([ extId ]) => {
    if (extId === EXTENSION_ID) {
        refreshSettings().then(s => {
            applyLockFromSettings(s)
            resetAnimationState()
            scheduleLyricsAnimation()
        })
    }
})

refreshSettings().then(s => {
    applyLockFromSettings(s)
    resetAnimationState()
    return loadLyrics()
})