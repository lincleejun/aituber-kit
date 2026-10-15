import * as THREE from 'three'
import {
  VRM,
  VRMExpressionManager,
  VRMExpressionPresetName,
} from '@pixiv/three-vrm'
import { AutoLookAt } from './autoLookAt'
import { AutoBlink } from './autoBlink'
import {
  MOUTH_SHAPES,
  VISEME_COUNT,
  VISEME_SHAPES,
  visemeExpressionNames,
} from '@/features/lipSync/visemes'

/** 表情名 → 重み。口形5種とモデル独自の viseme_N 表情を同じ扱いで混ぜる */
type LipSyncWeights = Partial<Record<string, number>>

// 口形の追従速度（1/秒）。大きいほど速く切り替わる
const LIP_SYNC_SMOOTHING = 30
// 感情表現中は口の動きを抑えて表情を崩さない
const LIP_SYNC_EMOTION_GAIN = 0.5

/**
 * Expressionを管理するクラス
 *
 * 主に前の表情を保持しておいて次の表情を適用する際に0に戻す作業や、
 * 前の表情が終わるまで待ってから表情適用する役割を持っている。
 */
export class ExpressionController {
  private _autoLookAt: AutoLookAt
  private _autoBlink?: AutoBlink
  private _expressionManager?: VRMExpressionManager
  private _currentEmotion: VRMExpressionPresetName
  private _lipSyncTarget: LipSyncWeights = {}
  private _lipSyncCurrent: Record<string, number> = {}
  private _lipSyncNames: string[] = [...MOUTH_SHAPES]
  /** viseme ID → モデル内の表情名 */
  private _modelVisemes = new Map<number, string>()
  constructor(vrm: VRM, camera: THREE.Object3D) {
    this._autoLookAt = new AutoLookAt(vrm, camera)
    this._currentEmotion = 'neutral'
    if (vrm.expressionManager) {
      this._expressionManager = vrm.expressionManager
      this._autoBlink = new AutoBlink(vrm.expressionManager)
      for (let id = 0; id < VISEME_COUNT; id++) {
        const name = visemeExpressionNames(id).find((n) =>
          vrm.expressionManager?.getExpression(n)
        )
        if (name) {
          this._modelVisemes.set(id, name)
          this._lipSyncNames.push(name)
        }
      }
    }
    for (const name of this._lipSyncNames) this._lipSyncCurrent[name] = 0
  }

  /** モデルが直接持っている viseme 表情の数（0〜22） */
  public get modelVisemeCount() {
    return this._modelVisemes.size
  }

  public playEmotion(preset: VRMExpressionPresetName) {
    if (this._currentEmotion != 'neutral') {
      this._expressionManager?.setValue(this._currentEmotion, 0)
    }

    if (preset == 'neutral') {
      this._autoBlink?.setEnable(true)
      this._currentEmotion = preset
      return
    }

    const t = this._autoBlink?.setEnable(false) || 0
    this._currentEmotion = preset
    setTimeout(() => {
      this._expressionManager?.setValue(preset, 1)
    }, t * 1000)
  }

  public lipSync(weights: LipSyncWeights) {
    this._lipSyncTarget = weights
  }

  /** モデルが持つ viseme はそのまま使い、持たない ID は口形5種で近似する */
  public lipSyncViseme(id: number | null) {
    if (id === null) {
      this.lipSync({})
    } else if (this._modelVisemes.has(id)) {
      this.lipSync({ [this._modelVisemes.get(id)!]: 1 })
    } else {
      this.lipSync(VISEME_SHAPES[id] ?? {})
    }
  }

  public update(delta: number) {
    if (this._autoBlink) {
      this._autoBlink.update(delta)
    }

    const gain = this._currentEmotion === 'neutral' ? 1 : LIP_SYNC_EMOTION_GAIN
    const k = 1 - Math.exp(-delta * LIP_SYNC_SMOOTHING)
    for (const name of this._lipSyncNames) {
      const target = (this._lipSyncTarget[name] ?? 0) * gain
      const current = this._lipSyncCurrent[name]
      const next = current + (target - current) * k
      this._lipSyncCurrent[name] = next
      this._expressionManager?.setValue(name, next)
    }
  }
}
