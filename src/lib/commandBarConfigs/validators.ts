import type { Models } from '@kittycad/lib'
import type { ApiError_type } from '@kittycad/lib/dist/types/src/models'

import type { Selections } from '@src/lib/selections'
import { engineCommandManager, kclManager } from '@src/lib/singletons'
import { uuidv4 } from '@src/lib/utils'
import type { CommandBarContext } from '@src/machines/commandBarMachine'

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

export function parseEngineErrorMessage(engineError: string) {
  const parts = engineError.split('engine error: ')
  if (parts.length < 2) {
    return undefined
  }

  const errors = JSON.parse(parts[1]) as ApiError_type[]
  if (!errors[0]) {
    return undefined
  }

  return errors[0].message
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
  let edgeSelection = data.edge.graphSelections[0].artifact?.id

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

  const command = async () => {
    return await engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'revolve_about_edge',
        angle: angleInDegrees,
        edge_id: edgeSelection,
        target: sketchSelection,
        // Gotcha: Playwright will fail with larger tolerances, need to use a smaller one.
        tolerance: 1e-7,
      },
    })
  }
  const result = await dryRunWrapper(command)
  if (result?.success) {
    return true
  }

  const reason = parseEngineErrorMessage(result) || 'unknown'
  return `Unable to revolve with the current selection. Reason: ${reason}`
}

export const loftValidator = async ({
  data,
}: {
  data: { [key: string]: Selections }
  context: CommandBarContext
}): Promise<boolean | string> => {
  if (!isSelections(data.selection)) {
    return 'Unable to loft, selections are missing'
  }
  const { selection } = data

  if (selection.graphSelections.some((s) => s.artifact?.type !== 'solid2d')) {
    return 'Unable to loft, some selection are not solid2ds'
  }

  const sectionIds = data.selection.graphSelections.flatMap((s) =>
    s.artifact?.type === 'solid2d' ? s.artifact.pathId : []
  )

  if (sectionIds.length < 2) {
    return 'Unable to loft, selection contains less than two solid2ds'
  }

  const command = async () => {
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
  const result = await dryRunWrapper(command)
  if (result?.success) {
    return true
  }

  const reason = parseEngineErrorMessage(result) || 'unknown'
  return `Unable to loft with the current selection. Reason: ${reason}`
}

export const shellValidator = async ({
  data,
}: {
  data: { selection: Selections }
}): Promise<boolean | string> => {
  if (!isSelections(data.selection)) {
    return 'Unable to shell, selections are missing'
  }

  // No validation on the faces, filtering is done upstream and we have the dry run validation just below
  const face_ids = data.selection.graphSelections.flatMap((s) =>
    s.artifact ? s.artifact.id : []
  )

  // We don't have the concept of solid3ds in TS yet.
  // So we're listing out the sweeps as if they were solids and taking the first one, just like in Rust for Shell:
  // https://github.com/KittyCAD/modeling-app/blob/e61fff115b9fa94aaace6307b1842cc15d41655e/src/wasm-lib/kcl/src/std/shell.rs#L237-L238
  // TODO: This is one cheap way to make sketch-on-face supported now but will likely fail multiple solids
  const object_id = kclManager.artifactGraph
    .values()
    .find((v) => v.type === 'sweep')?.pathId

  if (!object_id) {
    return "Unable to shell, couldn't find the solid"
  }

  const command = async () => {
    // TODO: figure out something better than an arbitrarily small value
    const DEFAULT_THICKNESS: Models['LengthUnit_type'] = 1e-9
    const DEFAULT_HOLLOW = false
    const cmdArgs = {
      face_ids,
      object_id,
      hollow: DEFAULT_HOLLOW,
      shell_thickness: DEFAULT_THICKNESS,
    }
    return await engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'solid3d_shell_face',
        ...cmdArgs,
      },
    })
  }

  const result = await dryRunWrapper(command)
  if (result?.success) {
    return true
  }

  const reason = parseEngineErrorMessage(result) || 'unknown'
  return `Unable to shell with the current selection. Reason: ${reason}`
}

export const sweepValidator = async ({
  context,
  data,
}: {
  context: CommandBarContext
  data: { trajectory: Selections }
}): Promise<boolean | string> => {
  if (!isSelections(data.trajectory)) {
    console.log('Unable to sweep, selections are missing')
    return 'Unable to sweep, selections are missing'
  }

  // Retrieve the parent path from the segment selection directly
  const trajectoryArtifact = data.trajectory.graphSelections[0].artifact
  if (!trajectoryArtifact) {
    return "Unable to sweep, couldn't find the trajectory artifact"
  }
  if (trajectoryArtifact.type !== 'segment') {
    return "Unable to sweep, couldn't find the target from a non-segment selection"
  }
  const trajectory = trajectoryArtifact.pathId

  // Get the former arg in the command bar flow, and retrieve the path from the solid2d directly
  const targetArg = context.argumentsToSubmit['target'] as Selections
  const targetArtifact = targetArg.graphSelections[0].artifact
  if (!targetArtifact) {
    return "Unable to sweep, couldn't find the profile artifact"
  }
  if (targetArtifact.type !== 'solid2d') {
    return "Unable to sweep, couldn't find the target from a non-solid2d selection"
  }
  const target = targetArtifact.pathId

  const command = async () => {
    // TODO: second look on defaults here
    const DEFAULT_TOLERANCE: Models['LengthUnit_type'] = 1e-7
    const DEFAULT_SECTIONAL = false
    const cmdArgs = {
      target,
      trajectory,
      sectional: DEFAULT_SECTIONAL,
      tolerance: DEFAULT_TOLERANCE,
    }
    return await engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'sweep',
        ...cmdArgs,
      },
    })
  }

  const result = await dryRunWrapper(command)
  if (result?.success) {
    return true
  }

  const reason = parseEngineErrorMessage(result) || 'unknown'
  return `Unable to sweep with the current selection. Reason: ${reason}`
}
