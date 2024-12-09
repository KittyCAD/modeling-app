import { Models } from '@kittycad/lib'
import { engineCommandManager } from 'lib/singletons'
import { uuidv4 } from 'lib/utils'
import { CommandBarContext } from 'machines/commandBarMachine'
import { Selections } from 'lib/selections'
import { isSolid2D, isSegment, isSweep } from 'lang/std/artifactGraph'

// Takes a callback function and wraps it around enable_dry_run and disable_dry_run
export const dryRunWrapper = async (callback: () => Promise<any>) => {
  try {
    await engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: { type: 'enable_dry_run' },
    })
    // Race condition ?????
    // What if concurrent does this and our app works because of it!
    // engineCommandManager.dryRunOn()
    // engineCommandManager.dryRunOff()
    // global singleton
    const result = await callback()
    return result
  } catch (e) {
    console.error(e)
  } finally {
    try {
      await engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: { type: 'disable_dry_run' },
      })
    } catch (e) {
      console.error(e)
      console.error('disable_dry_run failed. This is bad!')
    }
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

  if (!(isSolid2D(artifact) || isSegment(artifact) || isSweep(artifact))) {
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
