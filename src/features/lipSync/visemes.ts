/**
 * Azure / Edge TTS の viseme（口形素）を VRM の口形へ変換する。
 *
 * モデルがカスタム表情 viseme_0 〜 viseme_21（viseme_00 のゼロ埋めも可）を持っていればそれをそのまま使い、
 * 持っていない ID だけ標準の口形5種（aa ih ou ee oh）へ置き換える。
 *
 * viseme ID 一覧: https://learn.microsoft.com/azure/ai-services/speech-service/how-to-speech-synthesis-viseme
 */

export type MouthShape = 'aa' | 'ih' | 'ou' | 'ee' | 'oh'
export type MouthWeights = Partial<Record<MouthShape, number>>

/** t: 音声先頭からのミリ秒, id: Azure viseme ID (0-21) */
export type Viseme = { t: number; id: number }

export const MOUTH_SHAPES: MouthShape[] = ['aa', 'ih', 'ou', 'ee', 'oh']

export const VISEME_COUNT = 22

/** モデル側で22種を直接持つ場合のVRMカスタム表情名の候補（viseme_5 / viseme_05） */
export const visemeExpressionNames = (id: number) =>
  Array.from(new Set([`viseme_${id}`, `viseme_${String(id).padStart(2, '0')}`]))

// 母音は口形をはっきり、子音は弱めに開ける。値は目視で調整した初期値
export const VISEME_SHAPES: Record<number, MouthWeights> = {
  0: {}, // 無音
  1: { aa: 0.5, oh: 0.2 }, // æ ə ʌ
  2: { aa: 0.8 }, // ɑ
  3: { oh: 0.7, aa: 0.2 }, // ɔ
  4: { ee: 0.6, aa: 0.2 }, // ɛ ʊ
  5: { oh: 0.4, ou: 0.2 }, // ɝ
  6: { ih: 0.6, ee: 0.2 }, // j i ɪ
  7: { ou: 0.7 }, // w u
  8: { oh: 0.7 }, // o
  9: { aa: 0.6, ou: 0.2 }, // aʊ
  10: { oh: 0.6, ih: 0.1 }, // ɔɪ
  11: { aa: 0.6, ih: 0.2 }, // aɪ
  12: { aa: 0.3 }, // h
  13: { ou: 0.4 }, // ɹ
  14: { aa: 0.3, ih: 0.1 }, // l
  15: { ih: 0.4 }, // s z
  16: { ou: 0.5, ih: 0.1 }, // ʃ tʃ dʒ ʒ
  17: { aa: 0.2, ih: 0.2 }, // ð
  18: { ih: 0.2 }, // f v
  19: { ih: 0.3, aa: 0.1 }, // d t n θ
  20: { aa: 0.3 }, // k g ŋ
  21: {}, // p b m（唇を閉じる）
}

/** 時刻 ms 時点で有効な viseme ID を返す（visemes は t 昇順）。先頭より前は null */
export function visemeIdAt(visemes: Viseme[], ms: number): number | null {
  let lo = 0
  let hi = visemes.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (visemes[mid].t <= ms) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found < 0 ? null : visemes[found].id
}
