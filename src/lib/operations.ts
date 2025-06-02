import type { OpKclValue, Operation } from '@rust/kcl-lib/bindings/Operation'

import type { CustomIconName } from '@src/components/CustomIcon'
import {
  getNodeFromPath,
  findPipesWithImportAlias,
  getSketchSelectionsFromOperation,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type { Artifact } from '@src/lang/std/artifactGraph'
import {
  getArtifactOfTypes,
  getCapCodeRef,
  getEdgeCutConsumedCodeRef,
  getSweepEdgeCodeRef,
  getWallCodeRef,
} from '@src/lang/std/artifactGraph'
import {
  type CallExpressionKw,
  type PipeExpression,
  type Program,
  sourceRangeFromRust,
  type VariableDeclaration,
} from '@src/lang/wasm'
import type {
  HelixModes,
  ModelingCommandSchema,
} from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclExpression } from '@src/lib/commandTypes'
import {
  stringToKclExpression,
  retrieveArgFromPipedCallExpression,
} from '@src/lib/kclHelpers'
import { isDefaultPlaneStr } from '@src/lib/planes'
import type { Selection, Selections } from '@src/lib/selections'
import { codeManager, kclManager, rustContext } from '@src/lib/singletons'
import { err } from '@src/lib/trap'
import type { CommandBarMachineEvent } from '@src/machines/commandBarMachine'

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
  supportsTransform?: boolean
}

/**
 * Gather up the argument values for the Extrude command
 * to be used in the command bar edit flow.
 */
const prepareToEditExtrude: PrepareToEditCallback = async ({ operation }) => {
  const baseCommand = {
    name: 'Extrude',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  // 1. Map the unlabeled arguments to solid2d selections
  const sketches = getSketchSelectionsFromOperation(
    operation,
    kclManager.artifactGraph
  )
  if (err(sketches)) {
    return { reason: "Couldn't retrieve sketches" }
  }

  // 2. Convert the length argument from a string to a KCL expression
  const length = await stringToKclExpression(
    codeManager.code.slice(
      operation.labeledArgs?.['length']?.sourceRange[0],
      operation.labeledArgs?.['length']?.sourceRange[1]
    )
  )
  if (err(length) || 'errors' in length) {
    return { reason: "Couldn't retrieve length argument" }
  }

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Extrude'] = {
    sketches,
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
    kclManager.artifactGraph
  )
  if (err(edgeArtifact)) {
    return { reason: "Couldn't find edge artifact" }
  }

  let edgeCodeRef = getEdgeCutConsumedCodeRef(
    artifact,
    kclManager.artifactGraph
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
      !('thickness' in operation.labeledArgs) ||
      !('faces' in operation.labeledArgs) ||
      !operation.labeledArgs.thickness ||
      !operation.labeledArgs.faces ||
      operation.labeledArgs.faces.value.type !== 'Array'
    ) {
      return baseCommand
    }

    let value
    if (operation.unlabeledArg.value.type === 'Solid') {
      value = operation.unlabeledArg.value.value
    } else if (
      operation.unlabeledArg.value.type === 'Array' &&
      operation.unlabeledArg.value.value[0].type === 'Solid'
    ) {
      value = operation.unlabeledArg.value.value[0].value
    } else {
      return baseCommand
    }

    // Build an artifact map here of eligible artifacts corresponding to our current sweep
    // that we can query in another loop later
    const sweepId = value.artifactId
    const candidates: Map<string, Selection> = new Map()
    for (const artifact of kclManager.artifactGraph.values()) {
      if (
        artifact.type === 'cap' &&
        artifact.sweepId === sweepId &&
        artifact.subType
      ) {
        const codeRef = getCapCodeRef(artifact, kclManager.artifactGraph)
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
          kclManager.artifactGraph
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

/**
 * Gather up the argument values for the sweep command
 * to be used in the command bar edit flow.
 */
const prepareToEditSweep: PrepareToEditCallback = async ({ operation }) => {
  const baseCommand = {
    name: 'Sweep',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  // 1. Map the unlabeled arguments to solid2d selections
  const sketches = getSketchSelectionsFromOperation(
    operation,
    kclManager.artifactGraph
  )
  if (err(sketches)) {
    return { reason: "Couldn't retrieve sketches" }
  }

  // 2. Prepare labeled arguments
  // Same roundabout but twice for 'path' aka trajectory: sketch -> path -> segment
  if (operation.labeledArgs.path?.value.type !== 'Sketch') {
    return { reason: "Couldn't retrieve trajectory argument" }
  }

  const trajectoryPathArtifact = getArtifactOfTypes(
    {
      key: operation.labeledArgs.path.value.value.artifactId,
      types: ['path'],
    },
    kclManager.artifactGraph
  )

  if (err(trajectoryPathArtifact) || trajectoryPathArtifact.type !== 'path') {
    return { reason: "Couldn't retrieve trajectory path artifact" }
  }

  const trajectoryArtifact = getArtifactOfTypes(
    {
      key: trajectoryPathArtifact.segIds[0],
      types: ['segment'],
    },
    kclManager.artifactGraph
  )

  if (err(trajectoryArtifact) || trajectoryArtifact.type !== 'segment') {
    console.log(trajectoryArtifact)
    return { reason: "Couldn't retrieve trajectory artifact" }
  }

  const path = {
    graphSelections: [
      {
        artifact: trajectoryArtifact,
        codeRef: trajectoryArtifact.codeRef,
      },
    ],
    otherSelections: [],
  }

  // sectional argument from a string to a KCL expression
  let sectional: boolean | undefined
  if ('sectional' in operation.labeledArgs && operation.labeledArgs.sectional) {
    sectional =
      codeManager.code.slice(
        operation.labeledArgs.sectional.sourceRange[0],
        operation.labeledArgs.sectional.sourceRange[1]
      ) === 'true'
  }

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Sweep'] = {
    sketches,
    path,
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

const nonZero = (val: OpKclValue): number => {
  if (val.type === 'Number') {
    return val.value
  } else {
    return 0
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
    if (axisValue.type === 'Object') {
      // default axis case
      mode = 'Axis'
      const direction = axisValue.value['direction']
      if (!direction || direction.type !== 'Array') {
        return { reason: 'No direction vector for axis' }
      }
      if (nonZero(direction.value[0])) {
        axis = 'X'
      } else if (nonZero(direction.value[1])) {
        axis = 'Y'
      } else if (nonZero(direction.value[2])) {
        axis = 'Z'
      } else {
        return { reason: 'Bad direction vector for axis' }
      }
    } else if (axisValue.type === 'TagIdentifier' && axisValue.artifact_id) {
      // segment case
      mode = 'Edge'
      const artifact = getArtifactOfTypes(
        {
          key: axisValue.artifact_id,
          types: ['segment'],
        },
        kclManager.artifactGraph
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
        kclManager.artifactGraph
      )
      if (err(artifact)) {
        return { reason: "Couldn't find related edge artifact" }
      }

      const codeRef = getSweepEdgeCodeRef(artifact, kclManager.artifactGraph)
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
    const wallArtifact = [...kclManager.artifactGraph.values()].find(
      (p) => p.type === 'wall' && p.sweepId === sweepId
    )
    if (!wallArtifact || wallArtifact.type !== 'wall') {
      return {
        reason: "Cylinder arg found doesn't point to a valid sweep wall",
      }
    }

    const wallCodeRef = getWallCodeRef(wallArtifact, kclManager.artifactGraph)
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
 * Gather up the argument values for the Revolve command
 * to be used in the command bar edit flow.
 */
const prepareToEditRevolve: PrepareToEditCallback = async ({
  operation,
  artifact,
}) => {
  const baseCommand = {
    name: 'Revolve',
    groupId: 'modeling',
  }
  if (!artifact || operation.type !== 'StdLibCall' || !operation.labeledArgs) {
    return { reason: 'Wrong operation type or artifact' }
  }

  // 1. Map the unlabeled arguments to solid2d selections
  const sketches = getSketchSelectionsFromOperation(
    operation,
    kclManager.artifactGraph
  )
  if (err(sketches)) {
    return { reason: "Couldn't retrieve sketches" }
  }

  // 2. Prepare labeled arguments
  // axis options string arg
  if (!('axis' in operation.labeledArgs) || !operation.labeledArgs.axis) {
    return { reason: "Couldn't find axis argument" }
  }

  const axisValue = operation.labeledArgs.axis.value
  let axisOrEdge: 'Axis' | 'Edge' | undefined
  let axis: string | undefined
  let edge: Selections | undefined
  if (axisValue.type === 'Object') {
    // default axis casee
    axisOrEdge = 'Axis'
    const direction = axisValue.value['direction']
    if (!direction || direction.type !== 'Array') {
      return { reason: 'No direction vector for axis' }
    }
    if (nonZero(direction.value[0])) {
      axis = 'X'
    } else if (nonZero(direction.value[1])) {
      axis = 'Y'
    } else {
      return { reason: 'Bad direction vector for axis' }
    }
  } else if (axisValue.type === 'TagIdentifier' && axisValue.artifact_id) {
    // segment case
    axisOrEdge = 'Edge'
    const artifact = getArtifactOfTypes(
      {
        key: axisValue.artifact_id,
        types: ['segment'],
      },
      kclManager.artifactGraph
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
    axisOrEdge = 'Edge'
    const artifact = getArtifactOfTypes(
      {
        key: axisValue.value,
        types: ['sweepEdge'],
      },
      kclManager.artifactGraph
    )
    if (err(artifact)) {
      return { reason: "Couldn't find related edge artifact" }
    }

    const codeRef = getSweepEdgeCodeRef(artifact, kclManager.artifactGraph)
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

  // angle kcl arg
  // Default to '360' if not present
  const angle = await stringToKclExpression(
    'angle' in operation.labeledArgs && operation.labeledArgs.angle
      ? codeManager.code.slice(
          operation.labeledArgs.angle.sourceRange[0],
          operation.labeledArgs.angle.sourceRange[1]
        )
      : '360deg'
  )
  if (err(angle) || 'errors' in angle) {
    return { reason: 'Error in angle argument retrieval' }
  }

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Revolve'] = {
    sketches,
    axisOrEdge,
    axis,
    edge,
    angle,
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
    supportsTransform: true,
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
  subtract2d: {
    label: 'Subtract 2D',
    icon: 'hole',
  },
  hollow: {
    label: 'Hollow',
    icon: 'hollow',
    supportsAppearance: true,
    supportsTransform: true,
  },
  import: {
    label: 'Import',
    icon: 'import',
    supportsAppearance: true,
    supportsTransform: true,
  },
  intersect: {
    label: 'Intersect',
    icon: 'booleanIntersect',
    supportsAppearance: true,
    supportsTransform: true,
  },
  loft: {
    label: 'Loft',
    icon: 'loft',
    supportsAppearance: true,
    supportsTransform: true,
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
    supportsAppearance: true,
    supportsTransform: true,
  },
  patternLinear2d: {
    label: 'Linear Pattern',
    icon: 'patternLinear2d',
  },
  patternLinear3d: {
    label: 'Linear Pattern',
    icon: 'patternLinear3d',
    supportsAppearance: true,
    supportsTransform: true,
  },
  revolve: {
    label: 'Revolve',
    icon: 'revolve',
    prepareToEdit: prepareToEditRevolve,
    supportsAppearance: true,
    supportsTransform: true,
  },
  shell: {
    label: 'Shell',
    icon: 'shell',
    prepareToEdit: prepareToEditShell,
    supportsAppearance: true,
    supportsTransform: true,
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
  subtract: {
    label: 'Subtract',
    icon: 'booleanSubtract',
  },
  sweep: {
    label: 'Sweep',
    icon: 'sweep',
    prepareToEdit: prepareToEditSweep,
    supportsAppearance: true,
  },
  union: {
    label: 'Union',
    icon: 'booleanUnion',
  },
  clone: {
    label: 'Clone',
    icon: 'clone',
    supportsAppearance: true,
    supportsTransform: true,
  },
}

/**
 * Returns the label of the operation
 */
export function getOperationLabel(op: Operation): string {
  switch (op.type) {
    case 'StdLibCall':
      return stdLibMap[op.name]?.label ?? op.name
    case 'GroupBegin':
      if (op.group.type === 'FunctionCall') {
        return op.group.name ?? 'anonymous'
      } else if (op.group.type === 'ModuleInstance') {
        return op.group.name
      } else {
        const _exhaustiveCheck: never = op.group
        return '' // unreachable
      }
    case 'GroupEnd':
      return 'Group end'
    default:
      const _exhaustiveCheck: never = op
      return '' // unreachable
  }
}

/**
 * Returns the icon of the operation
 */
export function getOperationIcon(op: Operation): CustomIconName {
  switch (op.type) {
    case 'StdLibCall':
      return stdLibMap[op.name]?.icon ?? 'questionMark'
    case 'GroupBegin':
      if (op.group.type === 'ModuleInstance') {
        return 'import' // TODO: Use insert icon.
      }
      return 'make-variable'
    case 'GroupEnd':
      return 'questionMark'
    default:
      const _exhaustiveCheck: never = op
      return 'questionMark' // unreachable
  }
}

/**
 * If the result of the operation is assigned to a variable, returns the
 * variable name.
 */
export function getOperationVariableName(
  op: Operation,
  program: Program
): string | undefined {
  if (
    op.type !== 'StdLibCall' &&
    !(op.type === 'GroupBegin' && op.group.type === 'FunctionCall')
  ) {
    return undefined
  }
  // Find the AST node.
  const range = sourceRangeFromRust(op.sourceRange)
  const pathToNode = getNodePathFromSourceRange(program, range)
  if (pathToNode.length === 0) {
    return undefined
  }
  const call = getNodeFromPath<CallExpressionKw>(
    program,
    pathToNode,
    'CallExpressionKw'
  )
  if (err(call) || call.node.type !== 'CallExpressionKw') {
    return undefined
  }
  // Find the var name from the variable declaration.
  const varDec = getNodeFromPath<VariableDeclaration>(
    program,
    pathToNode,
    'VariableDeclaration'
  )
  if (err(varDec)) {
    return undefined
  }
  if (varDec.node.type !== 'VariableDeclaration') {
    // There's no variable declaration for this call.
    return undefined
  }
  const varName = varDec.node.declaration.id.name
  // If the operation is a simple assignment, we can use the variable name.
  if (varDec.node.declaration.init === call.node) {
    return varName
  }
  // If the AST node is in a pipe expression, we can only use the variable
  // name if it's the last operation in the pipe.
  const pipe = getNodeFromPath<PipeExpression>(
    program,
    pathToNode,
    'PipeExpression'
  )
  if (err(pipe)) {
    return undefined
  }
  if (
    pipe.node.type === 'PipeExpression' &&
    pipe.node.body[pipe.node.body.length - 1] === call.node
  ) {
    return varName
  }
  return undefined
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
  isNotInsideGroup,
  isNotGroupEnd,
]

/**
 * A filter to exclude everything that occurs inside a GroupBegin and its
 * corresponding GroupEnd from a list of operations. This works even when there
 * are nested function calls and module instances.
 */
function isNotInsideGroup(operations: Operation[]): Operation[] {
  const ops: Operation[] = []
  let depth = 0
  for (const op of operations) {
    if (depth === 0) {
      ops.push(op)
    }
    if (op.type === 'GroupBegin') {
      depth++
    }
    if (op.type === 'GroupEnd') {
      depth--
      console.assert(
        depth >= 0,
        'Unbalanced GroupBegin and GroupEnd; too many ends'
      )
    }
  }
  // Depth could be non-zero here if there was an error in execution.
  return ops
}

/**
 * A filter to exclude GroupBegin operations and their corresponding GroupEnd
 * that don't have any operations inside them from a list of operations, if it's
 * a function call.
 */
function isNotUserFunctionWithNoOperations(
  operations: Operation[]
): Operation[] {
  return operations.filter((op, index) => {
    if (
      op.type === 'GroupBegin' &&
      op.group.type === 'FunctionCall' &&
      // If this is a "begin" at the end of the array, it's preserved.
      index < operations.length - 1 &&
      operations[index + 1].type === 'GroupEnd'
    )
      return false
    const previousOp = index > 0 ? operations[index - 1] : undefined
    if (
      op.type === 'GroupEnd' &&
      // If this is an "end" at the beginning of the array, it's preserved.
      previousOp !== undefined &&
      previousOp.type === 'GroupBegin' &&
      previousOp.group.type === 'FunctionCall'
    )
      return false

    return true
  })
}

/**
 * A filter to exclude GroupEnd operations from a list of operations.
 */
function isNotGroupEnd(ops: Operation[]): Operation[] {
  return ops.filter((op) => op.type !== 'GroupEnd')
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
      'Feature tree editing not yet supported for user-defined functions or modules. Please edit in the code editor.'
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
}: EnterEditFlowProps): Promise<Error | CommandBarMachineEvent> {
  if (operation.type !== 'StdLibCall') {
    return new Error(
      'Appearance setting not yet supported for user-defined functions or modules. Please edit in the code editor.'
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

export async function enterTranslateFlow({
  operation,
}: EnterEditFlowProps): Promise<Error | CommandBarMachineEvent> {
  const isModuleImport = operation.type === 'GroupBegin'
  const isSupportedStdLibCall =
    operation.type === 'StdLibCall' &&
    stdLibMap[operation.name]?.supportsTransform
  if (!isModuleImport && !isSupportedStdLibCall) {
    return new Error(
      'Unsupported operation type. Please edit in the code editor.'
    )
  }

  const nodeToEdit = getNodePathFromSourceRange(
    kclManager.ast,
    sourceRangeFromRust(operation.sourceRange)
  )
  let x: KclExpression | undefined = undefined
  let y: KclExpression | undefined = undefined
  let z: KclExpression | undefined = undefined
  const pipeLookupFromOperation = getNodeFromPath<PipeExpression>(
    kclManager.ast,
    nodeToEdit,
    'PipeExpression'
  )
  let pipe: PipeExpression | undefined
  const ast = kclManager.ast
  if (
    err(pipeLookupFromOperation) ||
    pipeLookupFromOperation.node.type !== 'PipeExpression'
  ) {
    // Look for the last pipe with the import alias and a call to translate
    const pipes = findPipesWithImportAlias(ast, nodeToEdit, 'translate')
    pipe = pipes.at(-1)?.expression
  } else {
    pipe = pipeLookupFromOperation.node
  }

  if (pipe) {
    const translate = pipe.body.find(
      (n) => n.type === 'CallExpressionKw' && n.callee.name.name === 'translate'
    )
    if (translate?.type === 'CallExpressionKw') {
      x = await retrieveArgFromPipedCallExpression(translate, 'x')
      y = await retrieveArgFromPipedCallExpression(translate, 'y')
      z = await retrieveArgFromPipedCallExpression(translate, 'z')
    }
  }

  // Won't be used since we provide nodeToEdit
  const selection: Selections = { graphSelections: [], otherSelections: [] }
  const argDefaultValues = { nodeToEdit, selection, x, y, z }
  return {
    type: 'Find and select command',
    data: {
      name: 'Translate',
      groupId: 'modeling',
      argDefaultValues,
    },
  }
}

export async function enterRotateFlow({
  operation,
}: EnterEditFlowProps): Promise<Error | CommandBarMachineEvent> {
  const isModuleImport = operation.type === 'GroupBegin'
  const isSupportedStdLibCall =
    operation.type === 'StdLibCall' &&
    stdLibMap[operation.name]?.supportsTransform
  if (!isModuleImport && !isSupportedStdLibCall) {
    return new Error(
      'Unsupported operation type. Please edit in the code editor.'
    )
  }

  const nodeToEdit = getNodePathFromSourceRange(
    kclManager.ast,
    sourceRangeFromRust(operation.sourceRange)
  )
  let roll: KclExpression | undefined = undefined
  let pitch: KclExpression | undefined = undefined
  let yaw: KclExpression | undefined = undefined
  const pipeLookupFromOperation = getNodeFromPath<PipeExpression>(
    kclManager.ast,
    nodeToEdit,
    'PipeExpression'
  )
  let pipe: PipeExpression | undefined
  const ast = kclManager.ast
  if (
    err(pipeLookupFromOperation) ||
    pipeLookupFromOperation.node.type !== 'PipeExpression'
  ) {
    // Look for the last pipe with the import alias and a call to rotate
    const pipes = findPipesWithImportAlias(ast, nodeToEdit, 'rotate')
    pipe = pipes.at(-1)?.expression
  } else {
    pipe = pipeLookupFromOperation.node
  }

  if (pipe) {
    const rotate = pipe.body.find(
      (n) => n.type === 'CallExpressionKw' && n.callee.name.name === 'rotate'
    )
    if (rotate?.type === 'CallExpressionKw') {
      roll = await retrieveArgFromPipedCallExpression(rotate, 'roll')
      pitch = await retrieveArgFromPipedCallExpression(rotate, 'pitch')
      yaw = await retrieveArgFromPipedCallExpression(rotate, 'yaw')
    }
  }

  // Won't be used since we provide nodeToEdit
  const selection: Selections = { graphSelections: [], otherSelections: [] }
  const argDefaultValues = { nodeToEdit, selection, roll, pitch, yaw }
  return {
    type: 'Find and select command',
    data: {
      name: 'Rotate',
      groupId: 'modeling',
      argDefaultValues,
    },
  }
}

export async function enterCloneFlow({
  operation,
}: EnterEditFlowProps): Promise<Error | CommandBarMachineEvent> {
  const isModuleImport = operation.type === 'GroupBegin'
  const isSupportedStdLibCall =
    operation.type === 'StdLibCall' &&
    stdLibMap[operation.name]?.supportsTransform
  if (!isModuleImport && !isSupportedStdLibCall) {
    return new Error(
      'Unsupported operation type. Please edit in the code editor.'
    )
  }

  const nodeToEdit = getNodePathFromSourceRange(
    kclManager.ast,
    sourceRangeFromRust(operation.sourceRange)
  )

  // Won't be used since we provide nodeToEdit
  const selection: Selections = { graphSelections: [], otherSelections: [] }
  const argDefaultValues = { nodeToEdit, selection }
  return {
    type: 'Find and select command',
    data: {
      name: 'Clone',
      groupId: 'modeling',
      argDefaultValues,
    },
  }
}
