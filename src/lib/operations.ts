import type { Operation } from '@rust/kcl-lib/bindings/Operation'

import type { CustomIconName } from '@src/components/CustomIcon'
import { retrieveFaceSelectionsFromOpArgs } from '@src/lang/modifyAst/faces'
import { retrieveAxisOrEdgeSelectionsFromOpArg } from '@src/lang/modifyAst/sweeps'
import {
  getNodeFromPath,
  retrieveSelectionsFromOpArg,
} from '@src/lang/queryAst'
import type { Artifact } from '@src/lang/std/artifactGraph'
import {
  getArtifactOfTypes,
  getEdgeCutConsumedCodeRef,
} from '@src/lang/std/artifactGraph'
import {
  type CallExpressionKw,
  type PipeExpression,
  type Program,
  pathToNodeFromRustNodePath,
  type VariableDeclaration,
} from '@src/lang/wasm'
import type {
  HelixModes,
  ModelingCommandSchema,
} from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclCommandValue, KclExpression } from '@src/lib/commandTypes'
import { getStringValue, stringToKclExpression } from '@src/lib/kclHelpers'
import { isDefaultPlaneStr } from '@src/lib/planes'
import type { Selections } from '@src/lib/selections'
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
 * Gather up the a Parameter operation's data
 * to be used in the command bar edit flow.
 */
const prepareToEditParameter: PrepareToEditCallback = async ({ operation }) => {
  if (operation.type !== 'VariableDeclaration') {
    return { reason: 'Called on something not a variable declaration' }
  }

  const baseCommand = {
    name: 'event.parameter.edit',
    groupId: 'modeling',
  }

  // 1. Convert from the parameter's Operation to a KCL-type arg value
  const value = await stringToKclExpression(
    codeManager.code.slice(operation.sourceRange[0], operation.sourceRange[1])
  )
  if (err(value) || 'errors' in value) {
    return { reason: "Couldn't retrieve length argument" }
  }

  // 2. The nodeToEdit is much simpler to transform.
  // We need the VariableDeclarator PathToNode though, so we slice it
  const nodeToEdit = pathToNodeFromRustNodePath(operation.nodePath).slice(0, -1)

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['event.parameter.edit'] = {
    value,
    nodeToEdit,
  }
  return {
    ...baseCommand,
    argDefaultValues,
  }
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
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const sketches = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
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

  // symmetric argument from a string to boolean
  let symmetric: boolean | undefined
  if ('symmetric' in operation.labeledArgs && operation.labeledArgs.symmetric) {
    symmetric =
      codeManager.code.slice(
        operation.labeledArgs.symmetric.sourceRange[0],
        operation.labeledArgs.symmetric.sourceRange[1]
      ) === 'true'
  }

  // bidirectionalLength argument from a string to a KCL expression
  let bidirectionalLength: KclCommandValue | undefined
  if (
    'bidirectionalLength' in operation.labeledArgs &&
    operation.labeledArgs.bidirectionalLength
  ) {
    const result = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.bidirectionalLength.sourceRange[0],
        operation.labeledArgs.bidirectionalLength.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve bidirectionalLength argument" }
    }

    bidirectionalLength = result
  }

  // twistAngle argument from a string to a KCL expression
  let twistAngle: KclCommandValue | undefined
  if (
    'twistAngle' in operation.labeledArgs &&
    operation.labeledArgs.twistAngle
  ) {
    const result = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.twistAngle.sourceRange[0],
        operation.labeledArgs.twistAngle.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve twistAngle argument" }
    }

    twistAngle = result
  }

  // method argument from a string to boolean
  let method: string | undefined
  if ('method' in operation.labeledArgs && operation.labeledArgs.method) {
    method = codeManager.code.slice(
      operation.labeledArgs.method.sourceRange[0],
      operation.labeledArgs.method.sourceRange[1]
    )
  }

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Extrude'] = {
    sketches,
    length,
    symmetric,
    bidirectionalLength,
    twistAngle,
    method,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }
  return {
    ...baseCommand,
    argDefaultValues,
  }
}

/**
 * Gather up the argument values for the Loft command
 * to be used in the command bar edit flow.
 */
const prepareToEditLoft: PrepareToEditCallback = async ({ operation }) => {
  const baseCommand = {
    name: 'Loft',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  // 1. Map the unlabeled arguments to solid2d selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const sketches = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    kclManager.artifactGraph
  )
  if (err(sketches)) {
    return { reason: "Couldn't retrieve sketches" }
  }

  // 2.
  // vDegree argument from a string to a KCL expression
  let vDegree: KclCommandValue | undefined
  if ('vDegree' in operation.labeledArgs && operation.labeledArgs.vDegree) {
    const result = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.vDegree.sourceRange[0],
        operation.labeledArgs.vDegree.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve vDegree argument" }
    }

    vDegree = result
  }

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Loft'] = {
    sketches,
    vDegree,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
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
  const nodeToEdit = pathToNodeFromRustNodePath(operation.nodePath)

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
const prepareToEditShell: PrepareToEditCallback = async ({ operation }) => {
  const baseCommand = {
    name: 'Shell',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  // 1. Map the unlabeled and faces arguments to solid2d selections
  if (!operation.unlabeledArg || !operation.labeledArgs?.faces) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const result = retrieveFaceSelectionsFromOpArgs(
    operation.unlabeledArg,
    operation.labeledArgs.faces,
    kclManager.artifactGraph
  )
  if (err(result)) {
    return { reason: "Couldn't retrieve faces argument" }
  }

  const { faces } = result

  // 2. Convert the thickness argument from a string to a KCL expression
  const thickness = await stringToKclExpression(
    codeManager.code.slice(
      operation.labeledArgs?.['thickness']?.sourceRange[0],
      operation.labeledArgs?.['thickness']?.sourceRange[1]
    )
  )
  if (err(thickness) || 'errors' in thickness) {
    return { reason: "Couldn't retrieve thickness argument" }
  }

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Shell'] = {
    faces,
    thickness,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
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
  const planeName = getStringValue(codeManager.code, stdPlane.sourceRange)

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
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
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
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const sketches = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    kclManager.artifactGraph
  )
  if (err(sketches)) {
    return { reason: "Couldn't retrieve sketches" }
  }

  // 2. Prepare labeled arguments
  // Same roundabout but twice for 'path' aka trajectory: sketch -> path -> segment
  if (
    operation.labeledArgs.path?.value.type !== 'Sketch' &&
    operation.labeledArgs.path?.value.type !== 'Helix'
  ) {
    return { reason: "Couldn't retrieve path argument" }
  }

  const trajectoryPathArtifact = getArtifactOfTypes(
    {
      key: operation.labeledArgs.path.value.value.artifactId,
      types: ['path', 'helix'],
    },
    kclManager.artifactGraph
  )

  if (
    err(trajectoryPathArtifact) ||
    (trajectoryPathArtifact.type !== 'path' &&
      trajectoryPathArtifact.type !== 'helix')
  ) {
    return { reason: "Couldn't retrieve trajectory path artifact" }
  }

  const trajectoryArtifact =
    trajectoryPathArtifact.type === 'path'
      ? getArtifactOfTypes(
          {
            key: trajectoryPathArtifact.segIds[0],
            types: ['segment'],
          },
          kclManager.artifactGraph
        )
      : trajectoryPathArtifact

  if (
    err(trajectoryArtifact) ||
    (trajectoryArtifact.type !== 'segment' &&
      trajectoryArtifact.type !== 'helix')
  ) {
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

  // optional arguments
  let sectional: boolean | undefined
  if ('sectional' in operation.labeledArgs && operation.labeledArgs.sectional) {
    sectional =
      codeManager.code.slice(
        operation.labeledArgs.sectional.sourceRange[0],
        operation.labeledArgs.sectional.sourceRange[1]
      ) === 'true'
  }

  let relativeTo: string | undefined
  if (
    'relativeTo' in operation.labeledArgs &&
    operation.labeledArgs.relativeTo
  ) {
    relativeTo = codeManager.code.slice(
      operation.labeledArgs.relativeTo.sourceRange[0],
      operation.labeledArgs.relativeTo.sourceRange[1]
    )
  }

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Sweep'] = {
    sketches,
    path,
    sectional,
    relativeTo,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
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
  if ('axis' in operation.labeledArgs && operation.labeledArgs.axis) {
    // axis options string or selection arg
    const axisEdgeSelection = retrieveAxisOrEdgeSelectionsFromOpArg(
      operation.labeledArgs.axis,
      kclManager.artifactGraph
    )
    if (err(axisEdgeSelection)) {
      return { reason: "Couldn't retrieve axis or edge selection" }
    }
    mode = axisEdgeSelection.axisOrEdge
    axis = axisEdgeSelection.axis
    edge = axisEdgeSelection.edge
  } else if (
    'cylinder' in operation.labeledArgs &&
    operation.labeledArgs.cylinder
  ) {
    // axis cylinder selection arg
    const result = retrieveSelectionsFromOpArg(
      operation.labeledArgs.cylinder,
      kclManager.artifactGraph
    )
    if (err(result)) {
      return { reason: "Couldn't retrieve cylinder selection" }
    }

    mode = 'Cylinder'
    cylinder = result
  } else {
    return {
      reason: "The axis or cylinder arguments couldn't be retrieved.",
    }
  }

  // revolutions kcl arg (required for all)
  const revolutions = await stringToKclExpression(
    codeManager.code.slice(
      operation.labeledArgs?.revolutions?.sourceRange[0],
      operation.labeledArgs?.revolutions?.sourceRange[1]
    )
  )
  if (err(revolutions) || 'errors' in revolutions) {
    return { reason: 'Errors found in revolutions argument' }
  }

  // angleStart kcl arg (required for all)
  const angleStart = await stringToKclExpression(
    codeManager.code.slice(
      operation.labeledArgs?.angleStart?.sourceRange[0],
      operation.labeledArgs?.angleStart?.sourceRange[1]
    )
  )
  if (err(angleStart) || 'errors' in angleStart) {
    return { reason: 'Errors found in angleStart argument' }
  }

  // radius and cylinder and kcl arg (only for axis or edge)
  let radius: KclExpression | undefined // axis or edge modes only
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
  }

  // length kcl arg (axis or edge modes only)
  let length: KclExpression | undefined
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
  }

  // counterClockWise boolean arg (optional)
  let ccw: boolean | undefined
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
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
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
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const sketches = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
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

  const axisEdgeSelection = retrieveAxisOrEdgeSelectionsFromOpArg(
    operation.labeledArgs.axis,
    kclManager.artifactGraph
  )
  if (err(axisEdgeSelection)) {
    return { reason: "Couldn't retrieve axis or edge selections" }
  }
  const { axisOrEdge, axis, edge } = axisEdgeSelection

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

  // symmetric argument from a string to boolean
  let symmetric: boolean | undefined
  if ('symmetric' in operation.labeledArgs && operation.labeledArgs.symmetric) {
    symmetric =
      codeManager.code.slice(
        operation.labeledArgs.symmetric.sourceRange[0],
        operation.labeledArgs.symmetric.sourceRange[1]
      ) === 'true'
  }

  // bidirectionalLength argument from a string to a KCL expression
  let bidirectionalAngle: KclCommandValue | undefined
  if (
    'bidirectionalAngle' in operation.labeledArgs &&
    operation.labeledArgs.bidirectionalAngle
  ) {
    const result = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.bidirectionalAngle.sourceRange[0],
        operation.labeledArgs.bidirectionalAngle.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve bidirectionalAngle argument" }
    }

    bidirectionalAngle = result
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
    symmetric,
    bidirectionalAngle,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
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
  appearance: {
    label: 'Appearance',
    icon: 'text',
    prepareToEdit: prepareToEditAppearance,
  },
  chamfer: {
    label: 'Chamfer',
    icon: 'chamfer3d',
    prepareToEdit: prepareToEditEdgeTreatment,
    // modelingEvent: 'Chamfer',
  },
  conic: {
    label: 'Conic',
    icon: 'conic',
  },
  ellipse: {
    label: 'Ellipse',
    icon: 'ellipse',
  },
  elliptic: {
    label: 'Elliptic',
    icon: 'elliptic',
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
  hyperbolic: {
    label: 'Hyperbolic',
    icon: 'conic',
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
    prepareToEdit: prepareToEditLoft,
    supportsAppearance: true,
    supportsTransform: true,
  },
  offsetPlane: {
    label: 'Offset Plane',
    icon: 'plane',
    prepareToEdit: prepareToEditOffsetPlane,
  },
  parabolic: {
    label: 'Parabolic',
    icon: 'conic',
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
  mirror2d: {
    label: 'Mirror 2D',
    icon: 'mirror',
  },
  revolve: {
    label: 'Revolve',
    icon: 'revolve',
    prepareToEdit: prepareToEditRevolve,
    supportsAppearance: true,
    supportsTransform: true,
  },
  rotate: {
    label: 'Rotate',
    icon: 'rotate',
    prepareToEdit: prepareToEditRotate,
    supportsTransform: true,
  },
  scale: {
    label: 'Scale',
    icon: 'scale',
    prepareToEdit: prepareToEditScale,
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
  translate: {
    label: 'Translate',
    icon: 'move',
    prepareToEdit: prepareToEditTranslate,
    supportsTransform: true,
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
    case 'VariableDeclaration':
      return 'Parameter'
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
    case 'VariableDeclaration':
      return 'make-variable'
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
  if (op.type === 'VariableDeclaration') {
    return op.name
  }
  if (
    op.type !== 'StdLibCall' &&
    !(op.type === 'GroupBegin' && op.group.type === 'FunctionCall')
  ) {
    return undefined
  }
  // Find the AST node.
  const pathToNode = pathToNodeFromRustNodePath(op.nodePath)
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
  // Operate on VariableDeclarations differently from StdLibCall's
  if (operation.type === 'VariableDeclaration') {
    const eventPayload = await prepareToEditParameter({
      operation,
    })

    if ('reason' in eventPayload) {
      return new Error(eventPayload.reason)
    }

    return {
      type: 'Find and select command',
      data: eventPayload,
    }
  }

  // Begin StdLibCall processing
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

async function prepareToEditTranslate({ operation }: EnterEditFlowProps) {
  const baseCommand = {
    name: 'Translate',
    groupId: 'modeling',
  }
  const isSupportedStdLibCall =
    operation.type === 'StdLibCall' &&
    stdLibMap[operation.name]?.supportsTransform
  if (!isSupportedStdLibCall) {
    return {
      reason: 'Unsupported operation type. Please edit in the code editor.',
    }
  }

  // 1. Map the unlabeled arguments to selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const objects = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    kclManager.artifactGraph
  )
  if (err(objects)) {
    return { reason: "Couldn't retrieve objects" }
  }

  // 2. Convert the x y z arguments from a string to a KCL expression
  let x: KclCommandValue | undefined = undefined
  let y: KclCommandValue | undefined = undefined
  let z: KclCommandValue | undefined = undefined
  let global: boolean | undefined
  if (operation.labeledArgs.x) {
    const result = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.x.sourceRange[0],
        operation.labeledArgs.x.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve x argument" }
    }
    x = result
  }

  if (operation.labeledArgs.y) {
    const result = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.y.sourceRange[0],
        operation.labeledArgs.y.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve y argument" }
    }
    y = result
  }

  if (operation.labeledArgs.z) {
    const result = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.z.sourceRange[0],
        operation.labeledArgs.z.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve z argument" }
    }
    z = result
  }

  if (operation.labeledArgs.global) {
    global =
      codeManager.code.slice(
        operation.labeledArgs.global.sourceRange[0],
        operation.labeledArgs.global.sourceRange[1]
      ) === 'true'
  }

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Translate'] = {
    objects,
    x,
    y,
    z,
    global,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }
  return {
    ...baseCommand,
    argDefaultValues,
  }
}

async function prepareToEditScale({ operation }: EnterEditFlowProps) {
  const baseCommand = {
    name: 'Scale',
    groupId: 'modeling',
  }
  const isSupportedStdLibCall =
    operation.type === 'StdLibCall' &&
    stdLibMap[operation.name]?.supportsTransform
  if (!isSupportedStdLibCall) {
    return {
      reason: 'Unsupported operation type. Please edit in the code editor.',
    }
  }

  // 1. Map the unlabeled arguments to selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const objects = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    kclManager.artifactGraph
  )
  if (err(objects)) {
    return { reason: "Couldn't retrieve objects" }
  }

  // 2. Convert the x y z arguments from a string to a KCL expression
  let x: KclCommandValue | undefined = undefined
  let y: KclCommandValue | undefined = undefined
  let z: KclCommandValue | undefined = undefined
  let global: boolean | undefined
  if (operation.labeledArgs.x) {
    const result = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.x.sourceRange[0],
        operation.labeledArgs.x.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve x argument" }
    }
    x = result
  }

  if (operation.labeledArgs.y) {
    const result = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.y.sourceRange[0],
        operation.labeledArgs.y.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve y argument" }
    }
    y = result
  }

  if (operation.labeledArgs.z) {
    const result = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.z.sourceRange[0],
        operation.labeledArgs.z.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve z argument" }
    }
    z = result
  }

  if (operation.labeledArgs.global) {
    global =
      codeManager.code.slice(
        operation.labeledArgs.global.sourceRange[0],
        operation.labeledArgs.global.sourceRange[1]
      ) === 'true'
  }

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Scale'] = {
    objects,
    x,
    y,
    z,
    global,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }
  return {
    ...baseCommand,
    argDefaultValues,
  }
}

async function prepareToEditRotate({ operation }: EnterEditFlowProps) {
  const baseCommand = {
    name: 'Rotate',
    groupId: 'modeling',
  }
  const isSupportedStdLibCall =
    operation.type === 'StdLibCall' &&
    stdLibMap[operation.name]?.supportsTransform
  if (!isSupportedStdLibCall) {
    return {
      reason: 'Unsupported operation type. Please edit in the code editor.',
    }
  }

  // 1. Map the unlabeled arguments to selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const objects = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    kclManager.artifactGraph
  )
  if (err(objects)) {
    return { reason: "Couldn't retrieve objects" }
  }

  // 2. Convert the x y z arguments from a string to a KCL expression
  let roll: KclCommandValue | undefined = undefined
  let pitch: KclCommandValue | undefined = undefined
  let yaw: KclCommandValue | undefined = undefined
  let global: boolean | undefined
  if (operation.labeledArgs.roll) {
    const result = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.roll.sourceRange[0],
        operation.labeledArgs.roll.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve roll argument" }
    }
    roll = result
  }

  if (operation.labeledArgs.pitch) {
    const result = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.pitch.sourceRange[0],
        operation.labeledArgs.pitch.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve pitch argument" }
    }
    pitch = result
  }

  if (operation.labeledArgs.yaw) {
    const result = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.yaw.sourceRange[0],
        operation.labeledArgs.yaw.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve yaw argument" }
    }
    yaw = result
  }

  if (operation.labeledArgs.global) {
    global =
      codeManager.code.slice(
        operation.labeledArgs.global.sourceRange[0],
        operation.labeledArgs.global.sourceRange[1]
      ) === 'true'
  }

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Rotate'] = {
    objects,
    roll,
    pitch,
    yaw,
    global,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }
  return {
    ...baseCommand,
    argDefaultValues,
  }
}

async function prepareToEditAppearance({ operation }: EnterEditFlowProps) {
  const baseCommand = {
    name: 'Appearance',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return {
      reason: 'Unsupported operation type. Please edit in the code editor.',
    }
  }

  // 1. Map the unlabeled arguments to selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const objects = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    kclManager.artifactGraph
  )
  if (err(objects)) {
    return { reason: "Couldn't retrieve objects" }
  }

  // 2. Convert the color argument from a string to a KCL expression
  if (!operation.labeledArgs.color) {
    return { reason: "Couldn't find color argument" }
  }

  const color = getStringValue(
    codeManager.code,
    operation.labeledArgs.color.sourceRange
  )

  let metalness: KclCommandValue | undefined
  if (operation.labeledArgs.metalness) {
    const result = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.metalness.sourceRange[0],
        operation.labeledArgs.metalness.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve metalness argument" }
    }
    metalness = result
  }

  let roughness: KclCommandValue | undefined
  if (operation.labeledArgs.roughness) {
    const result = await stringToKclExpression(
      codeManager.code.slice(
        operation.labeledArgs.roughness.sourceRange[0],
        operation.labeledArgs.roughness.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve roughness argument" }
    }
    roughness = result
  }

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Appearance'] = {
    objects,
    color,
    metalness,
    roughness,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }
  return {
    ...baseCommand,
    argDefaultValues,
  }
}
