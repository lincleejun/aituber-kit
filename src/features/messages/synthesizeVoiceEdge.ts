import { Talk } from './messages'
import { synthesizeVoiceApi } from './synthesizeVoiceApi'
import type { Viseme } from '@/features/lipSync/visemes'

export type EdgeTTSResult = { audio: ArrayBuffer; visemes: Viseme[] }

export async function fetchEdgeTTS(
  message: string,
  voice: string
): Promise<EdgeTTSResult> {
  return synthesizeVoiceApi('/api/tts-edge', { message, voice }, 'Edge TTS', {
    parseResponse: async (res) => {
      const data: { audio: string; visemes: Viseme[] } = await res.json()
      const binary = atob(data.audio)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      return { audio: bytes.buffer as ArrayBuffer, visemes: data.visemes }
    },
  })
}

/** 音声を返し、口形タイムラインは talk.visemes に載せてVRMまで運ぶ */
export async function synthesizeVoiceEdgeApi(talk: Talk, voice: string) {
  const { audio, visemes } = await fetchEdgeTTS(talk.message, voice)
  talk.visemes = visemes
  return audio
}
