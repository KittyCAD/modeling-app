import { Registry } from 'plankton'
import { signal } from '@preact/signals-core'
import type { RecenterHint } from '@src/registry/contracts/viewportNavigation'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  registerViewportNavigation,
  viewportNavigationRuntimeSlot,
} from '@src/registry/extensions/engineScene/viewportNavigationRuntimeExtension'

import { viewControlMenuItemsFacet } from '@src/registry/contracts/viewControls'
import GizmoDropdown from '@src/components/gizmo/GizmoDropdown'
import { createElement } from 'react'
import recenterExtension, { RECENTER_TIP_SEEN_KEY } from '.'

let registry: Registry

vi.mock('@src/lib/boot', () => ({ useApp: () => ({ registry }) }))
vi.mock('@src/components/CustomIcon', () => ({ CustomIcon: () => null }))
vi.mock('@src/components/ViewControlMenu', () => ({
  useViewControlMenuItems: (highlightedId?: string) =>
    registry.get(viewControlMenuItemsFacet).map(({ id, Component }) =>
      createElement(Component, {
        key: id,
        disabled: false,
        highlighted: id === highlightedId,
      })
    ),
}))

function renderControl() {
  const [view] = registry.get(viewControlMenuItemsFacet)
  expect(view).toMatchObject({
    id: 'recenter',
    order: 0,
  })
  render(createElement(view.Component, { disabled: false, highlighted: false }))
}

beforeEach(async () => {
  localStorage.removeItem(RECENTER_TIP_SEEN_KEY)
  registry = new Registry()
  await registry.configure([viewportNavigationRuntimeSlot, recenterExtension])
})

afterEach(async () => {
  cleanup()
  await registry.dispose()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('keeps Recenter available and marks its help seen when used', async () => {
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
  expect(await screen.findByRole('button', { name: 'Recenter' })).toBeVisible()
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
  expect(screen.getByRole('button', { name: 'Recenter' })).toBeVisible()
  expect(localStorage.getItem(RECENTER_TIP_SEEN_KEY)).toBe('true')
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
  expect(screen.getByRole('button', { name: 'Recenter' })).toBeVisible()
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
  expect(registry.get(viewControlMenuItemsFacet)).toEqual([])
})

it('opens and highlights the menu only once, deferring while a dialog is open', async () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const lost = signal(true)
  await registerViewportNavigation(registry, {
    isModelOutOfView: lost,
    recenter: vi.fn(async () => {}),
  })
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  document.body.append(dialog)
  render(<GizmoDropdown canOfferHelp />)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(screen.queryByTestId('gizmo-view-menu')).toBeNull()
  expect(localStorage.getItem(RECENTER_TIP_SEEN_KEY)).toBeNull()
  dialog.remove()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(screen.getByTestId('gizmo-view-menu')).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent("Can't find your model?")
  expect(screen.getByRole('button', { name: 'Recenter' })).toHaveClass(
    'ring-primary'
  )
  expect(localStorage.getItem(RECENTER_TIP_SEEN_KEY)).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
  act(() => {
    lost.value = false
  })
  act(() => {
    lost.value = true
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(screen.queryByTestId('gizmo-view-menu')).toBeNull()
  cleanup()
  await registry.dispose()
  registry = new Registry()
  await registry.configure([viewportNavigationRuntimeSlot, recenterExtension])
  await registerViewportNavigation(registry, {
    isModelOutOfView: signal(true),
    recenter: vi.fn(async () => {}),
  })
  expect(registry.get(viewControlMenuItemsFacet)[0].help?.requested.value).toBe(
    false
  )
})
