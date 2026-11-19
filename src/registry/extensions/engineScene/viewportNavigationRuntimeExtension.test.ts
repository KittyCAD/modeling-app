import { Registry } from 'plankton'
import { signal } from '@preact/signals-core'
import { viewportNavigationService } from '@src/registry/contracts/viewportNavigation'
import {
  registerViewportNavigation,
  viewportNavigationRuntimeSlot,
} from '@src/registry/extensions/engineScene/viewportNavigationRuntimeExtension'
import { expect, it, vi } from 'vitest'

it('ignores outgoing viewport cleanup and actions after replacement', async () => {
  const registry = new Registry()
  await registry.configure([viewportNavigationRuntimeSlot])
  const oldRecenter = vi.fn(async () => {})
  const unregisterOld = await registerViewportNavigation(registry, {
    isModelOutOfView: signal(true),
    recenter: oldRecenter,
  })
  const oldNavigation = registry.required(viewportNavigationService)
  const currentRecenter = vi.fn(async () => {})
  const currentRegistration = registerViewportNavigation(registry, {
    isModelOutOfView: signal(false),
    recenter: currentRecenter,
  })
  const outgoingCleanup = unregisterOld()
  const unregisterCurrent = await currentRegistration
  await outgoingCleanup
  const currentNavigation = registry.required(viewportNavigationService)

  expect(registry.required(viewportNavigationService)).toBe(currentNavigation)
  expect(currentNavigation.isModelOutOfView.value).toBe(false)
  await oldNavigation.recenter()
  expect(oldRecenter).not.toHaveBeenCalled()
  await currentNavigation.recenter()
  expect(currentRecenter).toHaveBeenCalledOnce()
  await unregisterCurrent()
  expect(registry.optional(viewportNavigationService)).toBeUndefined()
  await currentNavigation.recenter()
  expect(currentRecenter).toHaveBeenCalledOnce()
  await registry.dispose()
})
