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
  console.log(attemptRevolve)
  if (attemptRevolve?.success) {
    return true
  } else {
    // return error message for the toast
    return 'Unable to revolve with selected axis'
  }
}

export const shellValidator = async ({
  data,
  context,
}: {
  data: any
  context: CommandBarContext
}): Promise<boolean | string> => {
  const selection = data.selection as Selections
  console.log('shellValidator sel', selection)
  const firstArtifact = data.selection.graphSelections[0].artifact

  if (!firstArtifact) {
    return 'Unable to shell, no artifact found'
  }

  if (!('sweepId' in firstArtifact && 'id' in firstArtifact)) {
    return 'Unable to shell, first artifact has no sweepId or no id'
  }

  const objectId = firstArtifact.sweepId
  const faceId = firstArtifact.id
  const thicknessInMm: Models['LengthUnit_type'] = 0.1
  const shellCommand = async () => {
    return await engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'solid3d_shell_face',
        face_ids: [faceId],
        object_id: objectId,
        hollow: false,
        shell_thickness: thicknessInMm,
      },
    })
  }
  const attemptRevolve = await dryRunWrapper(shellCommand)
  console.log('attemptRevolve', attemptRevolve)
  if (attemptRevolve?.success) {
    return true
  } else {
    // return error message for the toast
    return 'Unable to shell with arguments'
  }
}
