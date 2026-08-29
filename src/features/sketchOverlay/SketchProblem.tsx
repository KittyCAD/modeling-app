import { Button } from '@kittycad/ui-kit'
import { useService } from '@src/app/context'
import { sketchSessionService } from '@src/contracts/sketchSession'
import './sketchOverlay.css'

/**
 * Why the sketch did not open, said out loud.
 *
 * This exists because of how the failure looked without it: the mode flipped
 * back to Modeling and nothing else happened. Every reason a sketch cannot be
 * opened was being recorded on the session and shown to nobody, so a bug in the
 * chain — a program that failed to execute, a sketch the frontend cannot find —
 * was indistinguishable from the mode switcher being broken.
 *
 * Mode-independent on purpose. Opening a sketch fails by *leaving* the mode, so
 * anything that lived in the sketch toolbar would be unmounted by the very event
 * it needs to report.
 */
export function SketchProblem() {
  const sessions = useService(sketchSessionService)

  const problem =
    sessions.error.value ?? sessions.open.value?.planeProblem ?? null
  if (!problem) return null

  return (
    <div class="zds-sketch-problem" role="alert">
      <p class="zds-sketch-problem__message">{problem}</p>
      <Button
        size="small"
        variant="ghost"
        icon="close"
        iconOnly
        label="Dismiss"
        onClick={() => sessions.dismissError()}
      />
    </div>
  )
}
