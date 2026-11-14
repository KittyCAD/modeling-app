import { expect, it, vi } from 'vitest'
import { createCircleSceneInteraction } from '@src/machines/sketchSolve/tools/circleInteraction'
import {
  createMockSceneInfra,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
it('releases its input callbacks once so repeated teardown cannot detach the next tool', async () => {
  const infra = createMockSceneInfra()
  infra.resetMouseListeners = vi.fn()
  const canvas = document.createElement('canvas')
  canvas.style.cursor = 'pointer'
  Object.assign(infra, { renderer: { domElement: canvas } })
  const result = {
    kclSource: { text: '' },
    sceneGraphDelta: createSceneGraphDelta([]),
  }
  const circle = createCircleSceneInteraction({
    infra,
    isCurrent: () => true,
    pick: () => null,
    hover: () => {},
    onError: (error) => {
      throw error
    },
    create: async () => ({
      ...result,
      draft: { circleId: 3, segmentIds: [1, 2, 3], constraintIds: [] },
    }),
    preview: async () => result,
    commit: async () => result,
    remove: async () => result,
    outcome: () => {},
  })
  expect(canvas.style.cursor).toBe('crosshair')
  await circle.point({ position: [10, 20] })
  expect(canvas.style.cursor).toBe('crosshair')
  await circle.point({ position: [20, 20] })
  expect(canvas.style.cursor).toBe('crosshair')
  await circle.dispose()
  expect(canvas.style.cursor).toBe('pointer')
  infra.setCallbacks({ onClick: () => {} })
  await circle.dispose()
  expect(infra.resetMouseListeners).toHaveBeenCalledOnce()
})
