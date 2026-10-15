import { logger } from '@/lib/logger'
import * as THREE from 'three'
import {
  VRM,
  VRMExpressionPresetName,
  VRMLoaderPlugin,
  VRMUtils,
} from '@pixiv/three-vrm'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMAnimation } from '../../lib/VRMAnimation/VRMAnimation'
import { VRMLookAtSmootherLoaderPlugin } from '@/lib/VRMLookAtSmootherLoaderPlugin/VRMLookAtSmootherLoaderPlugin'
import { LipSync } from '../lipSync/lipSync'
import { EmoteController } from '../emoteController/emoteController'
import { Talk } from '../messages/messages'
import { PoseManager } from '@/lib/VRMAnimation/poseManager'
import settingsStore from '@/features/stores/settings'
import type { PlaybackObserver } from '../messages/characterRenderer'
import { Viseme, visemeIdAt } from '../lipSync/visemes'

/**
 * 3Dキャラクターを管理するクラス
 */
export class Model {
  public externalLipSyncVolume: number | null = null
  public vrm?: VRM | null
  public mixer?: THREE.AnimationMixer
  public emoteController?: EmoteController
  public currentAction?: THREE.AnimationAction
  public poseYRotationOffset: number = 0
  public poseManager: PoseManager
  /** visemeを音声に対して前後させる補正（ms）。正の値で口が早く動く */
  public visemeOffsetMs: number = 0

  private _lookAtTargetParent: THREE.Object3D
  private _lipSync?: LipSync
  private _yOffsetQuat = new THREE.Quaternion()
  private _visemes: Viseme[] | null = null
  private _visemeStartTime: number | null = null
  private _speakId = 0

  constructor(lookAtTargetParent: THREE.Object3D) {
    this._lookAtTargetParent = lookAtTargetParent
    this._lipSync = new LipSync(new AudioContext(), { forceStart: true })
    this.poseManager = new PoseManager()
  }

  public async loadVRM(url: string): Promise<void> {
    const loader = new GLTFLoader()
    loader.register(
      (parser) =>
        new VRMLoaderPlugin(parser, {
          lookAtPlugin: new VRMLookAtSmootherLoaderPlugin(parser),
        })
    )

    const gltf = await loader.loadAsync(url)

    const vrm = (this.vrm = gltf.userData.vrm)
    vrm.scene.name = 'VRMRoot'

    VRMUtils.rotateVRM0(vrm)
    this.mixer = new THREE.AnimationMixer(vrm.scene)

    this.emoteController = new EmoteController(vrm, this._lookAtTargetParent)
  }

  public unLoadVrm() {
    if (this.vrm) {
      VRMUtils.deepDispose(this.vrm.scene)
      this.vrm = null
    }
  }

  /**
   * VRMアニメーションを読み込む
   *
   * https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/README.ja.md
   */
  public async loadAnimation(vrmAnimation: VRMAnimation): Promise<void> {
    const { vrm, mixer } = this
    if (vrm == null || mixer == null) {
      throw new Error('You have to load VRM first')
    }

    const clip = vrmAnimation.createAnimationClip(vrm)
    const action = mixer.clipAction(clip)
    this.currentAction = action
    action.play()
  }

  /**
   * 音声を再生し、リップシンクを行う
   */
  public async speak(
    buffer: ArrayBuffer,
    talk: Talk,
    isNeedDecode: boolean = true,
    observer?: PlaybackObserver
  ) {
    this.emoteController?.playEmotion(talk.emotion)

    if (talk.motion) {
      const poseConfig = settingsStore
        .getState()
        .poseConfigs.find((p) => p.id === talk.motion)
      if (poseConfig) {
        void this.poseManager
          .applyPose(this, talk.motion, poseConfig)
          .catch((e) => logger.error('Failed to apply pose:', e))
      }
    } else if (this.poseManager.isActive) {
      // モーション指定なしの発話ではアクティブなポーズをリセット
      this.poseManager.resetToIdle(this)
    }

    const speakId = ++this._speakId
    this._visemes = talk.visemes?.length ? talk.visemes : null
    this._visemeStartTime = null

    await new Promise((resolve) => {
      this._lipSync?.playFromArrayBuffer(
        buffer,
        () => {
          // 停止した前の音声の終了通知が遅れて届いても、次の発話のvisemeは消さない
          if (this._speakId === speakId) this._visemes = null
          resolve(true)
        },
        isNeedDecode,
        24000,
        () => {
          if (this._speakId === speakId) {
            this._visemeStartTime = this._lipSync?.audio.currentTime ?? null
          }
          observer?.onPlaybackStart?.()
        }
      )
    })
  }

  /** ヘッダーなしPCM16を到着したチャンクから順に再生する。 */
  public async speakPcm16Stream(
    stream: ReadableStream<Uint8Array>,
    talk: Talk,
    sampleRate: number,
    observer?: PlaybackObserver
  ) {
    this.emoteController?.playEmotion(talk.emotion)
    this._visemes = null

    if (talk.motion) {
      const poseConfig = settingsStore
        .getState()
        .poseConfigs.find((p) => p.id === talk.motion)
      if (poseConfig) {
        void this.poseManager
          .applyPose(this, talk.motion, poseConfig)
          .catch((e) => logger.error('Failed to apply pose:', e))
      }
    } else if (this.poseManager.isActive) {
      this.poseManager.resetToIdle(this)
    }

    await this._lipSync?.playPcm16Stream(
      stream,
      undefined,
      sampleRate,
      observer?.onPlaybackStart
    )
  }

  /**
   * 現在の音声再生を停止
   */
  public stopSpeaking() {
    this._visemes = null
    this._lipSync?.stopCurrentPlayback()
  }

  /**
   * 感情表現を再生する
   */
  public async playEmotion(preset: VRMExpressionPresetName) {
    this.emoteController?.playEmotion(preset)
  }

  public update(delta: number): void {
    if (this._lipSync) {
      const { volume } = this._lipSync.update()
      if (this._visemes && this._visemeStartTime !== null) {
        const elapsedMs =
          (this._lipSync.audio.currentTime - this._visemeStartTime) * 1000 +
          this.visemeOffsetMs
        this.emoteController?.lipSyncViseme(
          visemeIdAt(this._visemes, elapsedMs)
        )
      } else {
        // visemeが無いTTSは音量だけで口を開閉する
        const v = this.externalLipSyncVolume ?? volume
        this.emoteController?.lipSync({ aa: v * 0.5 })
      }
    }

    this.emoteController?.update(delta)
    this.mixer?.update(delta)

    if (this.poseYRotationOffset !== 0 && this.vrm) {
      const hipsNode = this.vrm.humanoid.getNormalizedBoneNode('hips')
      if (hipsNode) {
        this._yOffsetQuat.setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          this.poseYRotationOffset
        )
        hipsNode.quaternion.premultiply(this._yOffsetQuat)
      }
    }

    this.vrm?.update(delta)
  }
}
