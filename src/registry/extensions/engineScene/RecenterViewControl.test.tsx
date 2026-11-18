import { Registry } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { RecenterHint } from '@src/registry/contracts/viewportNavigation'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  registerViewportNavigation,
  viewportNavigationRuntimeSlot,
} from '@src/registry/extensions/engineScene/viewportNavigationRuntimeExtension'

let registry: Registry
vi.mock('@src/lib/boot', () => ({
  useApp: () => ({ registry }),
}))

import { RecenterViewControl } from '@src/registry/extensions/engineScene/RecenterViewControl'

beforeEach(() => {
  registry = new Registry()
  registry.configure([viewportNavigationRuntimeSlot.of()])
})

afterEach(() => {
  cleanup()
  registry[Symbol.dispose]()
})

it('shows Recenter only for a lost model and delegates to the viewport service', () => {
  render(<RecenterViewControl />)
  expect(screen.queryByRole('button', { name: 'Recenter' })).toBeNull()
  const isModelOutOfView = signal(false)
  const recoveryHint = signal<RecenterHint>({ kind: 'direction', angle: 90 })
  const recenter = vi.fn(async () => {})
  act(() => {
    registerViewportNavigation(registry, {
      isModelOutOfView,
      recoveryHint,
      recenter,
    })
  })
  expect(screen.queryByRole('button', { name: 'Recenter' })).toBeNull()
  act(() => {
    isModelOutOfView.value = true
  })
  const button = screen.getByRole('button', { name: 'Recenter' })
  expect(button).toHaveAttribute('title', 'Model is offscreen')
  act(() => {
    recoveryHint.value = { kind: 'zoom-out' }
  })
  expect(button).toHaveAttribute('title', 'Zoom out to find the model')
  fireEvent.click(button)
  expect(recenter).toHaveBeenCalledOnce()
  act(() => {
    isModelOutOfView.value = false
  })
  expect(screen.queryByRole('button', { name: 'Recenter' })).toBeNull()
})

it('follows replacement services and disappears when the viewport unmounts', () => {
  const previousVisibility = signal(true)
  registerViewportNavigation(registry, {
    isModelOutOfView: previousVisibility,
    recenter: vi.fn(async () => {}),
  })
  render(<RecenterViewControl />)
  expect(screen.getByRole('button', { name: 'Recenter' })).toBeVisible()
  const currentVisibility = signal(false)
  let unregisterCurrent = () => {}
  act(() => {
    unregisterCurrent = registerViewportNavigation(registry, {
      isModelOutOfView: currentVisibility,
      recenter: vi.fn(async () => {}),
    })
  })
  expect(screen.queryByRole('button', { name: 'Recenter' })).toBeNull()
  act(() => {
    currentVisibility.value = true
  })
  expect(screen.getByRole('button', { name: 'Recenter' })).toBeVisible()
  act(() => {
    unregisterCurrent()
  })
  expect(screen.queryByRole('button', { name: 'Recenter' })).toBeNull()
})
