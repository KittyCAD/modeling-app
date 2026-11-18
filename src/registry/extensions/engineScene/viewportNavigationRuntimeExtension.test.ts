import { Registry } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { viewportNavigationService } from '@src/registry/contracts/viewportNavigation'
import {
  registerViewportNavigation,
  viewportNavigationRuntimeSlot,
} from '@src/registry/extensions/engineScene/viewportNavigationRuntimeExtension'
import { expect, it, vi } from 'vitest'

it('ignores outgoing viewport cleanup and actions after replacement', async () => {
  const registry = new Registry()
  registry.configure([viewportNavigationRuntimeSlot.of()])
  const oldRecenter = vi.fn(async () => {})
  const unregisterOld = registerViewportNavigation(registry, {
    isModelOutOfView: signal(true),
    recenter: oldRecenter,
  })
  const oldNavigation = registry.get(viewportNavigationService)
  const currentRecenter = vi.fn(async () => {})
  const unregisterCurrent = registerViewportNavigation(registry, {
    isModelOutOfView: signal(false),
    recenter: currentRecenter,
  })
  const currentNavigation = registry.get(viewportNavigationService)

  unregisterOld()
  expect(registry.get(viewportNavigationService)).toBe(currentNavigation)
  expect(currentNavigation.isModelOutOfView.value).toBe(false)
  await oldNavigation.recenter()
  expect(oldRecenter).not.toHaveBeenCalled()
  await currentNavigation.recenter()
  expect(currentRecenter).toHaveBeenCalledOnce()
  unregisterCurrent()
  expect(registry.optional(viewportNavigationService)).toBeUndefined()
  await currentNavigation.recenter()
  expect(currentRecenter).toHaveBeenCalledOnce()
  registry[Symbol.dispose]()
})
