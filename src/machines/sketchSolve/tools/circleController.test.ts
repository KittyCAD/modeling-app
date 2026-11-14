import { expect, it, vi } from 'vitest'
import fc from 'fast-check'
import {
  createCircleController,
  type CircleControllerHost,
  type CirclePoint,
} from '@src/machines/sketchSolve/tools/circleController'
import { createSceneGraphDelta } from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const result = {
  kclSource: { text: 'circle' },
  sceneGraphDelta: createSceneGraphDelta([]),
}
const draft = { circleId: 3, segmentIds: [1, 2, 3], constraintIds: [4] }
const center: CirclePoint = { position: [10, 20] },
  radius: CirclePoint = { position: [30, 20] }
function fixture() {
  const host = {
    create: vi.fn<CircleControllerHost['create']>(async () => ({
      ...result,
      draft,
    })),
    preview: vi.fn<CircleControllerHost['preview']>(async () => result),
    commit: vi.fn<CircleControllerHost['commit']>(async () => result),
    remove: vi.fn<CircleControllerHost['remove']>(async () => result),
    outcome: vi.fn<CircleControllerHost['outcome']>(),
    feedback: vi.fn<CircleControllerHost['feedback']>(),
    onError: vi.fn<CircleControllerHost['onError']>(),
  } satisfies CircleControllerHost
  return { host, controller: createCircleController(host) }
}
it('waits for the active preview, discards queued movement, and commits the exact clicked radius', async () => {
  const { host, controller } = fixture(),
    preview = deferred<typeof result>()
  await controller.point(center)
  host.preview.mockReturnValueOnce(preview.promise)
  controller.move({ position: [20, 20] })
  await Promise.resolve()
  controller.move({ position: [25, 20] })
  const finish = controller.point(radius)
  expect(host.commit).not.toHaveBeenCalled()
  preview.resolve(result)
  await finish
  expect(host.preview).toHaveBeenCalledOnce()
  expect(host.commit).toHaveBeenCalledWith(
    expect.objectContaining({ center: [10, 20], circleId: 3 }),
    radius
  )
  expect(host.outcome.mock.calls.map((call) => call[1])).toEqual([
    'preview',
    'commit',
  ])
  expect(controller.phase.peek()).toBe('center')
  await controller.dispose()
  expect(host.remove).not.toHaveBeenCalled()
})
it('coalesces moves to the latest radius without overlapping native operations', async () => {
  const { host, controller } = fixture(),
    preview = deferred<typeof result>()
  await controller.point(center)
  host.preview.mockReturnValueOnce(preview.promise)
  controller.move({ position: [12, 20] })
  await Promise.resolve()
  controller.move({ position: [14, 20] })
  controller.move({ position: [18, 20] })
  expect(host.preview).toHaveBeenCalledOnce()
  preview.resolve(result)
  await controller.settled()
  expect(host.preview.mock.calls.map((call) => call[1].position)).toEqual([
    [12, 20],
    [18, 20],
  ])
  await controller.dispose()
})
it('waits for draft creation during disposal and removes precisely its draft entities', async () => {
  const { host, controller } = fixture(),
    creating = deferred<typeof result & { draft: typeof draft }>()
  host.create.mockReturnValueOnce(creating.promise)
  void controller.point(center)
  const closing = controller.dispose()
  expect(host.remove).not.toHaveBeenCalled()
  creating.resolve({ ...result, draft })
  await closing
  expect(host.remove).toHaveBeenCalledWith({
    center: center.position,
    ...draft,
  })
  expect(controller.phase.peek()).toBe('closed')
  await controller.dispose()
  expect(host.remove).toHaveBeenCalledOnce()
})
it('publishes a successful commit before finishing a pending unequip and never deletes that committed circle', async () => {
  const { host, controller } = fixture(),
    commit = deferred<typeof result>()
  await controller.point(center)
  host.commit.mockReturnValueOnce(commit.promise)
  void controller.point(radius)
  await Promise.resolve()
  const closing = controller.dispose()
  commit.resolve(result)
  await closing
  expect(host.outcome).toHaveBeenCalledWith(result, 'commit')
  expect(host.remove).not.toHaveBeenCalled()
})
it('recovers from native failures without losing ownership of an existing draft', async () => {
  const { host, controller } = fixture()
  host.create.mockRejectedValueOnce(new Error('create failed'))
  await controller.point(center)
  expect(controller.phase.peek()).toBe('center')
  await controller.point(center)
  host.commit.mockRejectedValueOnce(new Error('commit failed'))
  await controller.point(radius)
  expect(controller.phase.peek()).toBe('radius')
  await controller.dispose()
  expect(host.remove).toHaveBeenCalledOnce()
  expect(host.onError.mock.calls.map(([error]) => error.message)).toEqual([
    'create failed',
    'commit failed',
  ])
})
it('creates each repeated circle once and ignores further input after disposal', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 15 }), async (count) => {
      const { host, controller } = fixture()
      for (let i = 0; i < count; i++) {
        await controller.point(center)
        await controller.point(radius)
      }
      await controller.dispose()
      await controller.point(center)
      controller.move(radius)
      expect(host.create).toHaveBeenCalledTimes(count)
      expect(host.commit).toHaveBeenCalledTimes(count)
      expect(host.remove).not.toHaveBeenCalled()
    })
  )
})

it('can commit after a failed preview and reports a failed cleanup to the owner', async () => {
  const { host, controller } = fixture()
  await controller.point(center)
  host.preview.mockRejectedValueOnce(new Error('preview failed'))
  controller.move(radius)
  await controller.settled()
  await controller.point(radius)
  expect(host.commit).toHaveBeenCalledOnce()
  await controller.point(center)
  host.remove.mockRejectedValueOnce(new Error('cleanup failed'))
  await expect(controller.dispose()).rejects.toThrow('cleanup failed')
  expect(host.onError.mock.calls.map(([error]) => error.message)).toEqual([
    'preview failed',
    'cleanup failed',
  ])
})
