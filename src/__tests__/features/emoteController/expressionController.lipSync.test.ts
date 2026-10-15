import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'
import { ExpressionController } from '@/features/emoteController/expressionController'
import { VISEME_SHAPES } from '@/features/lipSync/visemes'

const createVrm = (expressionNames: string[]) => {
  const values: Record<string, number> = {}
  const expressionManager = {
    getExpression: (name: string) =>
      expressionNames.includes(name) ? { expressionName: name } : null,
    setValue: (name: string, value: number) => {
      values[name] = value
    },
    getValue: (name: string) => values[name] ?? 0,
  }
  return { vrm: { expressionManager } as unknown as VRM, values }
}

// 十分大きいdeltaでスムージングを目標値まで収束させる
const settle = (controller: ExpressionController) => controller.update(10)

describe('ExpressionController lip sync', () => {
  it('uses the model viseme expression when the model has it', () => {
    const { vrm, values } = createVrm(['viseme_2', 'viseme_6'])
    const controller = new ExpressionController(vrm, new THREE.Object3D())

    expect(controller.modelVisemeCount).toBe(2)
    controller.lipSyncViseme(2)
    settle(controller)

    expect(values.viseme_2).toBeCloseTo(1)
    expect(values.aa).toBeCloseTo(0)
  })

  it('falls back to the 5 mouth shapes for visemes the model lacks', () => {
    const { vrm, values } = createVrm(['viseme_2'])
    const controller = new ExpressionController(vrm, new THREE.Object3D())

    controller.lipSyncViseme(7)
    settle(controller)

    expect(values.ou).toBeCloseTo(VISEME_SHAPES[7].ou ?? 0)
    expect(values.viseme_2).toBeCloseTo(0)
  })

  it('accepts zero-padded names such as viseme_05', () => {
    const { vrm, values } = createVrm(['viseme_05', 'viseme_21'])
    const controller = new ExpressionController(vrm, new THREE.Object3D())

    expect(controller.modelVisemeCount).toBe(2)
    controller.lipSyncViseme(5)
    settle(controller)

    expect(values.viseme_05).toBeCloseTo(1)
  })

  it('closes the mouth before the first viseme', () => {
    const { vrm, values } = createVrm([])
    const controller = new ExpressionController(vrm, new THREE.Object3D())

    controller.lipSyncViseme(2)
    settle(controller)
    controller.lipSyncViseme(null)
    settle(controller)

    expect(values.aa).toBeCloseTo(0)
  })
})
