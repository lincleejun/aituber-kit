import { synthesizeVoiceEdgeApi } from '@/features/messages/synthesizeVoiceEdge'
import type { Talk } from '@/features/messages/messages'

describe('synthesizeVoiceEdgeApi', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns the audio and puts the visemes on the talk', async () => {
    const visemes = [
      { t: 50, id: 0 },
      { t: 100, id: 2 },
    ]
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ audio: btoa('abc'), visemes }),
    }) as jest.Mock

    const talk: Talk = { emotion: 'neutral', message: '你好' }
    const audio = await synthesizeVoiceEdgeApi(talk, 'zh-CN-XiaoxiaoNeural')

    expect(new Uint8Array(audio)).toEqual(new Uint8Array([97, 98, 99]))
    expect(talk.visemes).toEqual(visemes)
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/tts-edge',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
