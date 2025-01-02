import { CustomIconName } from 'components/CustomIcon'
import { Artifact, getArtifactOfTypes } from 'lang/std/artifactGraph'
import { Operation } from 'wasm-lib/kcl/bindings/Operation'
import { engineCommandManager, kclManager } from './singletons'
import { err } from './trap'
import { getNodePathFromSourceRange } from 'lang/queryAst'
import { sourceRangeFromRust } from 'lang/wasm'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { CommandBarMachineEvent } from 'machines/commandBarMachine'

type ExecuteCommandEvent = CommandBarMachineEvent & {
  type: 'Find and select command'
}
type ExecuteCommandEventPayload = ExecuteCommandEvent['data']

interface StdLibCallInfo {
  label: string
  icon: CustomIconName
  /**
   * There are items which are honored by the feature tree
   * that do not yet have a corresponding modeling command.
   */
  prepareToEdit?:
    | ExecuteCommandEventPayload
    | ((
        props: Omit<EnterEditFlowProps, 'onComplete'>
      ) => ExecuteCommandEventPayload | Promise<ExecuteCommandEventPayload>)
}

const stdLibMap: Record<string, StdLibCallInfo> = {
  chamfer: {
    label: 'Chamfer',
    icon: 'chamfer3d',
    // modelingEvent: 'Chamfer',
  },
  extrude: {
    label: 'Extrude',
    icon: 'extrude',
    prepareToEdit: async ({ item, artifact }) => {
      const baseCommand = {
        name: 'Extrude',
        groupId: 'modeling',
      }
      if (!artifact || !('pathId' in artifact) || item.type !== 'StdLibCall')
        return baseCommand
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
          types: ['solid2D'],
        },
        engineCommandManager.artifactGraph
      )
      if (err(solid2DArtifact) || solid2DArtifact.type !== 'solid2D') {
        return baseCommand
      }
      const argDefaultValues = {
        selection: {
          graphSelections: [
            {
              artifact: solid2DArtifact,
              codeRef: pathArtifact.codeRef,
            },
          ],
          otherSelections: [],
        },
        // distance: await useCalculateKclExpression(
        //   codeManager.code.slice(
        //     item.labeledArgs?.['length']?.sourceRange[0],
        //     item.labeledArgs?.['length']?.sourceRange[1]
        //   )
        // ),
        nodeToEdit: getNodePathFromSourceRange(
          kclManager.ast,
          sourceRangeFromRust(item.sourceRange)
        ),
      }
      console.log({
        item: item,
        argDefaultValues,
      })
      return {
        ...baseCommand,
        argDefaultValues,
      }
    },
  },
  fillet: {
    label: 'Fillet',
    icon: 'fillet3d',
    // prepareToEdit: 'Fillet',
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
    prepareToEdit: () => ({ name: 'Loft', groupId: 'modeling' }),
  },
  offsetPlane: {
    label: 'Offset Plane',
    icon: 'plane',
    // TODO: Implement prepareToEdit
    // prepareToEdit: () => ({ type: 'Offset plane', data: { distance: 1 } }),
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
    prepareToEdit: () => ({ name: 'Revolve', groupId: 'modeling' }),
  },
  shell: {
    label: 'Shell',
    icon: 'shell',
    prepareToEdit: () => ({ name: 'Shell', groupId: 'modeling' }),
  },
  startSketchOn: {
    label: 'Sketch',
    icon: 'sketch',
    prepareToEdit: { name: 'Enter sketch', groupId: 'modeling' },
  },
  sweep: {
    label: 'Sweep',
    icon: 'sweep',
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

interface EnterEditFlowProps {
  item: Operation
  artifact?: Artifact
  onComplete: ReturnType<typeof useCommandsContext>['commandBarSend']
}

export async function enterEditFlow({
  item,
  artifact,
  onComplete,
}: EnterEditFlowProps) {
  if (item.type !== 'StdLibCall') return

  const stdLibInfo = stdLibMap[item.name]

  if (stdLibInfo && stdLibInfo.prepareToEdit) {
    if (typeof stdLibInfo.prepareToEdit === 'function') {
      const eventPayload = await stdLibInfo.prepareToEdit({
        item,
        artifact,
      })
      console.log('', {
        item,
        artifact,
        eventPayload,
      })
      onComplete({
        type: 'Find and select command',
        data: eventPayload,
      })
    } else {
      onComplete({
        type: 'Find and select command',
        data: stdLibInfo.prepareToEdit,
      })
    }
  }
}
