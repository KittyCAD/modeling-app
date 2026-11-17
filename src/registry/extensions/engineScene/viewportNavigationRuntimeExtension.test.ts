import { Registry } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { viewportNavigationService } from '@src/registry/contracts/viewportNavigation'
import {
  registerViewportNavigation,
  viewportNavigationRuntimeSlot,
} from '@src/registry/extensions/engineScene/viewportNavigationRuntimeExtension'
import { expect, it, vi } from 'vitest'

it('unregisters navigation when the viewport is unmounted', async () => {
  const registry = new Registry()
  registry.configure([viewportNavigationRuntimeSlot.of()])
  const isModelOutOfView = signal(false)
  const recenter = vi.fn(async () => {})
  const unregister = registerViewportNavigation(registry, {
    isModelOutOfView,
    recenter,
  })
  const navigation = registry.get(viewportNavigationService)

  expect(navigation.isModelOutOfView.value).toBe(false)
  isModelOutOfView.value = true
  expect(navigation.isModelOutOfView.value).toBe(true)
  await navigation.recenter()
  expect(recenter).toHaveBeenCalledOnce()

  unregister()
  expect(registry.optional(viewportNavigationService)).toBeUndefined()
  await navigation.recenter()
  expect(recenter).toHaveBeenCalledOnce()
  registry[Symbol.dispose]()
})

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
  registry[Symbol.dispose]()
})
