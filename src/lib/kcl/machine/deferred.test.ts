import { signal } from '@preact/signals-core'
import { expect, it, vi } from 'vitest'
import { deferMachineHost } from '@src/lib/kcl/machine/deferred'
import type { MachineModelingHost } from '@src/lib/kcl/machine/host'

function host(): MachineModelingHost {
  return {
    owner: signal(undefined),
    error: signal(undefined),
    enter: vi.fn(async () => {}),
    openTool: vi.fn(async () => {}),
    closeDialog: vi.fn(),
    dispose: vi.fn(async () => {}),
  }
}

it('waits for a pending acquisition on close and disposes it without publishing or accepting commands', async () => {
  const acquired = host()
  const pending = Promise.withResolvers<MachineModelingHost>()
  const loader = vi.fn(() => pending.promise)
  const deferred = deferMachineHost(loader)
  await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce())
  const command = deferred.use((value) => value.enter('kcl.sketch.start'))
  const closing = deferred.dispose()
  expect(deferred.dispose()).toBe(closing)
  pending.resolve(acquired)
  await Promise.all([closing, command])
  expect(acquired.dispose).toHaveBeenCalledOnce()
  expect(acquired.enter).not.toHaveBeenCalled()
  expect(deferred.owner.peek()).toBeUndefined()
})

it('forwards commands and errors only while the acquired owner is live', async () => {
  const acquired = host()
  const deferred = deferMachineHost(async () => acquired)
  await deferred.use((value) => value.enter('kcl.sketch.start'))
  expect(acquired.enter).toHaveBeenCalledWith('kcl.sketch.start')
  const error = new Error('Connection closed')
  acquired.error.value = error
  expect(deferred.error.peek()).toBe(error)
  await deferred.dispose()
  acquired.error.value = new Error('Late callback')
  expect(deferred.error.peek()).toBe(error)
})
