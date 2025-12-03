import type { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'
import type { Operation, OpKclValue } from '@rust/kcl-lib/bindings/Operation'

import type { CustomIconName } from '@src/components/CustomIcon'
import {
  retrieveFaceSelectionsFromOpArgs,
  retrieveHoleBodyArgs,
  retrieveHoleBottomArgs,
  retrieveHoleTypeArgs,
  retrieveNonDefaultPlaneSelectionFromOpArg,
} from '@src/lang/modifyAst/faces'
import {
  retrieveAxisOrEdgeSelectionsFromOpArg,
  retrieveTagDeclaratorFromOpArg,
  SWEEP_CONSTANTS,
  SWEEP_MODULE,
  type SweepRelativeTo,
} from '@src/lang/modifyAst/sweeps'
import {
  getNodeFromPath,
  retrieveSelectionsFromOpArg,
} from '@src/lang/queryAst'
import type { StdLibCallOp } from '@src/lang/queryAst'
import type { Artifact } from '@src/lang/std/artifactGraph'
import {
  getArtifactOfTypes,
  getCodeRefsByArtifactId,
} from '@src/lang/std/artifactGraph'
import {
  type CallExpressionKw,
  type PipeExpression,
  type Program,
  type VariableDeclaration,
  pathToNodeFromRustNodePath,
} from '@src/lang/wasm'
import type {
  HelixModes,
  ModelingCommandSchema,
} from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclCommandValue, KclExpression } from '@src/lib/commandTypes'
import { getStringValue, stringToKclExpression } from '@src/lib/kclHelpers'
import { isDefaultPlaneStr } from '@src/lib/planes'
import { stripQuotes } from '@src/lib/utils'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import { kclManager, rustContext } from '@src/lib/singletons'
import { err } from '@src/lib/trap'
import type { CommandBarMachineEvent } from '@src/machines/commandBarMachine'
import { retrieveEdgeSelectionsFromOpArgs } from '@src/lang/modifyAst/edges'

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

// Helper functions for argument extraction
async function extractKclArgument(
  operation: StdLibCallOp,
  argName: string,
  isArray = false
): Promise<KclCommandValue | { error: string }> {
  const arg = operation.labeledArgs?.[argName]
  if (!arg?.sourceRange) {
    return { error: `Missing or invalid ${argName} argument` }
  }

  const result = await stringToKclExpression(
    kclManager.code.slice(arg.sourceRange[0], arg.sourceRange[1]),
    isArray
  )

  if (err(result) || 'errors' in result) {
    return { error: `Failed to parse ${argName} argument as KCL expression` }
  }

  return result
}

/**
 * Extracts face selections for GDT annotations.
 *
 * Handles following types of face selections through direct tagging:
 * - Segment faces: Tagged directly on segments, converted to wall artifacts
 * - Cap faces: Tagged directly on sweeps using tagEnd/tagStart
 * GDT uses direct tagging for explicit face references.
 */
function extractFaceSelections(facesArg: any): Selection[] | { error: string } {
  const faceValues: any[] =
    facesArg.value.type === 'Array' ? facesArg.value.value : [facesArg.value]

  const graphSelections: Selection[] = []

  for (const v of faceValues) {
    if (v.type !== 'TagIdentifier' || !v.artifact_id) {
      continue
    }

    const artifact = kclManager.artifactGraph.get(v.artifact_id)
    if (!artifact) {
      continue
    }

    let targetArtifact = artifact
    let targetCodeRefs = getCodeRefsByArtifactId(
      v.artifact_id,
      kclManager.artifactGraph
    )

    // Handle segment faces: Convert segment artifacts to wall artifacts for 3D operations
    if (artifact.type === 'segment') {
      const wallArtifact = Array.from(kclManager.artifactGraph.values()).find(
        (candidate) =>
          candidate.type === 'wall' && candidate.segId === artifact.id
      )

      if (wallArtifact) {
        targetArtifact = wallArtifact
        const wallCodeRefs = getCodeRefsByArtifactId(
          wallArtifact.id,
          kclManager.artifactGraph
        )

        if (wallCodeRefs && wallCodeRefs.length > 0) {
          targetCodeRefs = wallCodeRefs
        } else {
          const segArtifact = getArtifactOfTypes(
            { key: artifact.id, types: ['segment'] },
            kclManager.artifactGraph
          )
          if (!err(segArtifact)) {
            targetCodeRefs = [segArtifact.codeRef]
          }
        }
      }
    }

    // Cap faces (from tagEnd/tagStart) are handled directly
    // as they already reference the correct cap artifacts
    if (targetCodeRefs && targetCodeRefs.length > 0) {
      graphSelections.push({
        artifact: targetArtifact,
        codeRef: targetCodeRefs[0],
      })
    }
  }

  if (graphSelections.length === 0) {
    return { error: 'No valid face selections found in TagIdentifier objects' }
  }

  return graphSelections
}

function extractStringArgument(
  operation: StdLibCallOp,
  argName: string
): string | undefined {
  const arg = operation.labeledArgs?.[argName]
  return arg?.sourceRange
    ? kclManager.code.slice(arg.sourceRange[0], arg.sourceRange[1])
    : undefined
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
    name: 'parameter.edit',
    groupId: 'code',
  }

  // 1. Convert from the parameter's Operation to a KCL-type arg value
  const value = await stringToKclExpression(
    kclManager.code.slice(operation.sourceRange[0], operation.sourceRange[1])
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
  const argDefaultValues = {
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
  let length: KclCommandValue | undefined
  if ('length' in operation.labeledArgs && operation.labeledArgs.length) {
    const result = await stringToKclExpression(
      kclManager.code.slice(
        operation.labeledArgs?.['length']?.sourceRange[0],
        operation.labeledArgs?.['length']?.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve length argument" }
    }

    length = result
  }

  let to: Selections | undefined
  if ('to' in operation.labeledArgs && operation.labeledArgs.to) {
    const graphSelections = extractFaceSelections(operation.labeledArgs.to)
    if ('error' in graphSelections) return { reason: graphSelections.error }
    to = { graphSelections, otherSelections: [] }
  }

  // symmetric argument from a string to boolean
  let symmetric: boolean | undefined
  if ('symmetric' in operation.labeledArgs && operation.labeledArgs.symmetric) {
    symmetric =
      kclManager.code.slice(
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
      kclManager.code.slice(
        operation.labeledArgs.bidirectionalLength.sourceRange[0],
        operation.labeledArgs.bidirectionalLength.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve bidirectionalLength argument" }
    }

    bidirectionalLength = result
  }

  // tagStart and tagEng arguments
  let tagStart: string | undefined
  let tagEnd: string | undefined
  if ('tagStart' in operation.labeledArgs && operation.labeledArgs.tagStart) {
    tagStart = retrieveTagDeclaratorFromOpArg(
      operation.labeledArgs.tagStart,
      kclManager.code
    )
  }
  if ('tagEnd' in operation.labeledArgs && operation.labeledArgs.tagEnd) {
    tagEnd = retrieveTagDeclaratorFromOpArg(
      operation.labeledArgs.tagEnd,
      kclManager.code
    )
  }

  // twistAngle argument from a string to a KCL expression
  let twistAngle: KclCommandValue | undefined
  if (
    'twistAngle' in operation.labeledArgs &&
    operation.labeledArgs.twistAngle
  ) {
    const result = await stringToKclExpression(
      kclManager.code.slice(
        operation.labeledArgs.twistAngle.sourceRange[0],
        operation.labeledArgs.twistAngle.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve twistAngle argument" }
    }

    twistAngle = result
  }

  // twistAngleStep argument from a string to a KCL expression
  let twistAngleStep: KclCommandValue | undefined
  if (
    'twistAngleStep' in operation.labeledArgs &&
    operation.labeledArgs.twistAngleStep
  ) {
    const result = await stringToKclExpression(
      kclManager.code.slice(
        operation.labeledArgs.twistAngleStep.sourceRange[0],
        operation.labeledArgs.twistAngleStep.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve twistAngleStep argument" }
    }

    twistAngleStep = result
  }

  // twistCenter argument from a Point2d to two KCL expression
  let twistCenter: KclCommandValue | undefined
  if (
    'twistCenter' in operation.labeledArgs &&
    operation.labeledArgs.twistCenter
  ) {
    const allowArrays = true
    const result = await stringToKclExpression(
      kclManager.code.slice(
        operation.labeledArgs.twistCenter.sourceRange[0],
        operation.labeledArgs.twistCenter.sourceRange[1]
      ),
      allowArrays
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve twistCenter argument" }
    }

    twistCenter = result
  }

  // method argument from a string to boolean
  let method: string | undefined
  if ('method' in operation.labeledArgs && operation.labeledArgs.method) {
    method = kclManager.code.slice(
      operation.labeledArgs.method.sourceRange[0],
      operation.labeledArgs.method.sourceRange[1]
    )
  }

  // bodyType argument from a string
  let bodyType: string | undefined
  if ('bodyType' in operation.labeledArgs && operation.labeledArgs.bodyType) {
    bodyType = kclManager.code.slice(
      operation.labeledArgs.bodyType.sourceRange[0],
      operation.labeledArgs.bodyType.sourceRange[1]
    )
  }

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Extrude'] = {
    sketches,
    length,
    to,
    symmetric,
    bidirectionalLength,
    tagStart,
    tagEnd,
    twistAngle,
    twistAngleStep,
    twistCenter,
    method,
    bodyType,
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
      kclManager.code.slice(
        operation.labeledArgs.vDegree.sourceRange[0],
        operation.labeledArgs.vDegree.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve vDegree argument" }
    }

    vDegree = result
  }

  // bezApproximateRational argument from a string to boolean
  let bezApproximateRational: boolean | undefined
  if (
    'bezApproximateRational' in operation.labeledArgs &&
    operation.labeledArgs.bezApproximateRational
  ) {
    bezApproximateRational =
      kclManager.code.slice(
        operation.labeledArgs.bezApproximateRational.sourceRange[0],
        operation.labeledArgs.bezApproximateRational.sourceRange[1]
      ) === 'true'
  }

  // baseCurveIndex argument from a string to a KCL expression
  let baseCurveIndex: KclCommandValue | undefined
  if (
    'baseCurveIndex' in operation.labeledArgs &&
    operation.labeledArgs.baseCurveIndex
  ) {
    const result = await stringToKclExpression(
      kclManager.code.slice(
        operation.labeledArgs.baseCurveIndex.sourceRange[0],
        operation.labeledArgs.baseCurveIndex.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve baseCurveIndex argument" }
    }

    baseCurveIndex = result
  }

  // tagStart and tagEnd arguments
  let tagStart: string | undefined
  let tagEnd: string | undefined
  if ('tagStart' in operation.labeledArgs && operation.labeledArgs.tagStart) {
    tagStart = retrieveTagDeclaratorFromOpArg(
      operation.labeledArgs.tagStart,
      kclManager.code
    )
  }
  if ('tagEnd' in operation.labeledArgs && operation.labeledArgs.tagEnd) {
    tagEnd = retrieveTagDeclaratorFromOpArg(
      operation.labeledArgs.tagEnd,
      kclManager.code
    )
  }

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Loft'] = {
    sketches,
    vDegree,
    bezApproximateRational,
    baseCurveIndex,
    tagStart,
    tagEnd,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }
  return {
    ...baseCommand,
    argDefaultValues,
  }
}

/**
 * Gather up the argument values for the Chamfer command
 * to be used in the command bar edit flow.
 */
const prepareToEditFillet: PrepareToEditCallback = async ({ operation }) => {
  const baseCommand = {
    name: 'Fillet',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  // 1. Map the unlabeled and faces arguments to solid2d selections
  if (!operation.unlabeledArg || !operation.labeledArgs?.tags) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const selection = retrieveEdgeSelectionsFromOpArgs(
    operation.labeledArgs.tags,
    kclManager.artifactGraph
  )
  if (err(selection)) return { reason: selection.message }

  // 2. Convert the radius argument from a string to a KCL expression
  const radius = await extractKclArgument(operation, 'radius')
  if ('error' in radius) return { reason: radius.error }

  const tag = extractStringArgument(operation, 'tag')

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Fillet'] = {
    selection,
    radius,
    tag,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }
  return {
    ...baseCommand,
    argDefaultValues,
  }
}

/**
 * Gather up the argument values for the Chamfer command
 * to be used in the command bar edit flow.
 */
const prepareToEditChamfer: PrepareToEditCallback = async ({ operation }) => {
  const baseCommand = {
    name: 'Chamfer',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  // 1. Map the unlabeled and faces arguments to solid2d selections
  if (!operation.unlabeledArg || !operation.labeledArgs?.tags) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const selection = retrieveEdgeSelectionsFromOpArgs(
    operation.labeledArgs.tags,
    kclManager.artifactGraph
  )
  if (err(selection)) return { reason: selection.message }

  // 2. Convert the length argument from a string to a KCL expression
  const length = await extractKclArgument(operation, 'length')
  if ('error' in length) return { reason: length.error }

  const optionalArgs = await Promise.all([
    extractKclArgument(operation, 'secondLength'),
    extractKclArgument(operation, 'angle'),
  ])

  const [secondLength, angle] = optionalArgs.map((arg) =>
    'error' in arg ? undefined : arg
  )

  const tag = extractStringArgument(operation, 'tag')

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Chamfer'] = {
    selection,
    length,
    secondLength,
    angle,
    tag,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
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
    kclManager.code.slice(
      operation.labeledArgs?.thickness?.sourceRange[0],
      operation.labeledArgs?.thickness?.sourceRange[1]
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

/**
 * Gather up the argument values for the Hole command
 * to be used in the command bar edit flow.
 */
const prepareToEditHole: PrepareToEditCallback = async ({ operation }) => {
  const baseCommand = {
    name: 'Hole',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  // 1. Map the unlabeled face arguments to solid2d selections
  if (!operation.unlabeledArg || !operation.labeledArgs?.face) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const result = retrieveFaceSelectionsFromOpArgs(
    operation.unlabeledArg,
    operation.labeledArgs.face,
    kclManager.artifactGraph
  )
  if (err(result)) return { reason: result.message }
  const { faces: face } = result

  // 2.1 Convert the required arg from string to KclExpression
  const isArray = true
  const cutAt = await extractKclArgument(operation, 'cutAt', isArray)
  if ('error' in cutAt) return { reason: cutAt.error }

  // 2.2 Handle the holeBody required 'mode' arg and its related optional args
  const body = await retrieveHoleBodyArgs(operation.labeledArgs?.holeBody)
  if (err(body)) return { reason: body.message }
  const { holeBody, blindDepth, blindDiameter } = body

  // 2.3 Handle the holeBottom required 'mode' arg and its related optional args
  const bottom = await retrieveHoleBottomArgs(operation.labeledArgs?.holeBottom)
  if (err(bottom)) return { reason: bottom.message }
  const { holeBottom, drillPointAngle } = bottom

  // 2.3 Handle the holeType required 'mode' arg and its related optional args
  const rType = await retrieveHoleTypeArgs(operation.labeledArgs?.holeType)
  if (err(rType)) return { reason: rType.message }
  const {
    holeType,
    counterboreDepth,
    counterboreDiameter,
    countersinkAngle,
    countersinkDiameter,
  } = rType

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Hole'] = {
    face,
    cutAt,
    holeType,
    counterboreDepth,
    counterboreDiameter,
    countersinkAngle,
    countersinkDiameter,
    holeBody,
    blindDiameter,
    blindDepth,
    holeBottom,
    drillPointAngle,
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
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  // 1. Map the plane and faces arguments to plane or face selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  let plane: Selections | undefined
  const maybeDefaultPlaneName = getStringValue(
    kclManager.code,
    operation.unlabeledArg.sourceRange
  )
  if (isDefaultPlaneStr(maybeDefaultPlaneName)) {
    const id = rustContext.getDefaultPlaneId(maybeDefaultPlaneName)
    if (err(id)) {
      return { reason: "Couldn't retrieve default plane ID" }
    }

    plane = {
      graphSelections: [],
      otherSelections: [{ id, name: maybeDefaultPlaneName }],
    }
  } else {
    const result = retrieveNonDefaultPlaneSelectionFromOpArg(
      operation.unlabeledArg,
      kclManager.artifactGraph
    )
    if (err(result)) {
      return { reason: result.message }
    }
    plane = result
  }

  // 2. Convert the offset argument from a string to a KCL expression
  const offset = await stringToKclExpression(
    kclManager.code.slice(
      operation.labeledArgs?.offset?.sourceRange[0],
      operation.labeledArgs?.offset?.sourceRange[1]
    )
  )
  if (err(offset) || 'errors' in offset) {
    return { reason: "Couldn't retrieve thickness argument" }
  }

  // Assemble the default argument values for the Offset Plane command,
  // with `nodeToEdit` set, which will let the Offset Plane actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Offset plane'] = {
    plane,
    offset,
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
      kclManager.code.slice(
        operation.labeledArgs.sectional.sourceRange[0],
        operation.labeledArgs.sectional.sourceRange[1]
      ) === 'true'
  }

  let relativeTo: SweepRelativeTo | undefined
  if (
    'relativeTo' in operation.labeledArgs &&
    operation.labeledArgs.relativeTo
  ) {
    const result = kclManager.code.slice(
      operation.labeledArgs.relativeTo.sourceRange[0],
      operation.labeledArgs.relativeTo.sourceRange[1]
    )
    if (result === `${SWEEP_MODULE}::${SWEEP_CONSTANTS.SKETCH_PLANE}`) {
      relativeTo = SWEEP_CONSTANTS.SKETCH_PLANE
    } else if (result === `${SWEEP_MODULE}::${SWEEP_CONSTANTS.TRAJECTORY}`) {
      relativeTo = SWEEP_CONSTANTS.TRAJECTORY
    } else {
      return { reason: "Couldn't retrieve relativeTo argument" }
    }
  }

  // tagStart and tagEng arguments
  let tagStart: string | undefined
  let tagEnd: string | undefined
  if ('tagStart' in operation.labeledArgs && operation.labeledArgs.tagStart) {
    tagStart = retrieveTagDeclaratorFromOpArg(
      operation.labeledArgs.tagStart,
      kclManager.code
    )
  }
  if ('tagEnd' in operation.labeledArgs && operation.labeledArgs.tagEnd) {
    tagEnd = retrieveTagDeclaratorFromOpArg(
      operation.labeledArgs.tagEnd,
      kclManager.code
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
    tagStart,
    tagEnd,
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
    kclManager.code.slice(
      operation.labeledArgs?.revolutions?.sourceRange[0],
      operation.labeledArgs?.revolutions?.sourceRange[1]
    )
  )
  if (err(revolutions) || 'errors' in revolutions) {
    return { reason: 'Errors found in revolutions argument' }
  }

  // angleStart kcl arg (required for all)
  const angleStart = await stringToKclExpression(
    kclManager.code.slice(
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
      kclManager.code.slice(
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
      kclManager.code.slice(
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
      kclManager.code.slice(
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
      ? kclManager.code.slice(
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
      kclManager.code.slice(
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
      kclManager.code.slice(
        operation.labeledArgs.bidirectionalAngle.sourceRange[0],
        operation.labeledArgs.bidirectionalAngle.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve bidirectionalAngle argument" }
    }

    bidirectionalAngle = result
  }

  // tagStart and tagEng arguments
  let tagStart: string | undefined
  let tagEnd: string | undefined
  if ('tagStart' in operation.labeledArgs && operation.labeledArgs.tagStart) {
    tagStart = retrieveTagDeclaratorFromOpArg(
      operation.labeledArgs.tagStart,
      kclManager.code
    )
  }
  if ('tagEnd' in operation.labeledArgs && operation.labeledArgs.tagEnd) {
    tagEnd = retrieveTagDeclaratorFromOpArg(
      operation.labeledArgs.tagEnd,
      kclManager.code
    )
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
    tagStart,
    tagEnd,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }
  return {
    ...baseCommand,
    argDefaultValues,
  }
}

/**
 * Gather up the argument values for the Pattern Circular 3D command
 * to be used in the command bar edit flow.
 */
const prepareToEditPatternCircular3d: PrepareToEditCallback = async ({
  operation,
}) => {
  const baseCommand = {
    name: 'Pattern Circular 3D',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  // 1. Map the unlabeled arguments to solid selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const solids = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    kclManager.artifactGraph
  )
  if (err(solids)) {
    return { reason: "Couldn't retrieve solids" }
  }

  // 2. Convert the instances argument from a string to a KCL expression
  const instancesArg = operation.labeledArgs?.['instances']
  if (!instancesArg || !instancesArg.sourceRange) {
    return { reason: 'Missing or invalid instances argument' }
  }

  const instances = await stringToKclExpression(
    kclManager.code.slice(
      instancesArg.sourceRange[0],
      instancesArg.sourceRange[1]
    )
  )
  if (err(instances) || 'errors' in instances) {
    return { reason: "Couldn't retrieve instances argument" }
  }

  // 3. Convert the axis argument from a string to a string value
  // Axis is configured as 'options' inputType, so it should be a string, not a KCL expression
  const axisArg = operation.labeledArgs?.['axis']
  if (!axisArg || !axisArg.sourceRange) {
    return { reason: 'Missing or invalid axis argument' }
  }

  const axisString = kclManager.code.slice(
    axisArg.sourceRange[0],
    axisArg.sourceRange[1]
  )
  if (!axisString) {
    return { reason: "Couldn't retrieve axis argument" }
  }

  // 4. Convert the center argument from a string to a KCL expression
  const centerArg = operation.labeledArgs?.['center']
  if (!centerArg || !centerArg.sourceRange) {
    return { reason: 'Missing or invalid center argument' }
  }

  const center = await stringToKclExpression(
    kclManager.code.slice(centerArg.sourceRange[0], centerArg.sourceRange[1]),
    true
  )
  if (err(center) || 'errors' in center) {
    return { reason: "Couldn't retrieve center argument" }
  }

  // 5. Convert optional arguments
  let arcDegrees: KclCommandValue | undefined
  if (
    'arcDegrees' in operation.labeledArgs &&
    operation.labeledArgs.arcDegrees
  ) {
    const result = await stringToKclExpression(
      kclManager.code.slice(
        operation.labeledArgs.arcDegrees.sourceRange[0],
        operation.labeledArgs.arcDegrees.sourceRange[1]
      )
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve arcDegrees argument" }
    }
    arcDegrees = result
  }

  let rotateDuplicates: boolean | undefined
  if (
    'rotateDuplicates' in operation.labeledArgs &&
    operation.labeledArgs.rotateDuplicates
  ) {
    rotateDuplicates =
      kclManager.code.slice(
        operation.labeledArgs.rotateDuplicates.sourceRange[0],
        operation.labeledArgs.rotateDuplicates.sourceRange[1]
      ) === 'true'
  }

  let useOriginal: boolean | undefined
  if (
    'useOriginal' in operation.labeledArgs &&
    operation.labeledArgs.useOriginal
  ) {
    useOriginal =
      kclManager.code.slice(
        operation.labeledArgs.useOriginal.sourceRange[0],
        operation.labeledArgs.useOriginal.sourceRange[1]
      ) === 'true'
  }

  // 6. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Pattern Circular 3D'] = {
    solids,
    instances,
    axis: axisString,
    center,
    arcDegrees,
    rotateDuplicates,
    useOriginal,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }
  return {
    ...baseCommand,
    argDefaultValues,
  }
}

/**
 * Gather up the argument values for the Pattern Linear 3D command
 * to be used in the command bar edit flow.
 */
const prepareToEditPatternLinear3d: PrepareToEditCallback = async ({
  operation,
}) => {
  const baseCommand = {
    name: 'Pattern Linear 3D',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  // 1. Map the unlabeled arguments to solid selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const solids = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    kclManager.artifactGraph
  )
  if (err(solids)) {
    return { reason: "Couldn't retrieve solids" }
  }

  // 2. Convert the instances argument from a string to a KCL expression
  const instancesArg = operation.labeledArgs?.['instances']
  if (!instancesArg || !instancesArg.sourceRange) {
    return { reason: 'Missing or invalid instances argument' }
  }

  const instances = await stringToKclExpression(
    kclManager.code.slice(
      instancesArg.sourceRange[0],
      instancesArg.sourceRange[1]
    )
  )
  if (err(instances) || 'errors' in instances) {
    return { reason: "Couldn't retrieve instances argument" }
  }

  // 3. Convert the distance argument from a string to a KCL expression
  const distanceArg = operation.labeledArgs?.['distance']
  if (!distanceArg || !distanceArg.sourceRange) {
    return { reason: 'Missing or invalid distance argument' }
  }

  const distance = await stringToKclExpression(
    kclManager.code.slice(
      distanceArg.sourceRange[0],
      distanceArg.sourceRange[1]
    )
  )
  if (err(distance) || 'errors' in distance) {
    return { reason: "Couldn't retrieve distance argument" }
  }

  // 4. Convert the axis argument from a string to a string value
  // Axis is configured as 'options' inputType, so it should be a string, not a KCL expression
  const axisArg = operation.labeledArgs?.['axis']
  if (!axisArg || !axisArg.sourceRange) {
    return { reason: 'Missing or invalid axis argument' }
  }

  const axisString = kclManager.code.slice(
    axisArg.sourceRange[0],
    axisArg.sourceRange[1]
  )
  if (!axisString) {
    return { reason: "Couldn't retrieve axis argument" }
  }

  // 5. Convert the useOriginal argument from a string to a boolean
  const useOriginalArg = operation.labeledArgs?.['useOriginal']
  let useOriginal: boolean | undefined
  if (useOriginalArg && useOriginalArg.sourceRange) {
    const useOriginalString = kclManager.code.slice(
      useOriginalArg.sourceRange[0],
      useOriginalArg.sourceRange[1]
    )
    useOriginal = useOriginalString === 'true'
  }

  // 6. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Pattern Linear 3D'] = {
    solids,
    instances,
    distance,
    axis: axisString,
    useOriginal,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }
  return {
    ...baseCommand,
    argDefaultValues,
  }
}

/**
 * Prepares GDT Flatness annotations for editing.
 *
 * Supports following types of face selections through direct tagging:
 * - Segment faces: Tagged directly on sketch segments (e.g., from line(), arc())
 * - Cap faces: Tagged directly on sweep expressions using tagEnd/tagStart
 * GDT uses explicit tagging for predictable face references.
 */
const prepareToEditGdtFlatness: PrepareToEditCallback = async ({
  operation,
}) => {
  const baseCommand = {
    name: 'GDT Flatness',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  const facesArg = operation.labeledArgs?.['faces']
  if (!facesArg || !facesArg.sourceRange) {
    return { reason: 'Missing or invalid faces argument' }
  }

  // Extract face selections
  const graphSelections = extractFaceSelections(facesArg)
  if ('error' in graphSelections) {
    return { reason: graphSelections.error }
  }

  const faces = { graphSelections, otherSelections: [] }

  const tolerance = await extractKclArgument(operation, 'tolerance')
  if ('error' in tolerance) {
    return { reason: tolerance.error }
  }
  const optionalArgs = await Promise.all([
    extractKclArgument(operation, 'precision'),
    extractKclArgument(operation, 'framePosition', true),
    extractKclArgument(operation, 'fontPointSize'),
    extractKclArgument(operation, 'fontScale'),
  ])

  const [precision, framePosition, fontPointSize, fontScale] = optionalArgs.map(
    (arg) => ('error' in arg ? undefined : arg)
  )

  const framePlane = extractStringArgument(operation, 'framePlane')

  const argDefaultValues: ModelingCommandSchema['GDT Flatness'] = {
    faces,
    tolerance,
    precision,
    framePosition,
    framePlane,
    fontPointSize,
    fontScale,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditGdtDatum: PrepareToEditCallback = async ({ operation }) => {
  const baseCommand = {
    name: 'GDT Datum',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  const faceArg = operation.labeledArgs?.['face']
  if (!faceArg || !faceArg.sourceRange) {
    return { reason: 'Missing or invalid face argument' }
  }

  // Extract face selections (datum uses single face)
  const graphSelections = extractFaceSelections(faceArg)
  if ('error' in graphSelections) {
    return { reason: graphSelections.error }
  }

  const faces = { graphSelections, otherSelections: [] }

  // Extract name argument as a plain string (strip quotes if present)
  const nameRaw = extractStringArgument(operation, 'name')
  const name = stripQuotes(nameRaw)

  // Extract optional parameters
  const optionalArgs = await Promise.all([
    extractKclArgument(operation, 'framePosition', true),
    extractKclArgument(operation, 'fontPointSize'),
    extractKclArgument(operation, 'fontScale'),
  ])

  const [framePosition, fontPointSize, fontScale] = optionalArgs.map((arg) =>
    'error' in arg ? undefined : arg
  )

  const framePlane = extractStringArgument(operation, 'framePlane')

  const argDefaultValues: ModelingCommandSchema['GDT Datum'] = {
    faces,
    name,
    framePosition,
    framePlane,
    fontPointSize,
    fontScale,
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
    prepareToEdit: prepareToEditChamfer,
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
    prepareToEdit: prepareToEditFillet,
  },
  'gdt::datum': {
    label: 'Datum',
    icon: 'gdtDatum',
    prepareToEdit: prepareToEditGdtDatum,
  },
  'gdt::flatness': {
    label: 'Flatness',
    icon: 'gdtFlatness',
    prepareToEdit: prepareToEditGdtFlatness,
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
    prepareToEdit: prepareToEditPatternCircular3d,
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
    prepareToEdit: prepareToEditPatternLinear3d,
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
  'hole::hole': {
    label: 'Hole',
    icon: 'hole',
    prepareToEdit: prepareToEditHole,
    supportsAppearance: false,
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

type NestedOpList = (Operation | Operation[])[]

/**
 * Given an operations list, group streaks of provided types
 * into arrays if they are of a given minimum length
 */
export function groupOperationTypeStreaks(
  opList: Operation[],
  typesToGroup: Operation['type'][],
  minLength = 5
): NestedOpList {
  const result: NestedOpList = []

  let currentType: Operation['type'] | null = null
  let currentStreak: Operation[] = []

  const flushStreak = () => {
    if (currentStreak.length === 0) return
    const shouldGroup =
      currentType !== null &&
      typesToGroup.includes(currentType) &&
      currentStreak.length >= minLength
    if (shouldGroup) {
      result.push([...currentStreak])
    } else {
      for (const op of currentStreak) result.push(op)
    }
    currentStreak = []
    currentType = null
  }

  for (const op of opList) {
    if (currentType === null) {
      currentType = op.type
      currentStreak.push(op)
      continue
    }
    if (op.type === currentType) {
      currentStreak.push(op)
    } else {
      // Type changed; flush the previous streak and start anew
      flushStreak()
      currentType = op.type
      currentStreak.push(op)
    }
  }

  // Flush any remaining streak
  flushStreak()

  return result
}

/**
 * Return a more human-readable operation type label
 */
export function getOpTypeLabel(opType: Operation['type']): string {
  switch (opType) {
    case 'StdLibCall':
      return 'Operation'
    case 'VariableDeclaration':
      return 'Parameter'
    default:
      return 'Function'
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
      if (op.group.type === 'FunctionCall') {
        return 'function'
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
 * Return a display-ready version of the calculate operation value
 */
export function getOperationCalculatedDisplay(op: OpKclValue): string {
  switch (op.type) {
    case 'Array':
      return op.value.map(getOperationCalculatedDisplay).join(', ')
    case 'Object':
      return JSON.stringify(op.value)
    case 'TagIdentifier':
      return op.value
    case 'TagDeclarator':
      return op.name
    case 'SketchVar':
      return op.value.toPrecision(5)
    case 'String':
      return op.value
    case 'Bool':
      return String(op.value)
    case 'Number':
      return op.value.toPrecision(5)
    default:
      return op.type
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

  // Handle GDT operations - they don't have variable names as they're standalone statements
  if (op.type === 'StdLibCall' && op.name.startsWith('gdt::')) {
    return undefined
  }

  if (
    op.type !== 'StdLibCall' &&
    !(op.type === 'GroupBegin' && op.group.type === 'FunctionCall') &&
    !(op.type === 'GroupBegin' && op.group.type === 'ModuleInstance')
  ) {
    return undefined
  }
  if (program.body.length === 0) {
    // No program body, no variable name
    return undefined
  }

  // Find the AST node.
  const pathToNode = pathToNodeFromRustNodePath(op.nodePath)
  if (pathToNode.length === 0) {
    return undefined
  }

  // If this is a module instance, the variable name is the import alias.
  if (op.type === 'GroupBegin' && op.group.type === 'ModuleInstance') {
    const statement = getNodeFromPath<ImportStatement>(
      program,
      pathToNode,
      'ImportStatement'
    )
    if (
      err(statement) ||
      statement.node.type !== 'ImportStatement' ||
      statement.node.selector.type !== 'None' ||
      !statement.node.selector.alias
    ) {
      return undefined
    }

    return statement.node.selector.alias.name
  }

  // Otherwise, this is a StdLibCall or a function call and we need to find the node then the variable
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
      kclManager.code.slice(
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
      kclManager.code.slice(
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
      kclManager.code.slice(
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
      kclManager.code.slice(
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
  let factor: KclCommandValue | undefined = undefined
  let global: boolean | undefined
  if (operation.labeledArgs.x) {
    const res = await extractKclArgument(operation, 'x')
    if ('error' in res) return { reason: res.error }
    x = res
  }
  if (operation.labeledArgs.y) {
    const res = await extractKclArgument(operation, 'y')
    if ('error' in res) return { reason: res.error }
    y = res
  }
  if (operation.labeledArgs.z) {
    const res = await extractKclArgument(operation, 'z')
    if ('error' in res) return { reason: res.error }
    z = res
  }
  if (operation.labeledArgs.factor) {
    const res = await extractKclArgument(operation, 'factor')
    if ('error' in res) return { reason: res.error }
    factor = res
  }
  if (operation.labeledArgs.global) {
    global =
      kclManager.code.slice(
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
    factor,
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
    return { reason: objects.message }
  }

  // 2. Convert the x y z arguments from a string to a KCL expression
  let roll: KclCommandValue | undefined = undefined
  let pitch: KclCommandValue | undefined = undefined
  let yaw: KclCommandValue | undefined = undefined
  let global: boolean | undefined
  if (operation.labeledArgs.roll) {
    const result = await stringToKclExpression(
      kclManager.code.slice(
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
      kclManager.code.slice(
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
      kclManager.code.slice(
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
      kclManager.code.slice(
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
    kclManager.code,
    operation.labeledArgs.color.sourceRange
  )

  let metalness: KclCommandValue | undefined
  if (operation.labeledArgs.metalness) {
    const result = await stringToKclExpression(
      kclManager.code.slice(
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
      kclManager.code.slice(
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
