import { CustomIconName } from 'components/CustomIcon'
import { Artifact, getArtifactOfTypes } from 'lang/std/artifactGraph'
import { Operation } from '@rust/kcl-lib/bindings/Operation'
import { codeManager, engineCommandManager, kclManager } from './singletons'
import { err } from './trap'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import { sourceRangeFromRust } from 'lang/wasm'
import { CommandBarMachineEvent } from 'machines/commandBarMachine'
import { stringToKclExpression } from './kclHelpers'
import { ModelingCommandSchema } from './commandBarConfigs/modelingCommandConfig'
import { isDefaultPlaneStr } from './planes'
import { Selection, Selections } from './selections'

type ExecuteCommandEvent = CommandBarMachineEvent & {
  type: 'Find and select command'
}
type ExecuteCommandEventPayload = ExecuteCommandEvent['data']
type PrepareToEditFailurePayload = { reason: string }
type PrepareToEditCallback = (
  props: Omit<EnterEditFlowProps, 'commandBarSend'>
) =>
  | ExecuteCommandEventPayload
  | Promise<ExecuteCommandEventPayload | PrepareToEditFailurePayload>

interface StdLibCallInfo {
  label: string
  icon: CustomIconName
  /**
   * There are operations which are honored by the feature tree
   * that do not yet have a corresponding modeling command.
   */
  prepareToEdit?:
    | ExecuteCommandEventPayload
    | PrepareToEditCallback
    | PrepareToEditFailurePayload
  supportsAppearance?: boolean
}

/**
 * Gather up the argument values for the Extrude command
 * to be used in the command bar edit flow.
 */
const prepareToEditExtrude: PrepareToEditCallback =
  async function prepareToEditExtrude({ operation, artifact }) {
    const baseCommand = {
      name: 'Extrude',
      groupId: 'modeling',
    }
    if (
      !artifact ||
      !('pathId' in artifact) ||
      operation.type !== 'StdLibCall'
    ) {
      return baseCommand
    }

    // We have to go a little roundabout to get from the original artifact
    // to the solid2DId that we need to pass to the Extrude command.
    const pathArtifact = getArtifactOfTypes(
      {
        key: artifact.pathId,
        types: ['path'],
      },
      engineCommandManager.artifactGraph
    )
    if (
      err(pathArtifact) ||
      pathArtifact.type !== 'path' ||
      !pathArtifact.solid2dId
    )
      return baseCommand
    const solid2DArtifact = getArtifactOfTypes(
      {
        key: pathArtifact.solid2dId,
        types: ['solid2d'],
      },
      engineCommandManager.artifactGraph
    )
    if (err(solid2DArtifact) || solid2DArtifact.type !== 'solid2d') {
      return baseCommand
    }

    // Convert the length argument from a string to a KCL expression
    const distanceResult = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs?.['length']?.sourceRange[0],
        operation.labeledArgs?.['length']?.sourceRange[1]
      )
    )
    if (err(distanceResult) || 'errors' in distanceResult) {
      return baseCommand
    }

    // Assemble the default argument values for the Extrude command,
    // with `nodeToEdit` set, which will let the Extrude actor know
    // to edit the node that corresponds to the StdLibCall.
    const argDefaultValues: ModelingCommandSchema['Extrude'] = {
      selection: {
        graphSelections: [
          {
            artifact: solid2DArtifact,
            codeRef: pathArtifact.codeRef,
          },
        ],
        otherSelections: [],
      },
      distance: distanceResult,
      nodeToEdit: getNodePathFromSourceRange(
        kclManager.ast,
        sourceRangeFromRust(operation.sourceRange)
      ),
    }
    return {
      ...baseCommand,
      argDefaultValues,
    }
  }

/**
 * Gather up the argument values for the Shell command
 * to be used in the command bar edit flow.
 */
const prepareToEditShell: PrepareToEditCallback =
  async function prepareToEditShell({ operation }) {
    const baseCommand = {
      name: 'Shell',
      groupId: 'modeling',
    }

    if (
      operation.type !== 'StdLibCall' ||
      !operation.labeledArgs ||
      !operation.unlabeledArg ||
      operation.unlabeledArg.value.type !== 'Solid' ||
      !('thickness' in operation.labeledArgs) ||
      !('faces' in operation.labeledArgs) ||
      !operation.labeledArgs.thickness ||
      !operation.labeledArgs.faces ||
      operation.labeledArgs.faces.value.type !== 'Array'
    ) {
      return baseCommand
    }

    // Build an artifact map here of eligible artifacts corresponding to our current sweep
    // that we can query in another loop later
    const sweepId = operation.unlabeledArg.value.value.artifactId
    const candidates: { [key: string]: Selection } = {}
    for (const artifact of engineCommandManager.artifactGraph.values()) {
      if (
        artifact.type === 'cap' &&
        artifact.sweepId === sweepId &&
        artifact.subType
      ) {
        const codeRef = getCapCodeRef(
          artifact,
          engineCommandManager.artifactGraph
        )
        if (err(codeRef)) {
          return baseCommand
        }
        candidates[artifact.subType] = {
          artifact,
          codeRef,
        }
      } else if (
        artifact.type === 'wall' &&
        artifact.sweepId === sweepId &&
        artifact.type
      ) {
        const segArtifact = getArtifactOfTypes(
          { key: artifact.segId, types: ['segment'] },
          engineCommandManager.artifactGraph
        )
        if (err(segArtifact)) {
          return baseCommand
        }
        const { codeRef } = segArtifact
        candidates[artifact.segId] = {
          artifact,
          codeRef,
        }
      }
    }

    // Loop over face value to retrieve the corresponding artifacts and build the graphSelections
    const faceValues = operation.labeledArgs.faces.value.value
    const graphSelections: Selection[] = []
    for (const v of faceValues) {
      if (v.type === 'String' && v.value && candidates[v.value]) {
        graphSelections.push(candidates[v.value])
      } else if (
        v.type === 'TagIdentifier' &&
        v.artifact_id &&
        candidates[v.artifact_id]
      ) {
        graphSelections.push(candidates[v.artifact_id])
      } else {
        return baseCommand
      }
    }

    // Convert the thickness argument from a string to a KCL expression
    const thickness = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs?.['thickness']?.sourceRange[0],
        operation.labeledArgs?.['thickness']?.sourceRange[1]
      ),
      {}
    )

    if (err(thickness) || 'errors' in thickness) {
      return baseCommand
    }

    // Assemble the default argument values for the Shell command,
    // with `nodeToEdit` set, which will let the Extrude actor know
    // to edit the node that corresponds to the StdLibCall.
    const argDefaultValues: ModelingCommandSchema['Shell'] = {
      thickness,
      selection: {
        graphSelections,
        otherSelections: [],
      },
      nodeToEdit: getNodePathFromSourceRange(
        kclManager.ast,
        sourceRangeFromRust(operation.sourceRange)
      ),
    }
    return {
      ...baseCommand,
      argDefaultValues,
    }
  }

const prepareToEditOffsetPlane: PrepareToEditCallback = async ({
  operation,
}) => {
  const baseCommand = {
    name: 'Offset plane',
    groupId: 'modeling',
  }
  if (
    operation.type !== 'StdLibCall' ||
    !operation.labeledArgs ||
    !operation.unlabeledArg ||
    !('offset' in operation.labeledArgs) ||
    !operation.labeledArgs.offset
  ) {
    return baseCommand
  }
  // TODO: Implement conversion to arbitrary plane selection
  // once the Offset Plane command supports it.
  const stdPlane = operation.unlabeledArg
  const planeName = codeManager.code
    .slice(stdPlane.sourceRange[0], stdPlane.sourceRange[1])
    .replaceAll(`'`, ``)

  if (!isDefaultPlaneStr(planeName)) {
    // TODO: error handling
    return baseCommand
  }
  const planeId = engineCommandManager.getDefaultPlaneId(planeName)
  if (err(planeId)) {
    // TODO: error handling
    return baseCommand
  }

  const plane: Selections = {
    graphSelections: [],
    otherSelections: [
      {
        name: planeName,
        id: planeId,
      },
    ],
  }

  // Convert the distance argument from a string to a KCL expression
  const distanceResult = await stringToKclExpression(
    codeManager.code.slice(
      operation.labeledArgs.offset.sourceRange[0],
      operation.labeledArgs.offset.sourceRange[1]
    )
  )

  if (err(distanceResult) || 'errors' in distanceResult) {
    return baseCommand
  }

  // Assemble the default argument values for the Offset Plane command,
  // with `nodeToEdit` set, which will let the Offset Plane actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Offset plane'] = {
    distance: distanceResult,
    plane,
    nodeToEdit: getNodePathFromSourceRange(
      kclManager.ast,
      sourceRangeFromRust(operation.sourceRange)
    ),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditHelix: PrepareToEditCallback = async ({ operation }) => {
  const baseCommand = {
    name: 'Helix',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall' || !operation.labeledArgs) {
    return baseCommand
  }

  // TODO: find a way to loop over the arguments while keeping it safe
  // revolutions kcl arg
  if (
    !('revolutions' in operation.labeledArgs) ||
    !operation.labeledArgs.revolutions
  )
    return baseCommand
  const revolutions = await stringToKclExpression(
    codeManager.code.slice(
      operation.labeledArgs.revolutions.sourceRange[0],
      operation.labeledArgs.revolutions.sourceRange[1]
    )
  )
  if (err(revolutions) || 'errors' in revolutions) return baseCommand

  // angleStart kcl arg
  if (
    !('angleStart' in operation.labeledArgs) ||
    !operation.labeledArgs.angleStart
  )
    return baseCommand
  const angleStart = await stringToKclExpression(
    codeManager.code.slice(
      operation.labeledArgs.angleStart.sourceRange[0],
      operation.labeledArgs.angleStart.sourceRange[1]
    )
  )
  if (err(angleStart) || 'errors' in angleStart) return baseCommand

  // counterClockWise options boolean arg
  if (
    !('counterClockWise' in operation.labeledArgs) ||
    !operation.labeledArgs.counterClockWise
  )
    return baseCommand
  const counterClockWise =
    codeManager.code.slice(
      operation.labeledArgs.counterClockWise.sourceRange[0],
      operation.labeledArgs.counterClockWise.sourceRange[1]
    ) === 'true'

  // radius kcl arg
  if (!('radius' in operation.labeledArgs) || !operation.labeledArgs.radius)
    return baseCommand
  const radius = await stringToKclExpression(
    codeManager.code.slice(
      operation.labeledArgs.radius.sourceRange[0],
      operation.labeledArgs.radius.sourceRange[1]
    )
  )
  if (err(radius) || 'errors' in radius) return baseCommand

  // axis options string arg
  if (!('axis' in operation.labeledArgs) || !operation.labeledArgs.axis)
    return baseCommand
  const axis = codeManager.code
    .slice(
      operation.labeledArgs.axis.sourceRange[0],
      operation.labeledArgs.axis.sourceRange[1]
    )
    .replaceAll("'", '') // TODO: fix this crap

  // length kcl arg
  if (!('length' in operation.labeledArgs) || !operation.labeledArgs.length)
    return baseCommand
  const length = await stringToKclExpression(
    codeManager.code.slice(
      operation.labeledArgs.length.sourceRange[0],
      operation.labeledArgs.length.sourceRange[1]
    )
  )
  if (err(length) || 'errors' in length) return baseCommand

  // Assemble the default argument values for the Offset Plane command,
  // with `nodeToEdit` set, which will let the Offset Plane actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Helix'] = {
    revolutions,
    angleStart,
    counterClockWise,
    radius,
    axis,
    length,
    nodeToEdit: getNodePathFromSourceRange(
      kclManager.ast,
      sourceRangeFromRust(operation.sourceRange)
    ),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

/**
 * A map of standard library calls to their corresponding information
 * for use in the feature tree UI.
 */
export const stdLibMap: Record<string, StdLibCallInfo> = {
  chamfer: {
    label: 'Chamfer',
    icon: 'chamfer3d',
    // modelingEvent: 'Chamfer',
  },
  extrude: {
    label: 'Extrude',
    icon: 'extrude',
    prepareToEdit: prepareToEditExtrude,
    supportsAppearance: true,
  },
  fillet: {
    label: 'Fillet',
    icon: 'fillet3d',
  },
  helix: {
    label: 'Helix',
    icon: 'helix',
    prepareToEdit: prepareToEditHelix,
  },
  hole: {
    label: 'Hole',
    icon: 'hole',
  },
  hollow: {
    label: 'Hollow',
    icon: 'hollow',
  },
  import: {
    label: 'Import',
    icon: 'import',
  },
  loft: {
    label: 'Loft',
    icon: 'loft',
    supportsAppearance: true,
  },
  offsetPlane: {
    label: 'Offset Plane',
    icon: 'plane',
    prepareToEdit: prepareToEditOffsetPlane,
  },
  patternCircular2d: {
    label: 'Circular Pattern',
    icon: 'patternCircular2d',
  },
  patternCircular3d: {
    label: 'Circular Pattern',
    icon: 'patternCircular3d',
  },
  patternLinear2d: {
    label: 'Linear Pattern',
    icon: 'patternLinear2d',
  },
  patternLinear3d: {
    label: 'Linear Pattern',
    icon: 'patternLinear3d',
  },
  revolve: {
    label: 'Revolve',
    icon: 'revolve',
    supportsAppearance: true,
  },
  shell: {
    label: 'Shell',
    icon: 'shell',
    prepareToEdit: prepareToEditShell,
    supportsAppearance: true,
  },
  startSketchOn: {
    label: 'Sketch',
    icon: 'sketch',
    // TODO: fix matching sketches-on-faces and offset planes back to their
    // original plane artifacts in order to edit them.
    async prepareToEdit({ artifact }) {
      if (artifact) {
        return {
          name: 'Enter sketch',
          groupId: 'modeling',
        }
      } else {
        return {
          reason:
            'Editing sketches on faces or offset planes through the feature tree is not yet supported. Please double-click the path in the scene for now.',
        }
      }
    },
  },
  sweep: {
    label: 'Sweep',
    icon: 'sweep',
    supportsAppearance: true,
  },
}

/**
 * Returns the label of the operation
 */
export function getOperationLabel(op: Operation): string {
  switch (op.type) {
    case 'StdLibCall':
      return stdLibMap[op.name]?.label ?? op.name
    case 'UserDefinedFunctionCall':
      return op.name ?? 'Anonymous custom function'
    case 'UserDefinedFunctionReturn':
      return 'User function return'
  }
}

/**
 * Returns the icon of the operation
 */
export function getOperationIcon(op: Operation): CustomIconName {
  switch (op.type) {
    case 'StdLibCall':
      return stdLibMap[op.name]?.icon ?? 'questionMark'
    default:
      return 'make-variable'
  }
}

/**
 * Apply all filters to a list of operations.
 */
export function filterOperations(operations: Operation[]): Operation[] {
  return operationFilters.reduce((ops, filterFn) => filterFn(ops), operations)
}

/**
 * The filters to apply to a list of operations
 * for use in the feature tree UI
 */
const operationFilters = [
  isNotUserFunctionWithNoOperations,
  isNotInsideUserFunction,
  isNotUserFunctionReturn,
]

/**
 * A filter to exclude everything that occurs inside a UserDefinedFunctionCall
 * and its corresponding UserDefinedFunctionReturn from a list of operations.
 * This works even when there are nested function calls.
 */
function isNotInsideUserFunction(operations: Operation[]): Operation[] {
  const ops: Operation[] = []
  let depth = 0
  for (const op of operations) {
    if (depth === 0) {
      ops.push(op)
    }
    if (op.type === 'UserDefinedFunctionCall') {
      depth++
    }
    if (op.type === 'UserDefinedFunctionReturn') {
      depth--
      console.assert(
        depth >= 0,
        'Unbalanced UserDefinedFunctionCall and UserDefinedFunctionReturn; too many returns'
      )
    }
  }
  // Depth could be non-zero here if there was an error in execution.
  return ops
}

/**
 * A filter to exclude UserDefinedFunctionCall operations and their
 * corresponding UserDefinedFunctionReturn that don't have any operations inside
 * them from a list of operations.
 */
function isNotUserFunctionWithNoOperations(
  operations: Operation[]
): Operation[] {
  return operations.filter((op, index) => {
    if (
      op.type === 'UserDefinedFunctionCall' &&
      // If this is a call at the end of the array, it's preserved.
      index < operations.length - 1 &&
      operations[index + 1].type === 'UserDefinedFunctionReturn'
    )
      return false
    if (
      op.type === 'UserDefinedFunctionReturn' &&
      // If this return is at the beginning of the array, it's preserved.
      index > 0 &&
      operations[index - 1].type === 'UserDefinedFunctionCall'
    )
      return false

    return true
  })
}

/**
 * A filter to exclude UserDefinedFunctionReturn operations from a list of
 * operations.
 */
function isNotUserFunctionReturn(ops: Operation[]): Operation[] {
  return ops.filter((op) => op.type !== 'UserDefinedFunctionReturn')
}

export interface EnterEditFlowProps {
  operation: Operation
  artifact?: Artifact
}

export async function enterEditFlow({
  operation,
  artifact,
}: EnterEditFlowProps): Promise<Error | CommandBarMachineEvent> {
  if (operation.type !== 'StdLibCall') {
    return new Error(
      'Feature tree editing not yet supported for user-defined functions. Please edit in the code editor.'
    )
  }
  const stdLibInfo = stdLibMap[operation.name]

  if (stdLibInfo && stdLibInfo.prepareToEdit) {
    if (typeof stdLibInfo.prepareToEdit === 'function') {
      const eventPayload = await stdLibInfo.prepareToEdit({
        operation,
        artifact,
      })
      if ('reason' in eventPayload) {
        return new Error(eventPayload.reason)
      }
      return {
        type: 'Find and select command',
        data: eventPayload,
      }
    } else {
      return 'reason' in stdLibInfo.prepareToEdit
        ? new Error(stdLibInfo.prepareToEdit.reason)
        : {
            type: 'Find and select command',
            data: stdLibInfo.prepareToEdit,
          }
    }
  }

  return new Error(
    'Feature tree editing not yet supported for this operation. Please edit in the code editor.'
  )
}

export async function enterAppearanceFlow({
  operation,
  artifact,
}: EnterEditFlowProps): Promise<Error | CommandBarMachineEvent> {
  if (operation.type !== 'StdLibCall') {
    return new Error(
      'Appearance setting not yet supported for user-defined functions. Please edit in the code editor.'
    )
  }
  const stdLibInfo = stdLibMap[operation.name]

  if (stdLibInfo && stdLibInfo.supportsAppearance) {
    const argDefaultValues = {
      nodeToEdit: getNodePathFromSourceRange(
        kclManager.ast,
        sourceRangeFromRust(operation.sourceRange)
      ),
    }
    console.log('argDefaultValues', argDefaultValues)
    return {
      type: 'Find and select command',
      data: {
        name: 'Appearance',
        groupId: 'modeling',
        argDefaultValues,
      },
    }
  }

  return new Error(
    'Appearance setting not yet supported for this operation. Please edit in the code editor.'
  )
}
