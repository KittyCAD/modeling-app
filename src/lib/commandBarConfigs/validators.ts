import { Models } from '@kittycad/lib'
import { engineCommandManager } from 'lib/singletons'
import { uuidv4 } from 'lib/utils'
import { CommandBarContext } from 'machines/commandBarMachine'
import { Selections } from 'lib/selections'

export const disableDryRunWithRetry = async (numberOfRetries = 3) => {
  for (let tries = 0; tries < numberOfRetries; tries++) {
    try {
      await engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: { type: 'disable_dry_run' },
      })
      // Exit out since the command was successful
      return
    } catch (e) {
      console.error(e)
      console.error('disable_dry_run failed. This is bad!')
    }
  }
}

// Takes a callback function and wraps it around enable_dry_run and disable_dry_run
export const dryRunWrapper = async (callback: () => Promise<any>) => {
  // Gotcha: What about race conditions?
  try {
    await engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: { type: 'enable_dry_run' },
    })
    const result = await callback()
    return result
  } catch (e) {
    console.error(e)
  } finally {
    await disableDryRunWithRetry(5)
  }
}

function isSelections(selections: unknown): selections is Selections {
  return (
    (selections as Selections).graphSelections !== undefined &&
    (selections as Selections).otherSelections !== undefined
  )
}

export const revolveAxisValidator = async ({
  data,
  context,
}: {
  data: { [key: string]: Selections }
  context: CommandBarContext
}): Promise<boolean | string> => {
  if (!isSelections(context.argumentsToSubmit.selection)) {
    return 'Unable to revolve, selections are missing'
  }
  const artifact =
    context.argumentsToSubmit.selection.graphSelections[0].artifact

  if (!artifact) {
    return 'Unable to revolve, sketch not found'
  }

  if (!('pathId' in artifact)) {
    return 'Unable to revolve, sketch has no path'
  }

  const sketchSelection = artifact.pathId
  let edgeSelection = data.axis.graphSelections[0].artifact?.id

  if (!sketchSelection) {
    return 'Unable to revolve, sketch is missing'
  }

  if (!edgeSelection) {
    return 'Unable to revolve, edge is missing'
  }

  const angleInDegrees: Models['Angle_type'] = {
    unit: 'degrees',
    value: 360,
  }

  const revolveAboutEdgeCommand = async () => {
    return await engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'revolve_about_edge',
        angle: angleInDegrees,
        edge_id: edgeSelection,
        target: sketchSelection,
        tolerance: 0.0001,
      },
    })
  }
  const attemptRevolve = await dryRunWrapper(revolveAboutEdgeCommand)
  if (attemptRevolve?.success) {
    return true
  } else {
    // return error message for the toast
    return 'Unable to revolve with selected axis'
  }
}

export const loftValidator = async ({
  data,
}: {
  data: { [key: string]: Selections }
  context: CommandBarContext
}): Promise<boolean | string> => {
  if (!isSelections(data.selection)) {
    return 'Unable to revolve, selections are missing'
  }

  // TODO: should this be part of canLoftSelection? And should we use that here?
  const sectionIds = data.selection.graphSelections.flatMap((s) =>
    s.artifact?.type === 'solid2D' ? s.artifact.pathId : []
  )

  if (sectionIds.length < 2) {
    return 'Unable to loft, selection contains less than two sections'
  }

  const loftCommand = async () => {
    // TODO: check what to do with these
    const DEFAULT_V_DEGREE = 2
    const DEFAULT_TOLERANCE = 2
    const DEFAULT_BEZ_APPROXIMATE_RATIONAL = false
    return await engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        section_ids: sectionIds,
        type: 'loft',
        bez_approximate_rational: DEFAULT_BEZ_APPROXIMATE_RATIONAL,
        tolerance: DEFAULT_TOLERANCE,
        v_degree: DEFAULT_V_DEGREE,
      },
    })
  }
  const attempt = await dryRunWrapper(loftCommand)
  if (attempt?.success) {
    return true
  } else {
    // return error message for the toast
    return 'Unable to loft with selected sketches'
  }
}

export const shellValidator = async ({
  data,
  context,
}: {
  data: any
  context: CommandBarContext
}): Promise<boolean | string> => {
  if (!isSelections(data.selection)) {
    return 'Unable to revolve, selections are missing'
  }
  const selection = data.selection as Selections
  const firstArtifact = selection.graphSelections[0].artifact

  if (!firstArtifact) {
    return 'Unable to shell, no artifact found'
  }

  if (!(firstArtifact.type === 'cap' || firstArtifact.type === 'wall')) {
    return 'Unable to shell, first artifact is not a cap or a wall'
  }

  console.log('selection artifact', firstArtifact)

  // TODO: NOT WORKING YET. I BELIEVE SWEEP_ID IS THE WRONG THING TO PROVIDE TO ENGINE HERE
  const objectId = firstArtifact.sweepId
  const faceId = firstArtifact.id

  const hasOtherObjectIds = selection.graphSelections.some(
    (s) =>
      (s.artifact?.type === 'cap' || s.artifact?.type === 'wall') &&
      s.artifact.sweepId !== objectId
  )
  if (hasOtherObjectIds) {
    return 'Unable to shell, selection is across solids'
  }

  const shellCommand = async () => {
    const DEFAULT_THICKNESS: Models['LengthUnit_type'] = 0.1
    const DEFAULT_HOLLOW = false
    const cmd = {
      type: 'solid3d_shell_face',
      face_ids: [faceId],
      object_id: objectId,
      hollow: DEFAULT_HOLLOW,
      shell_thickness: DEFAULT_THICKNESS,
    }
    console.log('cmd', cmd)
    return await engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd,
    })
  }
  const attemptRevolve = await dryRunWrapper(shellCommand)
  if (attemptRevolve?.success) {
    return true
  } else {
    // return error message for the toast
    return 'Unable to shell with arguments'
  }
}
