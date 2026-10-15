import { VISEME_SHAPES, visemeIdAt } from '@/features/lipSync/visemes'

describe('visemeIdAt', () => {
  const visemes = [
    { t: 50, id: 0 },
    { t: 100, id: 2 },
    { t: 200, id: 6 },
    { t: 300, id: 21 },
  ]

  it('returns null before the first viseme', () => {
    expect(visemeIdAt(visemes, 0)).toBeNull()
    expect(visemeIdAt([], 100)).toBeNull()
  })

  it('returns the latest viseme at or before the time', () => {
    expect(visemeIdAt(visemes, 100)).toBe(2)
    expect(visemeIdAt(visemes, 199)).toBe(2)
    expect(visemeIdAt(visemes, 250)).toBe(6)
    expect(visemeIdAt(visemes, 9999)).toBe(21)
  })

  it('has a 5-shape fallback for every Azure viseme id', () => {
    for (let id = 0; id <= 21; id++) expect(VISEME_SHAPES[id]).toBeDefined()
  })
})
