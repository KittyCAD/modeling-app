import { expect, it, vi } from 'vitest'
import { signal } from '@preact/signals-core'
import {
  createModelingInteractions,
  type ModelingInteractionSession,
} from '@src/lib/kcl/interactions'
import { modelingTestContext } from '@src/lib/kcl/testContext'
function session(): ModelingInteractionSession {
  return {
    id: 'test',
    toolbar: signal([]),
    prompt: signal('Pick a plane'),
    error: signal(undefined),
    defaultPlanes: signal({ xy: true, xz: true, yz: true }),
    escape: async () => {},
    dispose: vi.fn(async () => {}),
  }
}
it('disposes a late interaction after the view has closed', async () => {
  const view = modelingTestContext()
  const pending = Promise.withResolvers<ModelingInteractionSession>()
  const create = vi.fn(async () => pending.promise)
  const host = createModelingInteractions(
    () => view.context,
    signal([
      {
        id: 'test',
        entries: [
          { id: 'enter', name: 'Enter', icon: 'sketch', createSession: create },
        ],
      },
    ])
  )
  const entering = host.enter('enter')
  await vi.waitFor(() => expect(create).toHaveBeenCalled())
  host.dispose()
  const late = session()
  pending.resolve(late)
  await entering
  expect(late.dispose).toHaveBeenCalledOnce()
  expect(host.active.peek()).toBeUndefined()
  view.dispose()
})
it('waits for the previous interaction to release input before entering another', async () => {
  const view = modelingTestContext()
  const released = Promise.withResolvers<undefined>()
  const first = session()
  first.dispose = vi.fn(() => released.promise)
  const second = session()
  const createSecond = vi.fn(async () => second)
  const host = createModelingInteractions(
    () => view.context,
    signal([
      {
        id: 'test',
        entries: [
          {
            id: 'first',
            name: 'First',
            icon: 'sketch',
            createSession: async () => first,
          },
          {
            id: 'second',
            name: 'Second',
            icon: 'sketch',
            createSession: createSecond,
          },
        ],
      },
    ])
  )
  await host.enter('first')
  const entering = host.enter('second')
  expect(createSecond).not.toHaveBeenCalled()
  released.resolve(undefined)
  await entering
  expect(host.active.peek()).toBe(second)
  await host.close()
  view.dispose()
})
