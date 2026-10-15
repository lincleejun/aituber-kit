import { logger } from '@/lib/logger'
import type { NextApiRequest, NextApiResponse } from 'next'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { withAccessPolicy } from '@/lib/accessPolicy/withAccessPolicy'
import { routePolicies } from '@/lib/accessPolicy/routePolicies'
import type { Viseme } from '@/features/lipSync/visemes'

const VOICE_NAME_PATTERN = /^[a-z]{2,3}-[A-Za-z]{2,4}(-[A-Za-z]+)*Neural$/
// Edgeのメタデータ時刻は100ナノ秒単位
const TICKS_PER_MS = 10000

type EdgeMetadata = {
  Metadata?: {
    Type: string
    Data: { Offset: number; VisemeId?: number }
  }[]
}

/**
 * msedge-tts 2.1.0 は viseme を有効にするオプションを持たないため、
 * speech.config 送信時に visemeEnabled を差し込む。
 * ponytail: ライブラリ内部の _send に依存。msedge-tts を更新したら動作を再確認する
 */
function enableVisemes(tts: MsEdgeTTS) {
  const internal = tts as unknown as {
    _send: (message: string, ...rest: unknown[]) => Promise<unknown>
  }
  const send = internal._send.bind(tts)
  internal._send = (message, ...rest) =>
    send(
      message.replace(
        '"wordBoundaryEnabled"',
        '"visemeEnabled": "true", "wordBoundaryEnabled"'
      ),
      ...rest
    )
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { message, voice } = req.body

  if (
    !message ||
    typeof voice !== 'string' ||
    !VOICE_NAME_PATTERN.test(voice)
  ) {
    return res.status(400).json({ error: 'Missing or invalid parameters' })
  }

  // ponytail: リクエストごとにWebSocket接続を張る。遅延が問題ならインスタンスを再利用する
  const tts = new MsEdgeTTS()
  enableVisemes(tts)
  try {
    // metadataStream は wordBoundary か sentenceBoundary が有効なときだけ作られる
    await tts.setMetadata(
      voice,
      OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
      { wordBoundaryEnabled: true }
    )
    const { audioStream, metadataStream } = tts.toStream(message)

    const visemes: Viseme[] = []
    metadataStream?.on('data', (chunk: Buffer) => {
      try {
        const parsed = JSON.parse(chunk.toString()) as EdgeMetadata
        for (const item of parsed.Metadata ?? []) {
          if (item.Type === 'Viseme' && item.Data.VisemeId !== undefined) {
            visemes.push({
              t: item.Data.Offset / TICKS_PER_MS,
              id: item.Data.VisemeId,
            })
          }
        }
      } catch (e) {
        logger.warn('Failed to parse Edge TTS metadata:', e)
      }
    })

    const chunks: Buffer[] = []
    for await (const chunk of audioStream) {
      chunks.push(chunk as Buffer)
    }

    visemes.sort((a, b) => a.t - b.t)
    res.status(200).json({
      audio: Buffer.concat(chunks).toString('base64'),
      visemes,
    })
  } catch (error) {
    logger.error('Error in Edge TTS:', error)
    res.status(500).json({ error: 'Failed to generate speech' })
  } finally {
    tts.close()
  }
}

export default withAccessPolicy(routePolicies['/api/tts-edge'], handler)
