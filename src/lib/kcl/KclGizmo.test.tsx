import { signal } from '@preact/signals-core'
import type { GizmoProps } from '@src/components/gizmo/Gizmo'
import type { KclCamera } from '@src/lib/kcl/camera'
import { createSettings } from '@src/lib/settings/initialSettings'
import { Themes } from '@src/lib/theme'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Quaternion } from 'three'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@src/components/gizmo/Gizmo', () => ({
  default: ({ menuItems, gizmoType, theme }: GizmoProps) => (
    <div aria-label={`${theme} ${gizmoType} gizmo`}>{menuItems}</div>
  ),
}))
import KclGizmo from '@src/lib/kcl/KclGizmo'

afterEach(cleanup)
it('uses the hosting camera for view actions and the settings service for gizmo preferences', async () => {
  const orientTo = vi.fn(async () => {})
  const otherOrientTo = vi.fn(async () => {})
  const camera: KclCamera = {
    id: crypto.randomUUID(),
    state: signal<KclCamera['state']['value']>({ type: 'loading' }),
    getOrientation: () => new Quaternion(),
    subscribeOrientation: () => () => {},
    orientTo,
    beginOrbit: vi.fn(),
    orbitBy: vi.fn(),
    endOrbit: vi.fn(),
    dispose: vi.fn(),
  }
  const session = { camera: signal<KclCamera | undefined>(camera) }
  const values = createSettings()
  values.modeling.gizmoType.user = 'cube'
  const settings = { current: signal(values), send: vi.fn() }
  render(<KclGizmo session={session} settings={settings} theme={Themes.Dark} />)
  expect(screen.queryByLabelText('dark cube gizmo')).not.toBeInTheDocument()
  await act(async () => {
    camera.state.value = { type: 'ready' }
  })
  expect(screen.getByLabelText('dark cube gizmo')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Top view' }))
  expect(orientTo).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Use axis gizmo' }))
  expect(settings.send).toHaveBeenCalledWith({
    type: 'set.modeling.gizmoType',
    data: { level: 'user', value: 'axis' },
  })
  const other: KclCamera = {
    ...camera,
    id: crypto.randomUUID(),
    orientTo: otherOrientTo,
    state: signal<KclCamera['state']['value']>({ type: 'ready' }),
  }
  await act(async () => {
    session.camera.value = other
  })
  fireEvent.click(screen.getByRole('button', { name: 'Front view' }))
  expect(otherOrientTo).toHaveBeenCalledTimes(1)
  expect(orientTo).toHaveBeenCalledTimes(1)
  await act(async () => {
    other.state.value = {
      type: 'error',
      error: new Error('Camera disconnected'),
    }
  })
  expect(screen.getByRole('alert')).toHaveTextContent('Camera disconnected')
})
