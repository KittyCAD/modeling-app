import { signal } from '@preact/signals-core'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'

vi.mock('@src/components/gizmo/GizmoView', () => ({
  GizmoView: () => <div aria-label="View orientation gizmo" />,
}))

import { CameraControls } from '@src/clientSideScene/CameraControls'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { KclViewControls } from '@src/lib/kcl/modeling/KclViewControls'
import {
  createTestKclScene,
  createTestSettings,
} from '@src/lib/kcl/testFixtures'
import { createSceneSelection } from '@src/lib/scene/selection'
import type { KclSceneResource } from '@src/lib/kcl/scene/open'
import { Themes } from '@src/lib/theme'

function setup(id: string) {
  const settings = createTestSettings()
  const manager = new ConnectionManager({ settingsActor: settings.actor })
  const camera = new CameraControls(
    document.createElement('canvas'),
    manager,
    () => settings.current.peek()
  )
  const axis = vi.spyOn(camera, 'updateCameraToAxis').mockResolvedValue()
  const zoom = vi.spyOn(camera, 'zoomToFit').mockResolvedValue()
  const center = vi.spyOn(camera, 'centerOnSelection').mockResolvedValue()
  const reset = vi.fn(async () => {})
  const selection = createSceneSelection(
    {
      pick: async () => ({
        reference: { type: 'region', region_id: 'profile' },
      }),
      present: async () => {},
    },
    ['region']
  )
  selection.setModel({ sceneId: Symbol(), executionId: Symbol() })
  onTestFinished(() => {
    camera.dispose()
    selection.dispose()
  })
  const resource = createTestKclScene('streamed', {
    selection,
    viewControls: {
      id,
      sceneInfra: { camControls: camera },
      theme: signal<Themes.Light | Themes.Dark>(Themes.Light),
      gizmoType: signal<'axis' | 'cube'>('cube'),
      reset,
      toggleGizmo: () => {},
    },
  })
  return { resource, camera, axis, zoom, center, reset }
}
function View({ resource, id }: { resource: KclSceneResource; id: string }) {
  const target = useRef<HTMLDivElement>(null)
  return (
    <div ref={target} data-testid={id}>
      <KclViewControls resource={resource} target={target} />
    </div>
  )
}

it('opens the shared camera menu on a right click, but not after an orbit drag', async () => {
  const { resource, camera, axis, center } = setup('one')
  render(<View resource={resource} id="one" />)
  const viewport = screen.getByTestId('one')
  expect(await screen.findByLabelText('View orientation gizmo')).toBeVisible()
  camera.wasDragging = true
  fireEvent.mouseUp(viewport, { button: 2 })
  expect(
    screen.queryByRole('button', { name: 'Zoom to fit' })
  ).not.toBeInTheDocument()
  camera.wasDragging = false
  fireEvent.mouseUp(viewport, { button: 2 })
  expect(
    screen.getByRole('button', { name: /Center view on selection/ })
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Top view' }))
  expect(axis).toHaveBeenCalledWith('z')
  await act(async () => {
    await resource.selection.pick({ clientX: 10, clientY: 20 })
  })
  fireEvent.mouseUp(viewport, { button: 2 })
  fireEvent.click(
    screen.getByRole('button', { name: /Center view on selection/ })
  )
  expect(center).toHaveBeenCalledOnce()
})
