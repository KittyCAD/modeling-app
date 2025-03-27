import { CustomIconName } from 'components/CustomIcon'
import {
  Artifact,
  getArtifactOfTypes,
  getCapCodeRef,
  getEdgeCutConsumedCodeRef,
  getSweepEdgeCodeRef,
  getWallCodeRef,
} from 'lang/std/artifactGraph'
import { Operation } from '@rust/kcl-lib/bindings/Operation'
import { codeManager, engineCommandManager, kclManager } from './singletons'
import { err } from './trap'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import { sourceRangeFromRust } from 'lang/wasm'
import { CommandBarMachineEvent } from 'machines/commandBarMachine'
import { stringToKclExpression } from './kclHelpers'
import {
  HelixModes,
  ModelingCommandSchema,
} from './commandBarConfigs/modelingCommandConfig'
import { isDefaultPlaneStr } from './planes'
import { Selection, Selections } from './selections'
import { rustContext } from './singletons'
import { KclExpression } from './commandTypes'

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
 * Gather up the argument values for the Chamfer or Fillet command
 * to be used in the command bar edit flow.
 */
const prepareToEditEdgeTreatment: PrepareToEditCallback = async ({
  operation,
  artifact,
}) => {
  const isChamfer =
    artifact?.type === 'edgeCut' && artifact.subType === 'chamfer'
  const isFillet = artifact?.type === 'edgeCut' && artifact.subType === 'fillet'
  const baseCommand = {
    name: isChamfer ? 'Chamfer' : 'Fillet',
    groupId: 'modeling',
  }
  if (
    operation.type !== 'StdLibCall' ||
    !operation.labeledArgs ||
    (!isChamfer && !isFillet)
  ) {
    return { reason: 'Wrong operation type or artifact' }
  }

  // Recreate the selection argument (artiface and codeRef) from what we have
  const edgeArtifact = getArtifactOfTypes(
    {
      key: artifact.consumedEdgeId,
      types: ['segment', 'sweepEdge'],
    },
    engineCommandManager.artifactGraph
  )
  if (err(edgeArtifact)) {
    return { reason: "Couldn't find edge artifact" }
  }

  let edgeCodeRef = getEdgeCutConsumedCodeRef(
    artifact,
    engineCommandManager.artifactGraph
  )
  if (err(edgeCodeRef)) {
    return { reason: "Couldn't find edge coderef" }
  }
  const selection = {
    graphSelections: [
      {
        artifact: edgeArtifact,
        codeRef: edgeCodeRef,
      },
    ],
    otherSelections: [],
  }

  // Assemble the default argument values for the Fillet command,
  // with `nodeToEdit` set, which will let the Fillet actor know
  // to edit the node that corresponds to the StdLibCall.
  const nodeToEdit = getNodePathFromSourceRange(
    kclManager.ast,
    sourceRangeFromRust(operation.sourceRange)
  )
  const isPipeExpression = nodeToEdit.some(
    ([_, type]) => type === 'PipeExpression'
  )
  if (!isPipeExpression) {
    return {
      reason:
        'Only chamfer and fillet in pipe expressions are supported for edits',
    }
  }

  let argDefaultValues:
    | ModelingCommandSchema['Chamfer']
    | ModelingCommandSchema['Fillet']
    | undefined

  if (isChamfer) {
    // Convert the length argument from a string to a KCL expression
    const length = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs?.['length']?.sourceRange[0],
        operation.labeledArgs?.['length']?.sourceRange[1]
      )
    )
    if (err(length) || 'errors' in length) {
      return { reason: 'Error in length argument retrieval' }
    }

    argDefaultValues = {
      selection,
      length,
      nodeToEdit,
    }
  } else if (isFillet) {
    const radius = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs?.['radius']?.sourceRange[0],
        operation.labeledArgs?.['radius']?.sourceRange[1]
      )
    )
    if (err(radius) || 'errors' in radius) {
      return { reason: 'Error in radius argument retrieval' }
    }

    argDefaultValues = {
      selection,
      radius,
      nodeToEdit,
    }
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
    const candidates: Map<string, Selection> = new Map()
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

        candidates.set(artifact.subType, {
          artifact,
          codeRef,
        })
      } else if (
        artifact.type === 'wall' &&
        artifact.sweepId === sweepId &&
        artifact.segId
      ) {
        const segArtifact = getArtifactOfTypes(
          { key: artifact.segId, types: ['segment'] },
          engineCommandManager.artifactGraph
        )
        if (err(segArtifact)) {
          return baseCommand
        }

        const { codeRef } = segArtifact
        candidates.set(artifact.segId, {
          artifact,
          codeRef,
        })
      }
    }

    // Loop over face value to retrieve the corresponding artifacts and build the graphSelections
    const faceValues = operation.labeledArgs.faces.value.value
    const graphSelections: Selection[] = []
    for (const v of faceValues) {
      if (v.type === 'String' && v.value && candidates.has(v.value)) {
        graphSelections.push(candidates.get(v.value)!)
      } else if (
        v.type === 'TagIdentifier' &&
        v.artifact_id &&
        candidates.has(v.artifact_id)
      ) {
        graphSelections.push(candidates.get(v.artifact_id)!)
      } else {
        return baseCommand
      }
    }

    // Convert the thickness argument from a string to a KCL expression
    const thickness = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs?.['thickness']?.sourceRange[0],
        operation.labeledArgs?.['thickness']?.sourceRange[1]
      )
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
  const planeId = rustContext.getDefaultPlaneId(planeName)
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

const prepareToEditSweep: PrepareToEditCallback = async ({
  artifact,
  operation,
}) => {
  const baseCommand = {
    name: 'Sweep',
    groupId: 'modeling',
  }
  if (
    operation.type !== 'StdLibCall' ||
    !operation.labeledArgs ||
    !operation.unlabeledArg ||
    !('sectional' in operation.labeledArgs) ||
    !operation.labeledArgs.sectional
  ) {
    return baseCommand
  }
  if (!artifact || !('pathId' in artifact) || operation.type !== 'StdLibCall') {
    return baseCommand
  }

  // We have to go a little roundabout to get from the original artifact
  // to the solid2DId that we need to pass to the Sweep command, just like Extrude.
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
  ) {
    return baseCommand
  }

  const targetArtifact = getArtifactOfTypes(
    {
      key: pathArtifact.solid2dId,
      types: ['solid2d'],
    },
    engineCommandManager.artifactGraph
  )

  if (err(targetArtifact) || targetArtifact.type !== 'solid2d') {
    return baseCommand
  }

  const target = {
    graphSelections: [
      {
        artifact: targetArtifact,
        codeRef: pathArtifact.codeRef,
      },
    ],
    otherSelections: [],
  }

  // Same roundabout but twice for 'path' aka trajectory: sketch -> path -> segment
  if (!('path' in operation.labeledArgs) || !operation.labeledArgs.path) {
    return baseCommand
  }

  if (operation.labeledArgs.path.value.type !== 'Sketch') {
    return baseCommand
  }

  const trajectoryPathArtifact = getArtifactOfTypes(
    {
      key: operation.labeledArgs.path.value.value.artifactId,
      types: ['path'],
    },
    engineCommandManager.artifactGraph
  )

  if (err(trajectoryPathArtifact) || trajectoryPathArtifact.type !== 'path') {
    return baseCommand
  }

  const trajectoryArtifact = getArtifactOfTypes(
    {
      key: trajectoryPathArtifact.segIds[0],
      types: ['segment'],
    },
    engineCommandManager.artifactGraph
  )

  if (err(trajectoryArtifact) || trajectoryArtifact.type !== 'segment') {
    return baseCommand
  }

  const trajectory = {
    graphSelections: [
      {
        artifact: trajectoryArtifact,
        codeRef: trajectoryArtifact.codeRef,
      },
    ],
    otherSelections: [],
  }

  // sectional options boolean arg
  if (
    !('sectional' in operation.labeledArgs) ||
    !operation.labeledArgs.sectional
  ) {
    return baseCommand
  }

  const sectional =
    codeManager.code.slice(
      operation.labeledArgs.sectional.sourceRange[0],
      operation.labeledArgs.sectional.sourceRange[1]
    ) === 'true'

  // Assemble the default argument values for the Offset Plane command,
  // with `nodeToEdit` set, which will let the Offset Plane actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Sweep'] = {
    target: target,
    trajectory,
    sectional,
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
    return { reason: 'Wrong operation type or arguments' }
  }

  // Flow arg
  let mode: HelixModes | undefined
  // Three different arguments depending on mode
  let axis: string | undefined
  let edge: Selections | undefined
  let cylinder: Selections | undefined
  // Rest of stdlib args
  let revolutions: KclExpression | undefined // common to all modes, can't remain undefined
  let angleStart: KclExpression | undefined // common to all modes, can't remain undefined
  let length: KclExpression | undefined // axis or edge modes only
  let radius: KclExpression | undefined // axis or edge modes only
  let ccw = false // optional boolean argument, default value

  if ('axis' in operation.labeledArgs && operation.labeledArgs.axis) {
    // axis options string or selection arg
    const axisValue = operation.labeledArgs.axis.value
    if (axisValue.type === 'String') {
      // default axis casee
      mode = 'Axis'
      axis = axisValue.value
    } else if (axisValue.type === 'TagIdentifier' && axisValue.artifact_id) {
      // segment case
      mode = 'Edge'
      const artifact = getArtifactOfTypes(
        {
          key: axisValue.artifact_id,
          types: ['segment'],
        },
        engineCommandManager.artifactGraph
      )
      if (err(artifact)) {
        return { reason: "Couldn't find related edge artifact" }
      }

      edge = {
        graphSelections: [
          {
            artifact,
            codeRef: artifact.codeRef,
          },
        ],
        otherSelections: [],
      }
    } else if (axisValue.type === 'Uuid') {
      // sweepEdge case
      mode = 'Edge'
      const artifact = getArtifactOfTypes(
        {
          key: axisValue.value,
          types: ['sweepEdge'],
        },
        engineCommandManager.artifactGraph
      )
      if (err(artifact)) {
        return { reason: "Couldn't find related edge artifact" }
      }

      const codeRef = getSweepEdgeCodeRef(
        artifact,
        engineCommandManager.artifactGraph
      )
      if (err(codeRef)) {
        return { reason: "Couldn't find related edge code ref" }
      }

      edge = {
        graphSelections: [
          {
            artifact,
            codeRef,
          },
        ],
        otherSelections: [],
      }
    } else {
      return { reason: 'The type of the axis argument is unsupported' }
    }
  } else if (
    'cylinder' in operation.labeledArgs &&
    operation.labeledArgs.cylinder
  ) {
    mode = 'Cylinder'
    // axis cylinder selection arg
    if (operation.labeledArgs.cylinder.value.type !== 'Solid') {
      return { reason: "Cylinder arg found isn't of type Solid" }
    }

    const sweepId = operation.labeledArgs.cylinder.value.value.artifactId
    const wallArtifact = [...engineCommandManager.artifactGraph.values()].find(
      (p) => p.type === 'wall' && p.sweepId === sweepId
    )
    if (!wallArtifact || wallArtifact.type !== 'wall') {
      return {
        reason: "Cylinder arg found doesn't point to a valid sweep wall",
      }
    }

    const wallCodeRef = getWallCodeRef(
      wallArtifact,
      engineCommandManager.artifactGraph
    )
    if (err(wallCodeRef)) {
      return {
        reason: "Cylinder arg found doesn't point to a valid sweep code ref",
      }
    }

    cylinder = {
      graphSelections: [
        {
          artifact: wallArtifact,
          codeRef: wallCodeRef,
        },
      ],
      otherSelections: [],
    }
  } else {
    return {
      reason: "The axis or cylinder arguments couldn't be prepared for edit",
    }
  }

  // revolutions kcl arg (common for all)
  if (
    'revolutions' in operation.labeledArgs &&
    operation.labeledArgs.revolutions
  ) {
    const r = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.revolutions.sourceRange[0],
        operation.labeledArgs.revolutions.sourceRange[1]
      )
    )
    if (err(r) || 'errors' in r) {
      return { reason: 'Errors found in revolutions argument' }
    }

    revolutions = r
  } else {
    return { reason: "Couldn't find revolutions argument" }
  }

  // angleStart kcl arg (common for all)
  if (
    'angleStart' in operation.labeledArgs &&
    operation.labeledArgs.angleStart
  ) {
    const r = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.angleStart.sourceRange[0],
        operation.labeledArgs.angleStart.sourceRange[1]
      )
    )
    if (err(r) || 'errors' in r) {
      return { reason: 'Errors found in angleStart argument' }
    }

    angleStart = r
  } else {
    return { reason: "Couldn't find angleStart argument" }
  }

  // radius and cylinder and kcl arg (only for axis or edge)
  if (mode !== 'Cylinder') {
    if ('radius' in operation.labeledArgs && operation.labeledArgs.radius) {
      const r = await stringToKclExpression(
        codeManager.code.slice(
          operation.labeledArgs.radius.sourceRange[0],
          operation.labeledArgs.radius.sourceRange[1]
        )
      )
      if (err(r) || 'errors' in r) {
        return { reason: 'Error in radius argument retrieval' }
      }
      radius = r
    } else {
      return { reason: "Couldn't find radius argument" }
    }
  }

  if (mode === 'Axis') {
    if ('length' in operation.labeledArgs && operation.labeledArgs.length) {
      const r = await stringToKclExpression(
        codeManager.code.slice(
          operation.labeledArgs.length.sourceRange[0],
          operation.labeledArgs.length.sourceRange[1]
        )
      )
      if (err(r) || 'errors' in r) {
        return { reason: 'Error in length argument retrieval' }
      }
      length = r
    } else {
      return { reason: "Couldn't find length argument" }
    }
  }

  // counterClockWise boolean arg (optional)
  if ('ccw' in operation.labeledArgs && operation.labeledArgs.ccw) {
    ccw =
      codeManager.code.slice(
        operation.labeledArgs.ccw.sourceRange[0],
        operation.labeledArgs.ccw.sourceRange[1]
      ) === 'true'
  }

  // Assemble the default argument values for the Offset Plane command,
  // with `nodeToEdit` set, which will let the Offset Plane actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Helix'] = {
    mode,
    axis,
    edge,
    cylinder,
    revolutions,
    angleStart,
    radius,
    length,
    ccw,
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
    prepareToEdit: prepareToEditEdgeTreatment,
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
    prepareToEdit: prepareToEditEdgeTreatment,
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
    prepareToEdit: prepareToEditSweep,
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
