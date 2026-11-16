import { signal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { createPortal } from 'react-dom'
import { SketchBackgroundOpacityControl } from '@src/components/SketchBackgroundOpacityControl'
import type { ModelingInteractionViewDefinition } from '@src/lib/kcl/interactionViews'
import { DEFAULT_SKETCH_SOLVE_STREAM_DIMMING } from '@src/lib/sketchStreamDimming'
import { getThemeBackgroundColor } from '@src/lib/theme'

/** Dim engine video below the Three.js sketch canvas; neither the canvas nor pointer input is dimmed. */
export const streamedSketchPresentation: ModelingInteractionViewDefinition = {
  id: 'kcl.sketch.stream-background',
  matches: (context, session) =>
    session.id === 'kcl.sketch' &&
    context.session.resource.value?.presentation === 'streamed',
  create: (context) => {
    const scene = context.session.resource.peek()
    if (!scene || scene.presentation !== 'streamed')
      return new Error('Sketch stream presentation requires a streamed scene')
    const dimming = signal(DEFAULT_SKETCH_SOLVE_STREAM_DIMMING)
    return {
      Component: function SketchStreamPresentation() {
        useSignals()
        const theme = scene.preferences.appearance.value.theme
        return (
          <>
            {createPortal(
              <div
                aria-hidden="true"
                data-testid="sketch-stream-dimming"
                className="pointer-events-none absolute inset-0 z-[1]"
                style={{
                  backgroundColor: getThemeBackgroundColor(theme),
                  opacity: dimming.value,
                }}
              />,
              scene.element
            )}
            <div className="pointer-events-auto absolute bottom-2 left-2 z-20">
              <SketchBackgroundOpacityControl
                dimming={dimming.value}
                onDimmingChange={(value) => {
                  dimming.value = value
                }}
              />
            </div>
          </>
        )
      },
    }
  },
}
