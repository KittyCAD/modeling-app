import { useService } from '@src/app/context'
import { settingsService } from '@src/contracts/settings'
import { AxisGizmo } from '@src/features/engineScene/AxisGizmo'
import { CubeGizmo } from '@src/features/engineScene/CubeGizmo'
import { gizmoTypeSetting } from '@src/features/engineScene/settings'

/**
 * Whichever gizmo the user asked for.
 *
 * Two implementations behind one contribution, as in the existing app, because
 * they are genuinely different tools rather than two skins: the cube says which
 * face of the model you are looking at and offers twenty-six places to stand,
 * and the axes say which way the frame runs and offer six.
 *
 * Only one is mounted. The cube costs a WebGL context, a model and four
 * textures, so rendering both and hiding one would charge everybody for the one
 * they did not choose.
 */
export function ViewGizmo() {
  const settings = useService(settingsService)

  return settings.value(gizmoTypeSetting).value === 'axis' ? (
    <AxisGizmo />
  ) : (
    <CubeGizmo />
  )
}
