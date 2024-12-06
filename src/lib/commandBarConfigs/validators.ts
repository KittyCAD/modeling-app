import { Models } from '@kittycad/lib'
import { engineCommandManager } from 'lib/singletons'
import { uuidv4 } from 'lib/utils'
import { CommandBarContext } from 'machines/commandBarMachine'

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

export const revolveAxisValidator = async ({
  data,
  context,
}: {
  data: any
  context: CommandBarContext
}): Promise<boolean | string> => {
  const sketchSelection =
    context.argumentsToSubmit.selection.graphSelections[0].artifact.pathId
  let edgeSelection = data.axis.graphSelections[0].artifact.id

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
