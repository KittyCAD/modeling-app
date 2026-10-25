import { useState } from 'react'

import { ActionButton } from '@src/components/ActionButton'
import type { NamedViewCameraSnapshot } from '@src/lang/modifyAst/namedViews'
import { captureNamedViewCamera } from '@src/lib/kclNamedViewCamera'
import { trap } from '@src/lib/trap'

export function CommandCameraInput({
  id,
  controls,
  captured = false,
  saved = false,
  onCapture,
  onValidationChange,
}: {
  id?: string
  controls: Parameters<typeof captureNamedViewCamera>[0]
  captured?: boolean
  saved?: boolean
  onCapture: (camera: NamedViewCameraSnapshot) => void
  onValidationChange?: (canSubmit: boolean) => void
}) {
  const [capturing, setCapturing] = useState(false)

  async function capture() {
    setCapturing(true)
    onValidationChange?.(false)
    try {
      const camera = await captureNamedViewCamera(controls)
      if (!trap(camera)) onCapture(camera)
    } catch (error) {
      trap(error)
    } finally {
      setCapturing(false)
      onValidationChange?.(true)
    }
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className="text-chalkboard-70 dark:text-chalkboard-40"
        role="status"
      >
        {captured
          ? 'Current camera captured'
          : saved
            ? 'Using saved camera'
            : 'No camera captured'}
      </span>
      <ActionButton
        Element="button"
        id={id}
        type="button"
        aria-label="Capture camera"
        tabIndex={0}
        disabled={capturing}
        iconStart={{ icon: 'camera' }}
        onClick={() => void capture()}
      >
        {capturing ? 'Capturing...' : 'Capture camera'}
      </ActionButton>
    </div>
  )
}
