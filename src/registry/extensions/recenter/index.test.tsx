import { Registry } from 'plankton'
import { signal } from '@preact/signals-core'
import type { RecenterHint } from '@src/registry/contracts/viewportNavigation'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  registerViewportNavigation,
  viewportNavigationRuntimeSlot,
} from '@src/registry/extensions/engineScene/viewportNavigationRuntimeExtension'

import { engineSceneViewExtensionsFacet } from '@src/registry/contracts/engineScene'
import { createElement } from 'react'
import recenterExtension from '.'

let registry: Registry

function renderControl() {
  const [view] = registry.get(engineSceneViewExtensionsFacet)
  expect(view).toMatchObject({
    id: 'engine-scene.recenter',
    zone: 'bottom-right',
    order: 19,
  })
  render(createElement(view.Component))
}

beforeEach(async () => {
  registry = new Registry()
  await registry.configure([viewportNavigationRuntimeSlot, recenterExtension])
})

afterEach(async () => {
  cleanup()
  await registry.dispose()
})

it('shows Recenter only for a lost model and delegates to the viewport service', async () => {
  renderControl()
  expect(screen.queryByRole('button', { name: 'Recenter' })).toBeNull()
  const isModelOutOfView = signal(false)
  const recoveryHint = signal<RecenterHint>({ kind: 'direction', angle: 90 })
  const recenter = vi.fn(async () => {})
  await act(async () => {
    await registerViewportNavigation(registry, {
      isModelOutOfView,
      recoveryHint,
      recenter,
    })
  })
  expect(screen.queryByRole('button', { name: 'Recenter' })).toBeNull()
  act(() => {
    isModelOutOfView.value = true
  })
  const button = await screen.findByRole('button', { name: 'Recenter' })
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

it('follows replacement services and disappears when the viewport unmounts', async () => {
  const previousVisibility = signal(true)
  await registerViewportNavigation(registry, {
    isModelOutOfView: previousVisibility,
    recenter: vi.fn(async () => {}),
  })
  renderControl()
  expect(await screen.findByRole('button', { name: 'Recenter' })).toBeVisible()
  const currentVisibility = signal(false)
  let unregisterCurrent = async () => {}
  await act(async () => {
    unregisterCurrent = await registerViewportNavigation(registry, {
      isModelOutOfView: currentVisibility,
      recenter: vi.fn(async () => {}),
    })
  })
  expect(screen.queryByRole('button', { name: 'Recenter' })).toBeNull()
  act(() => {
    currentVisibility.value = true
  })
  expect(await screen.findByRole('button', { name: 'Recenter' })).toBeVisible()
  await act(async () => {
    await unregisterCurrent()
  })
  expect(screen.queryByRole('button', { name: 'Recenter' })).toBeNull()
  await act(async () => {
    await registry.configure([viewportNavigationRuntimeSlot])
  })
  expect(registry.get(engineSceneViewExtensionsFacet)).toEqual([])
})
