import { useEffect, useRef, useState } from 'react'
import VrmViewer from '@/components/vrmViewer'
import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import { fetchEdgeTTS } from '@/features/messages/synthesizeVoiceEdge'
import {
  MOUTH_SHAPES,
  VISEME_COUNT,
  visemeExpressionNames,
  type Viseme,
} from '@/features/lipSync/visemes'
import type { EmotionType } from '@/features/messages/messages'
import '@/lib/i18n'

/**
 * 口形テスト用ページ。Edge TTSで一度だけ合成し、同じ音声を何度でも再生してリップシンクを確認する。
 * LLMは使わない。
 */

const CACHE_KEY = 'aituberkit-lipsync-test'

const DEFAULT_TEXT =
  '大家好，欢迎来到今天的直播。我是你们的虚拟主播。' +
  '今天天气很好，阳光明媚，我们一起去公园散步吧。' +
  '啊，你看那边的小鸟，一只、两只、三只，飞得好高呀！' +
  '衣服、鱼儿、乌鸦、月亮、耳朵，这些词的口型都不一样。' +
  '八百标兵奔北坡，炮兵并排北边跑。' +
  '谢谢大家的支持，我们下次再见，拜拜！'

type Cached = { text: string; voice: string; audio: string; visemes: Viseme[] }

const DEMO_CACHE_KEY = 'aituberkit-lipsync-demo'

// 表情演示：每句一种情绪和一个动作（motion 为 settingsStore.poseConfigs 的 id）
const DEMO_SCRIPT: { emotion: EmotionType; motion?: string; text: string }[] = [
  {
    emotion: 'neutral',
    motion: 'wave',
    text: '大家好，我是小美，很高兴认识你们！',
  },
  {
    emotion: 'happy',
    motion: 'cheer',
    text: '今天收到了好多礼物，我真的太开心啦！',
  },
  {
    emotion: 'surprised',
    motion: 'mouth_cover',
    text: '哇，真的吗？这也太让人意外了吧！',
  },
  {
    emotion: 'sad',
    motion: 'shy',
    text: '可是一想到要和大家说再见，我就有点难过。',
  },
  {
    emotion: 'angry',
    motion: 'crossed_arms',
    text: '哼，谁要是偷吃我的蛋糕，我可要生气了！',
  },
  {
    emotion: 'relaxed',
    motion: 'think',
    text: '嗯……让我想一想，周末去哪里玩好呢？',
  },
  {
    emotion: 'happy',
    motion: 'bow',
    text: '谢谢大家的支持，我们下次再见，拜拜！',
  },
]

type DemoCache = {
  voice: string
  segments: { audio: string; visemes: Viseme[] }[]
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const toBase64 = (buf: ArrayBuffer) => {
  let s = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

const fromBase64 = (b64: string) => {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer as ArrayBuffer
}

export default function LipSyncTest() {
  const [text, setText] = useState(DEFAULT_TEXT)
  const [voice, setVoice] = useState('zh-CN-XiaoxiaoNeural')
  const [cached, setCached] = useState<Cached | null>(null)
  const [mode, setMode] = useState<'viseme' | 'volume'>('viseme')
  const [emotion, setEmotion] = useState<EmotionType>('neutral')
  const [offsetMs, setOffsetMs] = useState(0)
  const [status, setStatus] = useState('')
  const [mouth, setMouth] = useState('')
  const playIdRef = useRef(0)

  // 実際にVRMへ入っている口形の重みを表示する
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const model = homeStore.getState().viewer.model
      const em = model?.vrm?.expressionManager
      if (em) {
        const shapes = MOUTH_SHAPES.map(
          (s) => `${s} ${(em.getValue(s) ?? 0).toFixed(2)}`
        ).join('  ')
        const count = model?.emoteController?.modelVisemeCount ?? 0
        // モデル自身の viseme_N 表情のうち、いま一番強いもの
        let active = ''
        let best = 0.05
        for (let id = 0; id < VISEME_COUNT; id++) {
          for (const name of visemeExpressionNames(id)) {
            const v = em.getValue(name) ?? 0
            if (v > best) {
              best = v
              active = name
            }
          }
        }
        setMouth(
          `${shapes}\n模型自带口型 ${count}/22` +
            (count < 22 ? '，其余用 5 种口型代替' : '') +
            (active ? `，当前 ${active}` : '')
        )
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    setVoice(settingsStore.getState().edgeTtsVoice || 'zh-CN-XiaoxiaoNeural')
    try {
      const saved = localStorage.getItem(CACHE_KEY)
      if (saved) {
        const c: Cached = JSON.parse(saved)
        setCached(c)
        setText(c.text)
        setVoice(c.voice)
        setStatus(`已载入缓存：${c.visemes.length} 个口型`)
      }
    } catch {
      // 缓存不可用时直接重新生成
    }
  }, [])

  useEffect(() => {
    const model = homeStore.getState().viewer.model
    if (model) model.visemeOffsetMs = offsetMs
  }, [offsetMs])

  const generate = async () => {
    setStatus('正在用 Edge TTS 生成…')
    try {
      const { audio, visemes } = await fetchEdgeTTS(text, voice)
      const c = { text, voice, audio: toBase64(audio), visemes }
      setCached(c)
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(c))
      } catch {
        // 存不下也不影响本次测试
      }
      const last = visemes[visemes.length - 1]?.t ?? 0
      setStatus(
        `已生成：${visemes.length} 个口型，约 ${(last / 1000).toFixed(1)} 秒`
      )
    } catch (e) {
      setStatus(`生成失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const play = async () => {
    const model = homeStore.getState().viewer.model
    if (!cached || !model) {
      setStatus(model ? '请先生成语音' : 'VRM 模型还没加载完')
      return
    }
    const playId = ++playIdRef.current
    model.stopSpeaking()
    model.visemeOffsetMs = offsetMs
    setStatus(`播放中（${mode === 'viseme' ? '口型时间轴' : '仅音量'}）`)
    await model.speak(fromBase64(cached.audio), {
      emotion,
      message: '',
      visemes: mode === 'viseme' ? cached.visemes : undefined,
    })
    if (playIdRef.current === playId) setStatus('播放结束')
  }

  // 第一次运行时用 Edge 生成全部台词并缓存，之后直接重放
  const playDemo = async () => {
    const model = homeStore.getState().viewer.model
    if (!model) {
      setStatus('VRM 模型还没加载完')
      return
    }
    const playId = ++playIdRef.current
    let demo: DemoCache | null = null
    try {
      const saved = localStorage.getItem(DEMO_CACHE_KEY)
      if (saved) demo = JSON.parse(saved)
    } catch {
      // 缓存不可用时重新生成
    }
    if (!demo || demo.voice !== voice) {
      try {
        const segments = []
        for (const [i, line] of DEMO_SCRIPT.entries()) {
          setStatus(`正在生成演示语音 ${i + 1}/${DEMO_SCRIPT.length}…`)
          const { audio, visemes } = await fetchEdgeTTS(line.text, voice)
          segments.push({ audio: toBase64(audio), visemes })
        }
        demo = { voice, segments }
        try {
          localStorage.setItem(DEMO_CACHE_KEY, JSON.stringify(demo))
        } catch {
          // 存不下也不影响本次演示
        }
      } catch (e) {
        setStatus(`生成失败：${e instanceof Error ? e.message : String(e)}`)
        return
      }
    }

    model.stopSpeaking()
    model.visemeOffsetMs = offsetMs
    for (const [i, line] of DEMO_SCRIPT.entries()) {
      if (playIdRef.current !== playId) return
      setStatus(
        `表情演示 ${i + 1}/${DEMO_SCRIPT.length}：${line.emotion}` +
          (line.motion ? ` + ${line.motion}` : '')
      )
      await model.speak(fromBase64(demo.segments[i].audio), {
        emotion: line.emotion,
        motion: line.motion,
        message: '',
        visemes: demo.segments[i].visemes,
      })
      await wait(600)
    }
    if (playIdRef.current !== playId) return
    await model.playEmotion('neutral')
    if (model.poseManager.isActive) model.poseManager.resetToIdle(model)
    setStatus('演示结束')
  }

  const stop = () => {
    playIdRef.current++
    homeStore.getState().viewer.model?.stopSpeaking()
  }

  const label = 'block text-xs font-bold mt-3 mb-1'
  const input = 'w-full rounded border border-gray-300 px-2 py-1 text-sm'
  const button =
    'rounded bg-pink-500 px-3 py-1 text-sm font-bold text-white disabled:opacity-40'

  return (
    <div className="relative h-[100svh] w-screen overflow-hidden bg-pink-100">
      <VrmViewer />
      <div className="absolute left-4 top-4 z-10 w-80 max-w-[calc(100vw-2rem)] rounded-lg bg-white/90 p-4 shadow">
        <div className="text-base font-bold">口型测试</div>

        <label className={label}>文本</label>
        <textarea
          className={`${input} h-32`}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <label className={label}>Edge 音色</label>
        <input
          className={input}
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
        />

        <div className="mt-3 flex gap-2">
          <button className={button} onClick={generate}>
            生成语音
          </button>
          <button className={button} onClick={play} disabled={!cached}>
            播放
          </button>
          <button className={button} onClick={stop}>
            停止
          </button>
        </div>
        <button className={`${button} mt-2 w-full`} onClick={playDemo}>
          表情演示（7 句，每句一种情绪和动作）
        </button>

        <label className={label}>口型来源</label>
        <select
          className={input}
          value={mode}
          onChange={(e) => setMode(e.target.value as 'viseme' | 'volume')}
        >
          <option value="viseme">口型时间轴（新）</option>
          <option value="volume">仅音量（旧，只有 aa）</option>
        </select>

        <label className={label}>表情</label>
        <select
          className={input}
          value={emotion}
          onChange={(e) => setEmotion(e.target.value as EmotionType)}
        >
          <option value="neutral">neutral</option>
          <option value="happy">happy</option>
          <option value="sad">sad</option>
          <option value="angry">angry</option>
          <option value="relaxed">relaxed</option>
          <option value="surprised">surprised</option>
        </select>

        <label className={label}>时间偏移：{offsetMs} ms（正数让嘴提前）</label>
        <input
          className="w-full"
          type="range"
          min={-200}
          max={200}
          step={10}
          value={offsetMs}
          onChange={(e) => setOffsetMs(Number(e.target.value))}
        />

        <div className="mt-3 text-xs text-gray-600">{status}</div>
        <div
          className="mt-1 whitespace-pre-line font-mono text-xs"
          data-testid="mouth-weights"
        >
          {mouth}
        </div>
      </div>
    </div>
  )
}
