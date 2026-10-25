import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PerspectiveCamera } from 'three'
import { expect, it, vi } from 'vitest'
import type { NamedViewCameraSnapshot } from '@src/lang/modifyAst/namedViews'

vi.mock('@src/lib/kclNamedViewCamera', () => ({
  captureNamedViewCamera: vi.fn(),
}))

import { CommandCameraInput } from '@src/components/CommandBar/CommandCameraInput'
import { captureNamedViewCamera } from '@src/lib/kclNamedViewCamera'

it('only reads the current camera when capture is requested', async () => {
  const camera: NamedViewCameraSnapshot = {
    direction: [0, 1, 0],
    up: [0, 0, 1],
    target: [0, 0, 0],
    distance: 100,
    projection: 'Perspective',
  }
  const controls = {
    camera: new PerspectiveCamera(),
    isPerspective: true,
    getCameraView: vi.fn(),
  }
  vi.mocked(captureNamedViewCamera).mockResolvedValue(camera)
  const onCapture = vi.fn()
  const onValidationChange = vi.fn()
  const { rerender } = render(
    <CommandCameraInput
      controls={controls}
      saved
      onCapture={onCapture}
      onValidationChange={onValidationChange}
    />
  )
  expect(captureNamedViewCamera).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('Using saved camera')

  fireEvent.click(screen.getByRole('button', { name: 'Capture camera' }))
  await waitFor(() => expect(onCapture).toHaveBeenCalledWith(camera))
  expect(captureNamedViewCamera).toHaveBeenCalledWith(controls)
  expect(onValidationChange.mock.calls).toEqual([[false], [true]])

  rerender(
    <CommandCameraInput controls={controls} onCapture={onCapture} captured />
  )
  expect(screen.getByRole('status')).toHaveTextContent(
    'Current camera captured'
  )
})
