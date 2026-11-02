import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PerspectiveCamera } from 'three'
import { beforeEach, expect, it, vi } from 'vitest'
import type { NamedViewCameraSnapshot } from '@src/lang/modifyAst/namedViews'

vi.mock('@src/lib/kclNamedViewCamera', () => ({
  captureNamedViewCamera: vi.fn(),
}))

import { CommandCameraInput } from '@src/components/CommandBar/CommandCameraInput'
import { captureNamedViewCamera } from '@src/lib/kclNamedViewCamera'

beforeEach(() => {
  vi.mocked(captureNamedViewCamera).mockReset()
})

it('only reads the current camera when capture is requested', async () => {
  const camera: NamedViewCameraSnapshot = {
    look: {
      type: 'directed',
      direction: { x: 0, y: 1, z: 0, units: null },
      up: { x: 0, y: 0, z: 1, units: null },
    },
    target: { x: 0, y: 0, z: 0, units: 'mm' },
    distance: 100,
    projection: 'perspective',
  }
  const controls = {
    camera: new PerspectiveCamera(),
    isPerspective: true,
    getCameraView: vi.fn(),
  }
  vi.mocked(captureNamedViewCamera).mockResolvedValue(camera)
  const onChange = vi.fn()
  const onValidationChange = vi.fn()
  const { rerender } = render(
    <CommandCameraInput
      controls={controls}
      onChange={onChange}
      onValidationChange={onValidationChange}
    />
  )
  expect(captureNamedViewCamera).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('No camera captured')

  fireEvent.click(screen.getByRole('button', { name: 'Capture camera' }))
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(camera))
  expect(captureNamedViewCamera).toHaveBeenCalledWith(controls)
  expect(onValidationChange.mock.calls).toEqual([
    [{ canSubmit: false, isChecking: true }],
    [{ canSubmit: true, isChecking: false }],
  ])

  rerender(
    <CommandCameraInput controls={controls} onChange={onChange} captured />
  )
  expect(screen.getByRole('status')).toHaveTextContent(
    'Current camera captured'
  )
})

it.each([false, true])(
  'preserves validity after failed capture (saved=%s)',
  async (saved) => {
    vi.mocked(captureNamedViewCamera).mockResolvedValue(
      new Error('Capture failed')
    )
    const onChange = vi.fn()
    const onValidationChange = vi.fn()
    render(
      <CommandCameraInput
        controls={{
          camera: new PerspectiveCamera(),
          isPerspective: true,
          getCameraView: vi.fn(),
        }}
        saved={saved}
        onChange={onChange}
        onValidationChange={onValidationChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Capture camera' }))
    await waitFor(() =>
      expect(onValidationChange).toHaveBeenLastCalledWith({
        canSubmit: saved,
        isChecking: false,
      })
    )
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(
      saved ? 'Using saved camera' : 'No camera captured'
    )
  }
)
