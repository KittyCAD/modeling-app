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
  retrieveBodyTypeFromOpArg,
  retrieveTagDeclaratorFromOpArg,
  SWEEP_CONSTANTS,
  SWEEP_MODULE,
  type SweepRelativeTo,
} from '@src/lang/modifyAst/sweeps'
import {
  artifactToEntityRef,
  findOperationArtifact,
  getNodeFromPath,
  getVariableNameFromNodePath,
  retrieveSelectionsFromOpArg,
} from '@src/lang/queryAst'
import type { StdLibCallOp } from '@src/lang/queryAst'
import type { Artifact, CodeRef } from '@src/lang/std/artifactGraph'
import {
  getArtifactOfTypes,
  getCodeRefsByArtifactId,
  getCommonFacesForEdge,
  getEdgeCutConsumedCodeRef,
  getSegmentForEdgeCut,
} from '@src/lang/std/artifactGraph'
import {
  type Program,
  type ArtifactGraph,
  pathToNodeFromRustNodePath,
} from '@src/lang/wasm'
import type {
  HelixModes,
  ModelingCommandSchema,
} from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclCommandValue, KclExpression } from '@src/lib/commandTypes'
import { getStringValue, stringToKclExpression } from '@src/lib/kclHelpers'
import { isDefaultPlaneStr } from '@src/lib/planes'
import { isArray, isNonNullable, stripQuotes } from '@src/lib/utils'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import type RustContext from '@src/lib/rustContext'
import { err } from '@src/lib/trap'
import type { CommandBarMachineEvent } from '@src/machines/commandBarMachine'
import {
  retrieveEdgeSelectionsFromEdgeRefs,
  retrieveEdgeSelectionsFromOpArgs,
} from '@src/lang/modifyAst/edges'
import {
  type KclPreludeBodyType,
  KCL_PRELUDE_EXTRUDE_METHOD_MERGE,
  KCL_PRELUDE_EXTRUDE_METHOD_NEW,
  type KclPreludeExtrudeMethod,
  EXECUTION_TYPE_REAL,
} from '@src/lib/constants'
import { toUtf16 } from '@src/lang/errors'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { ActorRefFrom } from 'xstate'
import {
  deleteTermFromUnlabeledArgumentArray,
  deleteTopLevelStatement,
} from '@src/lang/modifyAst'
import type { KclManager } from '@src/lang/KclManager'
import { updateModelingState } from '@src/lang/modelingWorkflows'

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
  code: string,
  operation: StdLibCallOp,
  argName: string,
  rustContext: RustContext,
  isArray?: boolean
): Promise<KclCommandValue | { error: string }> {
  const arg = operation.labeledArgs?.[argName]
  if (!arg?.sourceRange) {
    return { error: `Missing or invalid ${argName} argument` }
  }

  const result = await stringToKclExpression(
    code.slice(...arg.sourceRange.map((r) => toUtf16(r, code))),
    rustContext,
    { allowArrays: isArray }
  )

  if (err(result) || 'errors' in result) {
    return { error: `Failed to parse ${argName} argument as KCL expression` }
  }

  return result
}

/** Face selection with artifact + codeRef before mapping to SelectionV2 (entityRef + codeRef). */
type FaceSelectionWithArtifact = { artifact: Artifact; codeRef: CodeRef }

/**
 * Extracts face selections for GDT annotations.
 *
 * Handles following types of face selections through direct tagging:
 * - Segment faces: Tagged directly on segments, converted to wall artifacts
 * - Cap faces: Tagged directly on sweeps using tagEnd/tagStart
 * GDT uses direct tagging for explicit face references.
 */
function extractFaceSelections(
  artifactGraph: ArtifactGraph,
  facesArg: any
): FaceSelectionWithArtifact[] | { error: string } {
  const faceValues: any[] =
    facesArg.value.type === 'Array' ? facesArg.value.value : [facesArg.value]

  const graphSelections: FaceSelectionWithArtifact[] = []

  for (const v of faceValues) {
    if (v.type !== 'TagIdentifier' || !v.artifact_id) {
      continue
    }

    const artifact = artifactGraph.get(v.artifact_id)
    if (!artifact) {
      continue
    }

    let targetArtifact = artifact
    let targetCodeRefs = getCodeRefsByArtifactId(v.artifact_id, artifactGraph)

    // Handle segment faces: Convert segment artifacts to wall artifacts for 3D operations
    if (artifact.type === 'segment') {
      const wallArtifact = Array.from(artifactGraph.values()).find(
        (candidate) =>
          candidate.type === 'wall' && candidate.segId === artifact.id
      )

      if (wallArtifact) {
        targetArtifact = wallArtifact
        const wallCodeRefs = getCodeRefsByArtifactId(
          wallArtifact.id,
          artifactGraph
        )

        if (wallCodeRefs && wallCodeRefs.length > 0) {
          targetCodeRefs = wallCodeRefs
        } else {
          const segArtifact = getArtifactOfTypes(
            { key: artifact.id, types: ['segment'] },
            artifactGraph
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
  code: string,
  operation: StdLibCallOp,
  argName: string
): string | undefined {
  const arg = operation.labeledArgs?.[argName]
  return arg?.sourceRange
    ? code.slice(...arg.sourceRange.map((r) => toUtf16(r, code)))
    : undefined
}

/**
 * Gather up the a Parameter operation's data
 * to be used in the command bar edit flow.
 */
const prepareToEditParameter: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  if (operation.type !== 'VariableDeclaration') {
    return { reason: 'Called on something not a variable declaration' }
  }

  const baseCommand = {
    name: 'parameter.edit',
    groupId: 'code',
  }

  // 1. Convert from the parameter's Operation to a KCL-type arg value
  const value = await stringToKclExpression(
    code.slice(...operation.sourceRange.map((r) => toUtf16(r, code))),
    rustContext
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
const prepareToEditExtrude: PrepareToEditCallback = async ({
  operation,
  rustContext,
  artifactGraph,
  code,
}) => {
  /** Version of `toUtf16` bound to our code, for mapping source range values. */
  const boundToUtf16 = (n: number) => toUtf16(n, code)
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
    artifactGraph
  )
  if (err(sketches)) {
    return { reason: "Couldn't retrieve sketches" }
  }

  // 2. Convert the length argument from a string to a KCL expression
  let length: KclCommandValue | undefined
  if ('length' in operation.labeledArgs && operation.labeledArgs.length) {
    const result = await stringToKclExpression(
      code.slice(...operation.labeledArgs.length.sourceRange.map(boundToUtf16)),
      rustContext
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve length argument" }
    }

    length = result
  }

  let to: Selections | undefined
  if ('to' in operation.labeledArgs && operation.labeledArgs.to) {
    const graphSelections = extractFaceSelections(
      artifactGraph,
      operation.labeledArgs.to
    )
    if ('error' in graphSelections) return { reason: graphSelections.error }
    to = {
      graphSelections: graphSelections.map((s) =>
        s.artifact
          ? {
              entityRef: artifactToEntityRef(s.artifact.type, s.artifact.id),
              codeRef: s.codeRef,
            }
          : { codeRef: s.codeRef }
      ),
      otherSelections: [],
    }
  }

  // symmetric argument from a string to boolean
  let symmetric: boolean | undefined
  if ('symmetric' in operation.labeledArgs && operation.labeledArgs.symmetric) {
    symmetric =
      code.slice(
        ...operation.labeledArgs.symmetric.sourceRange.map(boundToUtf16)
      ) === 'true'
  }

  // bidirectionalLength argument from a string to a KCL expression
  let bidirectionalLength: KclCommandValue | undefined
  if (
    'bidirectionalLength' in operation.labeledArgs &&
    operation.labeledArgs.bidirectionalLength
  ) {
    const result = await stringToKclExpression(
      code.slice(
        ...operation.labeledArgs.bidirectionalLength.sourceRange.map(
          boundToUtf16
        )
      ),
      rustContext
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
      code
    )
  }
  if ('tagEnd' in operation.labeledArgs && operation.labeledArgs.tagEnd) {
    tagEnd = retrieveTagDeclaratorFromOpArg(operation.labeledArgs.tagEnd, code)
  }

  // twistAngle argument from a string to a KCL expression
  let twistAngle: KclCommandValue | undefined
  if (
    'twistAngle' in operation.labeledArgs &&
    operation.labeledArgs.twistAngle
  ) {
    const result = await stringToKclExpression(
      code.slice(
        ...operation.labeledArgs.twistAngle.sourceRange.map(boundToUtf16)
      ),
      rustContext
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
      code.slice(
        ...operation.labeledArgs.twistAngleStep.sourceRange.map(boundToUtf16)
      ),
      rustContext
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve twistAngleStep argument" }
    }

    twistAngleStep = result
  }

  // twistCenter argument from a Point2d to two KCL expression
  const twistCenterResult = await extractKclArgument(
    code,
    operation,
    'twistCenter',
    rustContext,
    true
  )
  const twistCenter: KclCommandValue | undefined =
    'error' in twistCenterResult ? undefined : twistCenterResult

  // method argument from a string to boolean
  let method: KclPreludeExtrudeMethod | undefined
  if ('method' in operation.labeledArgs && operation.labeledArgs.method) {
    const result = code.slice(
      ...operation.labeledArgs.method.sourceRange.map(boundToUtf16)
    )
    if (result === KCL_PRELUDE_EXTRUDE_METHOD_MERGE) {
      method = KCL_PRELUDE_EXTRUDE_METHOD_MERGE
    } else if (result === KCL_PRELUDE_EXTRUDE_METHOD_NEW) {
      method = KCL_PRELUDE_EXTRUDE_METHOD_NEW
    } else {
      return { reason: "Couldn't retrieve method argument" }
    }
  }

  // hideSeams argument from a string to boolean
  let hideSeams: boolean | undefined
  if ('hideSeams' in operation.labeledArgs && operation.labeledArgs.hideSeams) {
    hideSeams =
      code.slice(
        ...operation.labeledArgs.hideSeams.sourceRange.map(boundToUtf16)
      ) === 'true'
  }

  // bodyType argument from a string
  let bodyType: KclPreludeBodyType | undefined
  if ('bodyType' in operation.labeledArgs && operation.labeledArgs.bodyType) {
    const res = retrieveBodyTypeFromOpArg(operation.labeledArgs.bodyType, code)
    if (err(res)) return { reason: res.message }
    bodyType = res
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
    hideSeams,
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
const prepareToEditLoft: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
  artifactGraph,
}) => {
  const baseCommand = {
    name: 'Loft',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  /** Version of `toUtf16` bound to our code, for mapping source range values. */
  const boundToUtf16 = (n: number) => toUtf16(n, code)

  // 1. Map the unlabeled arguments to solid2d selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const sketches = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    artifactGraph
  )
  if (err(sketches)) {
    return { reason: "Couldn't retrieve sketches" }
  }

  // 2.
  // vDegree argument from a string to a KCL expression
  let vDegree: KclCommandValue | undefined
  if ('vDegree' in operation.labeledArgs && operation.labeledArgs.vDegree) {
    const result = await stringToKclExpression(
      code.slice(
        ...operation.labeledArgs.vDegree.sourceRange.map(boundToUtf16)
      ),
      rustContext
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
      code.slice(
        ...operation.labeledArgs.bezApproximateRational.sourceRange.map(
          boundToUtf16
        )
      ) === 'true'
  }

  // baseCurveIndex argument from a string to a KCL expression
  let baseCurveIndex: KclCommandValue | undefined
  if (
    'baseCurveIndex' in operation.labeledArgs &&
    operation.labeledArgs.baseCurveIndex
  ) {
    const result = await stringToKclExpression(
      code.slice(
        ...operation.labeledArgs.baseCurveIndex.sourceRange.map(boundToUtf16)
      ),
      rustContext
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
      code
    )
  }
  if ('tagEnd' in operation.labeledArgs && operation.labeledArgs.tagEnd) {
    tagEnd = retrieveTagDeclaratorFromOpArg(operation.labeledArgs.tagEnd, code)
  }

  // bodyType argument from a string
  let bodyType: KclPreludeBodyType | undefined
  if ('bodyType' in operation.labeledArgs && operation.labeledArgs.bodyType) {
    const res = retrieveBodyTypeFromOpArg(operation.labeledArgs.bodyType, code)
    if (err(res)) return { reason: res.message }
    bodyType = res
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
    bodyType,
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
const prepareToEditFillet: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
  artifactGraph,
  artifact,
}) => {
  const baseCommand = {
    name: 'Fillet',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  // 1. Map the current edge arguments back into selections for the edit flow.
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  let selection: Selections | Error

  const buildSelectionFromArtifact = (): Selections | null => {
    if (
      !artifact ||
      (artifact.type !== 'edgeCut' && artifact.type !== 'segment')
    )
      return null
    const codeRefs = getCodeRefsByArtifactId(artifact.id, artifactGraph)
    if (!codeRefs?.length) return null
    const pathId =
      artifact.type === 'segment'
        ? (artifact as { pathId?: string }).pathId
        : undefined
    const entityRef = artifactToEntityRef(artifact.type, artifact.id, pathId)
    if (!entityRef) return null
    return {
      graphSelections: [{ entityRef, codeRef: codeRefs[0] }],
      otherSelections: [],
    }
  }

  // Try edges first (new API), then edgeRefs (backward compat)
  const edgesArg =
    operation.labeledArgs?.edges ?? operation.labeledArgs?.edgeRefs
  if (edgesArg) {
    selection = retrieveEdgeSelectionsFromEdgeRefs(edgesArg, artifactGraph)
  } else if (operation.labeledArgs?.tags) {
    selection = retrieveEdgeSelectionsFromOpArgs(
      operation.unlabeledArg,
      operation.labeledArgs.tags,
      artifactGraph,
      code
    )
  } else {
    const fromArtifact = buildSelectionFromArtifact()
    if (fromArtifact) selection = fromArtifact
    else {
      return {
        reason: `Couldn't retrieve operation arguments (missing tags or edges)`,
      }
    }
  }

  if (err(selection)) {
    return { reason: selection.message }
  }

  // Fallback: when op has edges/edgeRefs but tag names didn't resolve (no artifact_id), build edge
  // selection from edgeCut so addFillet keeps edges and correct faces (e.g. seg01, capStart001)
  if (
    selection.graphSelections.length === 0 &&
    (operation.labeledArgs?.edges ?? operation.labeledArgs?.edgeRefs) &&
    artifact?.type === 'edgeCut'
  ) {
    const segId = getSegmentForEdgeCut(artifact.id, artifactGraph)?.id
    if (segId) {
      const segResult = getArtifactOfTypes(
        { key: segId, types: ['segment'] },
        artifactGraph
      )
      if (!err(segResult)) {
        const commonFaces = getCommonFacesForEdge(segResult, artifactGraph)
        const codeRefResult = getEdgeCutConsumedCodeRef(artifact, artifactGraph)
        if (
          !err(commonFaces) &&
          commonFaces.length > 0 &&
          !err(codeRefResult)
        ) {
          const startCap = commonFaces.find(
            (f) =>
              f.type === 'cap' &&
              (f as { subType?: string }).subType?.toLowerCase() === 'start'
          )
          const faceIds = startCap
            ? [segResult.id, startCap.id]
            : commonFaces.slice(0, 2).map((face) => face.id)
          if (faceIds.length >= 2) {
            selection = {
              graphSelections: [
                {
                  entityRef: { type: 'edge', side_faces: faceIds },
                  codeRef: codeRefResult,
                },
              ],
              otherSelections: [],
            }
          }
        }
      }
    }
  }

  // Fallback: if tags/edges gave no selection but we have the fillet's edge artifact, use it
  if (!err(selection) && selection.graphSelections.length === 0) {
    const fromArtifact = buildSelectionFromArtifact()
    if (fromArtifact) selection = fromArtifact
  }

  // 2. Convert the radius argument from a string to a KCL expression
  const radius = await extractKclArgument(
    code,
    operation,
    'radius',
    rustContext
  )
  if ('error' in radius) {
    return { reason: radius.error }
  }

  const tag = extractStringArgument(code, operation, 'tag')

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  if (err(selection)) return { reason: selection.message }
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
const prepareToEditChamfer: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
  artifactGraph,
}) => {
  const baseCommand = {
    name: 'Chamfer',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  // 1. Map the current edge arguments back into selections for the edit flow.
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  let selection: Selections | Error
  const edgesArg =
    operation.labeledArgs?.edges ?? operation.labeledArgs?.edgeRefs
  if (edgesArg) {
    selection = retrieveEdgeSelectionsFromEdgeRefs(edgesArg, artifactGraph)
  } else if (operation.labeledArgs?.tags) {
    selection = retrieveEdgeSelectionsFromOpArgs(
      operation.unlabeledArg,
      operation.labeledArgs.tags,
      artifactGraph,
      code
    )
  } else {
    return {
      reason: `Couldn't retrieve operation arguments (missing tags or edges)`,
    }
  }
  if (err(selection)) return { reason: selection.message }

  // 2. Convert the length argument from a string to a KCL expression
  const length = await extractKclArgument(
    code,
    operation,
    'length',
    rustContext
  )
  if ('error' in length) return { reason: length.error }

  const optionalArgs = await Promise.all([
    extractKclArgument(code, operation, 'secondLength', rustContext),
    extractKclArgument(code, operation, 'angle', rustContext),
  ])

  const [secondLength, angle] = optionalArgs.map((arg) =>
    'error' in arg ? undefined : arg
  )

  const tag = extractStringArgument(code, operation, 'tag')

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
const prepareToEditShell: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
  artifactGraph,
}) => {
  const baseCommand = {
    name: 'Shell',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  /** Version of `toUtf16` bound to our code, for mapping source range values. */
  const boundToUtf16 = (n: number) => toUtf16(n, code)

  // 1. Map the unlabeled and faces arguments to solid2d selections
  if (!operation.unlabeledArg || !operation.labeledArgs?.faces) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const result = retrieveFaceSelectionsFromOpArgs(
    operation.unlabeledArg,
    operation.labeledArgs.faces,
    artifactGraph
  )
  if (err(result)) {
    return { reason: "Couldn't retrieve faces argument" }
  }

  const { faces } = result

  // 2. Convert the thickness argument from a string to a KCL expression
  if (
    !('thickness' in operation.labeledArgs && operation.labeledArgs.thickness)
  ) {
    return { reason: 'thickness is required' }
  }

  const thickness = await stringToKclExpression(
    code.slice(
      ...operation.labeledArgs.thickness.sourceRange.map(boundToUtf16)
    ),
    rustContext
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
const prepareToEditHole: PrepareToEditCallback = async ({
  operation,
  rustContext,
  artifactGraph,
  code,
}) => {
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
    artifactGraph
  )
  if (err(result)) return { reason: result.message }
  const { faces: face } = result

  // 2.1 Convert the required arg from string to KclExpression
  const isArray = true
  const cutAt = await extractKclArgument(
    code,
    operation,
    'cutAt',
    rustContext,
    isArray
  )
  if ('error' in cutAt) return { reason: cutAt.error }

  // 2.2 Handle the holeBody required 'mode' arg and its related optional args
  const body = await retrieveHoleBodyArgs(
    operation.labeledArgs?.holeBody,
    await rustContext.wasmInstancePromise,
    rustContext
  )
  if (err(body)) return { reason: body.message }
  const { holeBody, blindDepth, blindDiameter } = body

  // 2.3 Handle the holeBottom required 'mode' arg and its related optional args
  const bottom = await retrieveHoleBottomArgs(
    operation.labeledArgs?.holeBottom,
    await rustContext.wasmInstancePromise,
    rustContext
  )
  if (err(bottom)) return { reason: bottom.message }
  const { holeBottom, drillPointAngle } = bottom

  // 2.3 Handle the holeType required 'mode' arg and its related optional args
  const rType = await retrieveHoleTypeArgs(
    operation.labeledArgs?.holeType,
    await rustContext.wasmInstancePromise,
    rustContext
  )
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

/**
 * Gather up the argument values for the SketchSolve command
 * to be used in the command bar edit flow.
 */
const prepareToEditSketchSolve: PrepareToEditCallback = async ({
  operation,
  artifact,
}) => {
  if (operation.type !== 'SketchSolve') {
    return { reason: 'Wrong operation type' }
  }

  if (!artifact) {
    return {
      reason:
        'No artifact found for this sketch. Please select the sketch in the feature tree.',
    }
  }

  if (artifact.type !== 'sketchBlock') {
    return {
      reason: 'Artifact is not a sketchBlock. Cannot edit this sketch.',
    }
  }

  if (typeof artifact.sketchId !== 'number') {
    return {
      reason:
        'SketchBlock does not have a valid sketchId. Cannot edit this sketch.',
    }
  }

  const command = {
    name: 'Enter sketch',
    groupId: 'modeling',
  }

  // Return 'Enter sketch' command - the modeling machine will detect the sketchBlock
  // in the selection and route to 'animating to existing sketch solve' automatically
  return command
}

const prepareToEditOffsetPlane: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
  artifactGraph,
}) => {
  const baseCommand = {
    name: 'Offset plane',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  /** Version of `toUtf16` bound to our code, for mapping source range values. */
  const boundToUtf16 = (n: number) => toUtf16(n, code)

  // 1. Map the plane and faces arguments to plane or face selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  let plane: Selections | undefined
  const maybeDefaultPlaneName = getStringValue(
    code,
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
      artifactGraph
    )
    if (err(result)) {
      return { reason: result.message }
    }
    plane = result
  }

  // 2. Convert the offset argument from a string to a KCL expression
  if (!operation.labeledArgs?.offset) {
    return { reason: 'Missing or invalid instances argument' }
  }
  const offset = await stringToKclExpression(
    code.slice(...operation.labeledArgs.offset.sourceRange.map(boundToUtf16)),
    rustContext
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
const prepareToEditSweep: PrepareToEditCallback = async ({
  operation,
  code,
  artifactGraph,
}) => {
  const baseCommand = {
    name: 'Sweep',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  /** Version of `toUtf16` bound to our code, for mapping source range values. */
  const boundToUtf16 = (n: number) => toUtf16(n, code)

  // 1. Map the unlabeled arguments to solid2d selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const sketches = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    artifactGraph
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
    artifactGraph
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
          artifactGraph
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
        entityRef: artifactToEntityRef(
          trajectoryArtifact.type,
          trajectoryArtifact.id
        ),
        codeRef: trajectoryArtifact.codeRef,
      },
    ],
    otherSelections: [],
  }

  // optional arguments
  let sectional: boolean | undefined
  if ('sectional' in operation.labeledArgs && operation.labeledArgs.sectional) {
    sectional =
      code.slice(
        ...operation.labeledArgs.sectional.sourceRange.map(boundToUtf16)
      ) === 'true'
  }

  let relativeTo: SweepRelativeTo | undefined
  if (
    'relativeTo' in operation.labeledArgs &&
    operation.labeledArgs.relativeTo
  ) {
    const result = code.slice(
      ...operation.labeledArgs.relativeTo.sourceRange.map(boundToUtf16)
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
      code
    )
  }
  if ('tagEnd' in operation.labeledArgs && operation.labeledArgs.tagEnd) {
    tagEnd = retrieveTagDeclaratorFromOpArg(operation.labeledArgs.tagEnd, code)
  }

  // bodyType argument from a string
  let bodyType: KclPreludeBodyType | undefined
  if ('bodyType' in operation.labeledArgs && operation.labeledArgs.bodyType) {
    const res = retrieveBodyTypeFromOpArg(operation.labeledArgs.bodyType, code)
    if (err(res)) return { reason: res.message }
    bodyType = res
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
    bodyType,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }
  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditHelix: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
  artifactGraph,
}) => {
  const baseCommand = {
    name: 'Helix',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall' || !operation.labeledArgs) {
    const reason = 'Wrong operation type or arguments'
    return { reason }
  }

  /** Version of `toUtf16` bound to our code, for mapping source range values. */
  const boundToUtf16 = (n: number) => toUtf16(n, code)

  // Flow arg
  let mode: HelixModes | undefined
  // Three different arguments depending on mode
  let axis: string | undefined
  let edge: Selections | undefined
  let cylinder: Selections | undefined
  // axis can be legacy (tag/axis) or an edge reference payload (object with sideFaces); edgeRef is legacy refactor name
  const axisArg = operation.labeledArgs?.axis
  const edgeRefArg =
    'edgeRef' in operation.labeledArgs
      ? operation.labeledArgs.edgeRef
      : undefined
  const axisIsEdgeRefPayload =
    axisArg?.value?.type === 'Object' &&
    (axisArg.value.value?.sideFaces ?? axisArg.value.value?.side_faces)
  const edgeRefPayload = axisIsEdgeRefPayload ? axisArg : edgeRefArg
  if (edgeRefPayload) {
    const { retrieveEdgeSelectionsFromSingleEdgeRef } = await import(
      '@src/lang/modifyAst/edges'
    )
    const edgeSelections = retrieveEdgeSelectionsFromSingleEdgeRef(
      edgeRefPayload,
      artifactGraph
    )
    if (err(edgeSelections)) {
      const reason = `Couldn't retrieve edge from axis/edgeRef: ${edgeSelections.message}`
      return { reason }
    }
    mode = 'Edge'
    edge = edgeSelections
  } else if (axisArg) {
    const axisEdgeSelection = retrieveAxisOrEdgeSelectionsFromOpArg(
      axisArg,
      artifactGraph
    )
    if (err(axisEdgeSelection)) {
      const reason = "Couldn't retrieve axis or edge selection"
      return { reason }
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
      artifactGraph
    )
    if (err(result)) {
      const reason = "Couldn't retrieve cylinder selection"
      return { reason }
    }

    mode = 'Cylinder'
    cylinder = result
  } else {
    const reason =
      "The axis or cylinder arguments couldn't be retrieved (helix may need Z0006 refactor first)."
    return { reason }
  }

  // revolutions kcl arg (required for all)
  const revolutions = await stringToKclExpression(
    code.slice(
      ...(operation.labeledArgs.revolutions?.sourceRange.map(boundToUtf16) ??
        [])
    ),
    rustContext
  )
  if (err(revolutions) || 'errors' in revolutions) {
    const reason = 'Errors found in revolutions argument'
    return { reason }
  }

  // angleStart kcl arg (required for all)
  const angleStart = await stringToKclExpression(
    code.slice(
      ...(operation.labeledArgs.angleStart?.sourceRange.map(boundToUtf16) ?? [])
    ),
    rustContext
  )
  if (err(angleStart) || 'errors' in angleStart) {
    const reason = 'Errors found in angleStart argument'
    return { reason }
  }

  // radius and cylinder and kcl arg (only for axis or edge)
  let radius: KclExpression | undefined // axis or edge modes only
  if ('radius' in operation.labeledArgs && operation.labeledArgs.radius) {
    const r = await stringToKclExpression(
      code.slice(...operation.labeledArgs.radius.sourceRange.map(boundToUtf16)),
      rustContext
    )
    if (err(r) || 'errors' in r) {
      const reason = 'Error in radius argument retrieval'
      return { reason }
    }

    radius = r
  }

  // length kcl arg (axis or edge modes only)
  let length: KclExpression | undefined
  if ('length' in operation.labeledArgs && operation.labeledArgs.length) {
    const r = await stringToKclExpression(
      code.slice(...operation.labeledArgs.length.sourceRange.map(boundToUtf16)),
      rustContext
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
      code.slice(...operation.labeledArgs.ccw.sourceRange.map(boundToUtf16)) ===
      'true'
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
  rustContext,
  artifactGraph,
  code,
}) => {
  const baseCommand = {
    name: 'Revolve',
    groupId: 'modeling',
  }
  if (!artifact || operation.type !== 'StdLibCall' || !operation.labeledArgs) {
    const reason = 'Wrong operation type or artifact'
    return { reason }
  }

  /** Version of `toUtf16` bound to our code, for mapping source range values. */
  const boundToUtf16 = (n: number) => toUtf16(n, code)

  // 1. Map the unlabeled arguments to solid2d selections
  if (!operation.unlabeledArg) {
    const reason = `Couldn't retrieve operation arguments`
    return { reason }
  }

  const sketches = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    artifactGraph
  )
  if (err(sketches)) {
    const reason = "Couldn't retrieve sketches"
    return { reason }
  }

  // 2. Prepare labeled arguments: axis (legacy or edge reference payload after Z0006 refactor)
  let axisOrEdge: 'Axis' | 'Edge'
  let axis: string | undefined
  let edge: Selections | undefined

  const axisArg = operation.labeledArgs?.axis
  const edgeRefArg =
    'edgeRef' in operation.labeledArgs
      ? operation.labeledArgs.edgeRef
      : undefined
  const axisIsEdgeRefPayload =
    axisArg?.value?.type === 'Object' &&
    (axisArg.value.value?.sideFaces ?? axisArg.value.value?.side_faces)
  const edgeRefPayload = axisIsEdgeRefPayload ? axisArg : edgeRefArg
  if (edgeRefPayload) {
    const { retrieveEdgeSelectionsFromSingleEdgeRef } = await import(
      '@src/lang/modifyAst/edges'
    )
    const edgeSelections = retrieveEdgeSelectionsFromSingleEdgeRef(
      edgeRefPayload,
      artifactGraph
    )
    if (err(edgeSelections)) {
      const reason = `Couldn't retrieve edge from axis/edgeRef: ${edgeSelections.message}`
      return { reason }
    }
    axisOrEdge = 'Edge'
    edge = edgeSelections
  } else if (axisArg) {
    const axisEdgeSelection = retrieveAxisOrEdgeSelectionsFromOpArg(
      axisArg,
      artifactGraph
    )
    if (err(axisEdgeSelection)) {
      const reason = "Couldn't retrieve axis or edge selections"
      return { reason }
    }
    axisOrEdge = axisEdgeSelection.axisOrEdge
    axis = axisEdgeSelection.axis
    edge = axisEdgeSelection.edge
  } else {
    const reason =
      "Couldn't find axis argument (revolve may need Z0006 refactor first)"
    return { reason }
  }

  // angle kcl arg
  // Default to '360' if not present
  const angle = await stringToKclExpression(
    'angle' in operation.labeledArgs && operation.labeledArgs.angle
      ? code.slice(...operation.labeledArgs.angle.sourceRange.map(boundToUtf16))
      : '360deg',
    rustContext
  )
  if (err(angle) || 'errors' in angle) {
    const reason = 'Error in angle argument retrieval'
    return { reason }
  }

  // symmetric argument from a string to boolean
  let symmetric: boolean | undefined
  if ('symmetric' in operation.labeledArgs && operation.labeledArgs.symmetric) {
    symmetric =
      code.slice(
        ...operation.labeledArgs.symmetric.sourceRange.map(boundToUtf16)
      ) === 'true'
  }

  // bidirectionalLength argument from a string to a KCL expression
  let bidirectionalAngle: KclCommandValue | undefined
  if (
    'bidirectionalAngle' in operation.labeledArgs &&
    operation.labeledArgs.bidirectionalAngle
  ) {
    const result = await stringToKclExpression(
      code.slice(
        ...operation.labeledArgs.bidirectionalAngle.sourceRange.map(
          boundToUtf16
        )
      ),
      rustContext
    )
    if (err(result) || 'errors' in result) {
      const reason = "Couldn't retrieve bidirectionalAngle argument"
      return { reason }
    }

    bidirectionalAngle = result
  }

  // tagStart and tagEng arguments
  let tagStart: string | undefined
  let tagEnd: string | undefined
  if ('tagStart' in operation.labeledArgs && operation.labeledArgs.tagStart) {
    tagStart = retrieveTagDeclaratorFromOpArg(
      operation.labeledArgs.tagStart,
      code
    )
  }
  if ('tagEnd' in operation.labeledArgs && operation.labeledArgs.tagEnd) {
    tagEnd = retrieveTagDeclaratorFromOpArg(operation.labeledArgs.tagEnd, code)
  }

  // bodyType argument from a string
  let bodyType: KclPreludeBodyType | undefined
  if ('bodyType' in operation.labeledArgs && operation.labeledArgs.bodyType) {
    const res = retrieveBodyTypeFromOpArg(operation.labeledArgs.bodyType, code)
    if (err(res)) return { reason: res.message }
    bodyType = res
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
    bodyType,
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
  rustContext,
  artifactGraph,
  code,
}) => {
  const baseCommand = {
    name: 'Pattern Circular 3D',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  /** Version of `toUtf16` bound to our code, for mapping source range values. */
  const boundToUtf16 = (n: number) => toUtf16(n, code)

  // 1. Map the unlabeled arguments to solid selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const solids = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    artifactGraph
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
    code.slice(...instancesArg.sourceRange.map(boundToUtf16)),
    rustContext
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

  const axisString = code.slice(...axisArg.sourceRange.map(boundToUtf16))
  if (!axisString) {
    return { reason: "Couldn't retrieve axis argument" }
  }

  // 4. Convert the center argument from a string to a KCL expression
  const centerArg = operation.labeledArgs?.['center']
  if (!centerArg || !centerArg.sourceRange) {
    return { reason: 'Missing or invalid center argument' }
  }

  const center = await stringToKclExpression(
    code.slice(...centerArg.sourceRange.map(boundToUtf16)),
    rustContext,
    { allowArrays: true }
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
      code.slice(
        ...operation.labeledArgs.arcDegrees.sourceRange.map(boundToUtf16)
      ),
      rustContext
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
      code.slice(
        ...operation.labeledArgs.rotateDuplicates.sourceRange.map(boundToUtf16)
      ) === 'true'
  }

  let useOriginal: boolean | undefined
  if (
    'useOriginal' in operation.labeledArgs &&
    operation.labeledArgs.useOriginal
  ) {
    useOriginal =
      code.slice(
        ...operation.labeledArgs.useOriginal.sourceRange.map(boundToUtf16)
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
  rustContext,
  code,
  artifactGraph,
}) => {
  const baseCommand = {
    name: 'Pattern Linear 3D',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  /** Version of `toUtf16` bound to our code, for mapping source range values. */
  const boundToUtf16 = (n: number) => toUtf16(n, code)

  // 1. Map the unlabeled arguments to solid selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const solids = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    artifactGraph
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
    code.slice(...instancesArg.sourceRange.map(boundToUtf16)),
    rustContext
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
    code.slice(...distanceArg.sourceRange.map((r) => toUtf16(r, code))),
    rustContext
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

  const axisString = code.slice(
    ...axisArg.sourceRange.map((r) => toUtf16(r, code))
  )
  if (!axisString) {
    return { reason: "Couldn't retrieve axis argument" }
  }

  // 5. Convert the useOriginal argument from a string to a boolean
  const useOriginalArg = operation.labeledArgs?.['useOriginal']
  let useOriginal: boolean | undefined
  if (useOriginalArg && useOriginalArg.sourceRange) {
    const useOriginalString = code.slice(
      ...useOriginalArg.sourceRange.map(boundToUtf16)
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
  rustContext,
  artifactGraph,
  code,
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
  const graphSelections = extractFaceSelections(artifactGraph, facesArg)
  if ('error' in graphSelections) {
    return { reason: graphSelections.error }
  }

  const faces = {
    graphSelections: graphSelections.map((s) =>
      s.artifact
        ? {
            entityRef: artifactToEntityRef(s.artifact.type, s.artifact.id),
            codeRef: s.codeRef,
          }
        : { codeRef: s.codeRef }
    ),
    otherSelections: [],
  }

  const tolerance = await extractKclArgument(
    code,
    operation,
    'tolerance',
    rustContext
  )
  if ('error' in tolerance) {
    return { reason: tolerance.error }
  }
  const optionalArgs = await Promise.all([
    extractKclArgument(code, operation, 'precision', rustContext),
    extractKclArgument(code, operation, 'framePosition', rustContext, true),
    extractKclArgument(code, operation, 'leaderScale', rustContext),
    extractKclArgument(code, operation, 'fontPointSize', rustContext),
    extractKclArgument(code, operation, 'fontScale', rustContext),
  ])

  const [precision, framePosition, leaderScale, fontPointSize, fontScale] =
    optionalArgs.map((arg) => ('error' in arg ? undefined : arg))

  const framePlane = extractStringArgument(code, operation, 'framePlane')

  const argDefaultValues: ModelingCommandSchema['GDT Flatness'] = {
    faces,
    tolerance,
    precision,
    framePosition,
    framePlane,
    leaderScale,
    fontPointSize,
    fontScale,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditGdtDatum: PrepareToEditCallback = async ({
  operation,
  rustContext,
  artifactGraph,
  code,
}) => {
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
  const graphSelections = extractFaceSelections(artifactGraph, faceArg)
  if ('error' in graphSelections) {
    return { reason: graphSelections.error }
  }

  const faces = {
    graphSelections: graphSelections.map((s) =>
      s.artifact
        ? {
            entityRef: artifactToEntityRef(s.artifact.type, s.artifact.id),
            codeRef: s.codeRef,
          }
        : { codeRef: s.codeRef }
    ),
    otherSelections: [],
  }

  // Extract name argument as a plain string (strip quotes if present)
  const nameRaw = extractStringArgument(code, operation, 'name')
  const name = stripQuotes(nameRaw)

  // Extract optional parameters
  const optionalArgs = await Promise.all([
    extractKclArgument(code, operation, 'framePosition', rustContext, true),
    extractKclArgument(code, operation, 'leaderScale', rustContext),
    extractKclArgument(code, operation, 'fontPointSize', rustContext),
    extractKclArgument(code, operation, 'fontScale', rustContext),
  ])

  const [framePosition, leaderScale, fontPointSize, fontScale] =
    optionalArgs.map((arg) => ('error' in arg ? undefined : arg))

  const framePlane = extractStringArgument(code, operation, 'framePlane')

  const argDefaultValues: ModelingCommandSchema['GDT Datum'] = {
    faces,
    name,
    framePosition,
    framePlane,
    leaderScale,
    fontPointSize,
    fontScale,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditSplit: PrepareToEditCallback = async ({
  operation,
  artifactGraph,
  code,
}) => {
  const baseCommand = {
    name: 'Boolean Split',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  if (!operation.unlabeledArg) {
    return { reason: "Couldn't retrieve operation arguments" }
  }

  const targets = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    artifactGraph
  )
  if (err(targets)) {
    return { reason: "Couldn't retrieve targets" }
  }

  let tools: Selections | undefined
  const toolsArg = operation.labeledArgs?.tools
  if (toolsArg) {
    const toolsResult = retrieveSelectionsFromOpArg(toolsArg, artifactGraph)
    if (err(toolsResult)) {
      return { reason: "Couldn't retrieve tools" }
    }
    tools = toolsResult
  }

  let merge: boolean | undefined
  const mergeArg = operation.labeledArgs?.merge
  if (mergeArg) {
    const mergeValue = code.slice(
      ...mergeArg.sourceRange.map((r) => toUtf16(r, code))
    )
    if (mergeValue !== 'true' && mergeValue !== 'false') {
      return { reason: "Couldn't retrieve merge argument" }
    }
    merge = mergeValue === 'true'
  }

  let keepTools: boolean | undefined
  const keepToolsArg = operation.labeledArgs?.keepTools
  if (keepToolsArg) {
    const keepToolsValue = code.slice(
      ...keepToolsArg.sourceRange.map((r) => toUtf16(r, code))
    )
    if (keepToolsValue !== 'true' && keepToolsValue !== 'false') {
      return { reason: "Couldn't retrieve keepTools argument" }
    }
    keepTools = keepToolsValue === 'true'
  }

  const argDefaultValues: ModelingCommandSchema['Boolean Split'] = {
    targets,
    tools,
    merge,
    keepTools,
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
  blend: {
    label: 'Blend',
    icon: 'blend',
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
  flipSurface: {
    label: 'Flip Surface',
    icon: 'flipSurface',
    supportsAppearance: true,
    supportsTransform: true,
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
  deleteFace: {
    label: 'Delete Face',
    icon: 'deleteFace',
    supportsAppearance: true,
    supportsTransform: true,
  },
  angle: {
    label: 'Angle Constraint',
    icon: 'angle',
  },
  arc: {
    label: 'Arc',
    icon: 'arc',
  },
  circle: {
    label: 'Circle',
    icon: 'circle',
  },
  coincident: {
    label: 'Coincident Constraint',
    icon: 'coincident',
  },
  concentric: {
    label: 'Concentric Constraint',
    icon: 'concentric',
  },
  diameter: {
    label: 'Diameter Constraint',
    icon: 'dimension', // TODO: see if we need a different icon here?
  },
  distance: {
    label: 'Distance Constraint',
    icon: 'dimension', // TODO: see if we need a different icon here?
  },
  equalLength: {
    label: 'Equal Length Constraint',
    icon: 'equal',
  },
  fixed: {
    label: 'Fixed Constraint',
    icon: 'fix',
  },
  horizontal: {
    label: 'Horizontal Constraint',
    icon: 'horizontal',
  },
  horizontalDistance: {
    label: 'Horizontal Distance Constraint',
    icon: 'horizontalDimension',
  },
  verticalDistance: {
    label: 'Vertical Distance Constraint',
    icon: 'verticalDimension',
  },
  line: {
    label: 'Line',
    icon: 'line',
  },
  midpoint: {
    label: 'Midpoint Constraint',
    icon: 'midpoint',
  },
  normal: {
    label: 'Normal Constraint',
    icon: 'normal',
  },
  parallel: {
    label: 'Parallel Constraint',
    icon: 'parallel',
  },
  perpendicular: {
    label: 'Perpendicular Constraint',
    icon: 'perpendicular',
  },
  point: {
    label: 'Point',
    icon: 'oneDot',
  },
  radius: {
    label: 'Radius Constraint',
    icon: 'dimension', // TODO: see if we need a different icon here?
  },
  symmetric: {
    label: 'Symmetric Constraint',
    icon: 'symmetry',
  },
  tangent: {
    label: 'Tangent Constraint',
    icon: 'tangent',
  },
  vertical: {
    label: 'Vertical Constraint',
    icon: 'vertical',
  },
  'hole::hole': {
    label: 'Hole',
    icon: 'hole',
    prepareToEdit: prepareToEditHole,
    supportsAppearance: false,
    supportsTransform: true,
  },
  'hole::holes': {
    label: 'Holes',
    icon: 'hole',
  },
  sketchSolve: {
    label: 'Solve Sketch',
    icon: 'sketch',
    prepareToEdit: prepareToEditSketchSolve,
  },
  split: {
    label: 'Split',
    icon: 'split',
    supportsAppearance: true,
    supportsTransform: true,
    prepareToEdit: prepareToEditSplit,
  },
  startSketchOn: {
    label: 'Sketch',
    icon: 'sketch',
    async prepareToEdit({ operation, artifact, artifactGraph }) {
      const resolvedArtifact =
        artifact ??
        (operation.type === 'StdLibCall'
          ? (findOperationArtifact(operation, artifactGraph) ?? undefined)
          : undefined)
      if (resolvedArtifact) {
        return {
          name: 'Enter sketch',
          groupId: 'modeling',
        }
      }
      return {
        reason:
          'Editing sketches on faces or offset planes through the feature tree is not yet supported. Please double-click the path in the scene for now.',
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
    case 'SketchSolve':
      return 'Solve Sketch'
    case 'GroupEnd':
      return 'Group end'
    default:
      const _exhaustiveCheck: never = op
      return '' // unreachable
  }
}

export type NestedOpList = (Operation | Operation[])[]

function getSketchBlockOperationKey(op: Operation): string | null {
  if (!('nodePath' in op)) {
    return null
  }
  const sketchBlockIndex = op.nodePath.steps.findIndex(
    (step) => step.type === 'SketchBlock'
  )
  if (sketchBlockIndex < 0) {
    return null
  }
  return JSON.stringify(op.nodePath.steps.slice(0, sketchBlockIndex + 1))
}

export function isSketchBlockOperationGroup(items: Operation[]): boolean {
  if (items.length === 0) {
    return false
  }
  const firstKey = getSketchBlockOperationKey(items[0])
  if (!firstKey) {
    return false
  }
  return items.every((item) => getSketchBlockOperationKey(item) === firstKey)
}

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
 * Given a list that may already contain grouped operation streaks, group
 * contiguous operations that belong to the same sketch block.
 */
export function groupSketchBlockOperations(opList: NestedOpList): NestedOpList {
  const result: NestedOpList = []
  let currentSketchKey: string | null = null
  let currentSketchOps: Operation[] = []

  const flushSketchOps = () => {
    if (currentSketchOps.length === 0) {
      return
    }
    result.push([...currentSketchOps])
    currentSketchOps = []
    currentSketchKey = null
  }

  for (const item of opList) {
    if (isArray(item)) {
      flushSketchOps()
      result.push(item)
      continue
    }

    const sketchKey = getSketchBlockOperationKey(item)
    if (!sketchKey) {
      flushSketchOps()
      result.push(item)
      continue
    }

    if (currentSketchKey === null || currentSketchKey === sketchKey) {
      currentSketchKey = sketchKey
      currentSketchOps.push(item)
      continue
    }

    flushSketchOps()
    currentSketchKey = sketchKey
    currentSketchOps.push(item)
  }

  flushSketchOps()
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
    case 'SketchSolve':
      return 'sketch'
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
      return isNonNullable(op.value) ? op.value.toPrecision(5) : ''
    case 'String':
      return op.value
    case 'Bool':
      return String(op.value)
    case 'Number':
      return isNonNullable(op.value) ? op.value.toPrecision(5) : ''
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
  program: Program,
  wasmInstance: ModuleType
): string | undefined {
  if (op.type === 'VariableDeclaration') {
    return op.name
  }

  // Handle GDT operations - they don't have variable names as they're standalone statements
  if (op.type === 'StdLibCall' && op.name.startsWith('gdt::')) {
    return undefined
  }

  // Handle inner sketch block variables
  if (
    op.type === 'StdLibCall' &&
    op.nodePath.steps.some((s) => s.type === 'SketchBlock')
  ) {
    return undefined
  }

  if (
    op.type !== 'StdLibCall' &&
    op.type !== 'SketchSolve' &&
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

  // If this is a module instance, the variable name is the import alias.
  if (op.type === 'GroupBegin' && op.group.type === 'ModuleInstance') {
    const statement = getNodeFromPath<ImportStatement>(
      program,
      pathToNode,
      wasmInstance,
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
  return getVariableNameFromNodePath(pathToNode, program, wasmInstance)
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
  isNotHideOperation,
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

/**
 * A filter to exclude `hide()` operations from a list of operations.
 */
function isNotHideOperation(ops: Operation[]): Operation[] {
  return ops.filter((op) => !(op.type === 'StdLibCall' && op.name === 'hide'))
}

/**
 * Filter Operations list to just hide() calls
 */
export function getHideOperations(ops: Operation[]): Operation[] {
  return ops.filter((op) => op.type === 'StdLibCall' && op.name === 'hide')
}

export interface EnterEditFlowProps {
  operation: Operation
  code: string
  artifactGraph: ArtifactGraph
  artifact?: Artifact
  rustContext: RustContext
}

export async function enterEditFlow({
  operation,
  code,
  artifact,
  rustContext,
  artifactGraph,
}: EnterEditFlowProps): Promise<Error | CommandBarMachineEvent> {
  // Operate on VariableDeclarations differently from StdLibCall's
  if (operation.type === 'VariableDeclaration') {
    const eventPayload = await prepareToEditParameter({
      operation,
      rustContext,
      code,
      artifactGraph,
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
  if (operation.type !== 'StdLibCall' && operation.type !== 'SketchSolve') {
    return new Error(
      'Feature tree editing not yet supported for user-defined functions or modules. Please edit in the code editor.'
    )
  }
  const stdLibInfo =
    operation.type === 'SketchSolve'
      ? stdLibMap.sketchSolve
      : stdLibMap[operation.name]

  if (stdLibInfo && stdLibInfo.prepareToEdit) {
    if (typeof stdLibInfo.prepareToEdit === 'function') {
      const eventPayload = await stdLibInfo.prepareToEdit({
        operation,
        code,
        artifact,
        rustContext,
        artifactGraph,
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

async function prepareToEditTranslate({
  operation,
  rustContext,
  code,
  artifactGraph,
}: EnterEditFlowProps) {
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

  /** Version of `toUtf16` bound to our code, for mapping source range values. */
  const boundToUtf16 = (n: number) => toUtf16(n, code)

  // 1. Map the unlabeled arguments to selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const objects = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    artifactGraph
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
      code.slice(...operation.labeledArgs.x.sourceRange.map(boundToUtf16)),
      rustContext
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve x argument" }
    }
    x = result
  }

  if (operation.labeledArgs.y) {
    const result = await stringToKclExpression(
      code.slice(...operation.labeledArgs.y.sourceRange.map(boundToUtf16)),
      rustContext
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve y argument" }
    }
    y = result
  }

  if (operation.labeledArgs.z) {
    const result = await stringToKclExpression(
      code.slice(...operation.labeledArgs.z.sourceRange.map(boundToUtf16)),
      rustContext
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve z argument" }
    }
    z = result
  }

  if (operation.labeledArgs.global) {
    global =
      code.slice(
        ...operation.labeledArgs.global.sourceRange.map(boundToUtf16)
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

async function prepareToEditScale({
  operation,
  rustContext,
  code,
  artifactGraph,
}: EnterEditFlowProps) {
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

  /** Version of `toUtf16` bound to our code, for mapping source range values. */
  const boundToUtf16 = (n: number) => toUtf16(n, code)

  // 1. Map the unlabeled arguments to selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const objects = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    artifactGraph
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
    const res = await extractKclArgument(code, operation, 'x', rustContext)
    if ('error' in res) return { reason: res.error }
    x = res
  }
  if (operation.labeledArgs.y) {
    const res = await extractKclArgument(code, operation, 'y', rustContext)
    if ('error' in res) return { reason: res.error }
    y = res
  }
  if (operation.labeledArgs.z) {
    const res = await extractKclArgument(code, operation, 'z', rustContext)
    if ('error' in res) return { reason: res.error }
    z = res
  }
  if (operation.labeledArgs.factor) {
    const res = await extractKclArgument(code, operation, 'factor', rustContext)
    if ('error' in res) return { reason: res.error }
    factor = res
  }
  if (operation.labeledArgs.global) {
    global =
      code.slice(
        ...operation.labeledArgs.global.sourceRange.map(boundToUtf16)
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

async function prepareToEditRotate({
  operation,
  rustContext,
  code,
  artifactGraph,
}: EnterEditFlowProps) {
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

  /** Version of `toUtf16` bound to our code, for mapping source range values. */
  const boundToUtf16 = (n: number) => toUtf16(n, code)

  // 1. Map the unlabeled arguments to selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const objects = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    artifactGraph
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
      code.slice(...operation.labeledArgs.roll.sourceRange.map(boundToUtf16)),
      rustContext
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve roll argument" }
    }
    roll = result
  }

  if (operation.labeledArgs.pitch) {
    const result = await stringToKclExpression(
      code.slice(...operation.labeledArgs.pitch.sourceRange.map(boundToUtf16)),
      rustContext
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve pitch argument" }
    }
    pitch = result
  }

  if (operation.labeledArgs.yaw) {
    const result = await stringToKclExpression(
      code.slice(...operation.labeledArgs.yaw.sourceRange.map(boundToUtf16)),
      rustContext
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve yaw argument" }
    }
    yaw = result
  }

  if (operation.labeledArgs.global) {
    global =
      code.slice(
        ...operation.labeledArgs.global.sourceRange.map(boundToUtf16)
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

async function prepareToEditAppearance({
  operation,
  rustContext,
  code,
  artifactGraph,
}: EnterEditFlowProps) {
  const baseCommand = {
    name: 'Appearance',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return {
      reason: 'Unsupported operation type. Please edit in the code editor.',
    }
  }

  /** Version of `toUtf16` bound to our code, for mapping source range values. */
  const boundToUtf16 = (n: number) => toUtf16(n, code)

  // 1. Map the unlabeled arguments to selections
  if (!operation.unlabeledArg) {
    return { reason: `Couldn't retrieve operation arguments` }
  }

  const objects = retrieveSelectionsFromOpArg(
    operation.unlabeledArg,
    artifactGraph
  )
  if (err(objects)) {
    return { reason: "Couldn't retrieve objects" }
  }

  // 2. Convert the color argument from a string to a KCL expression
  if (!operation.labeledArgs.color) {
    return { reason: "Couldn't find color argument" }
  }

  const color = getStringValue(code, operation.labeledArgs.color.sourceRange)

  let metalness: KclCommandValue | undefined
  if (operation.labeledArgs.metalness) {
    const result = await stringToKclExpression(
      code.slice(
        ...operation.labeledArgs.metalness.sourceRange.map(boundToUtf16)
      ),
      rustContext
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve metalness argument" }
    }
    metalness = result
  }

  let roughness: KclCommandValue | undefined
  if (operation.labeledArgs.roughness) {
    const result = await stringToKclExpression(
      code.slice(
        ...operation.labeledArgs.roughness.sourceRange.map(boundToUtf16)
      ),
      rustContext
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve roughness argument" }
    }
    roughness = result
  }

  let opacity: KclCommandValue | undefined
  if (operation.labeledArgs.opacity) {
    const result = await stringToKclExpression(
      code.slice(
        ...operation.labeledArgs.opacity.sourceRange.map(boundToUtf16)
      ),
      rustContext
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve opacity argument" }
    }
    opacity = result
  }

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Appearance'] = {
    objects,
    color,
    metalness,
    roughness,
    opacity,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }
  return {
    ...baseCommand,
    argDefaultValues,
  }
}

export type HideOperation = Operation & { type: 'StdLibCall'; name: 'hide' }
export function getHideOpByArtifactId(
  ops: Operation[],
  searchId: string
): HideOperation | undefined {
  const found = ops.find((op) => {
    if (!(op.type === 'StdLibCall' && op.name === 'hide')) {
      return undefined
    }
    if (op.unlabeledArg?.value.type === 'Array') {
      const found = op.unlabeledArg.value.value.find(
        (a) =>
          'value' in a &&
          typeof a.value === 'object' &&
          'artifactId' in a.value &&
          typeof a.value?.artifactId === 'string' &&
          a.value.artifactId === searchId
      )

      return found ? op : undefined
    } else if (
      op.unlabeledArg?.value &&
      'value' in op.unlabeledArg.value &&
      op.unlabeledArg.value.value &&
      typeof op.unlabeledArg.value.value === 'object' &&
      'artifactId' in op.unlabeledArg.value.value &&
      typeof op.unlabeledArg.value.value.artifactId === 'string' &&
      op.unlabeledArg.value.value.artifactId
    ) {
      return op.unlabeledArg.value.value.artifactId === searchId
        ? op
        : undefined
    }
    return undefined
  })

  return found as HideOperation | undefined
}

export function onHide(props: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  modelingActor: ActorRefFrom<typeof modelingMachine>
}) {
  const selection = props.modelingActor.getSnapshot().context.selectionRanges

  props.modelingActor.send({
    type: 'Hide',
    data: {
      objects: selection,
    },
  })
}

export async function onUnhide(props: {
  hideOperation: HideOperation
  targetArtifact: Artifact
  kclManager: KclManager
}) {
  if (props.hideOperation.unlabeledArg === null) {
    return new Error('Missing unlabeled arg for hide operation')
  }
  let modifiedAst = structuredClone(props.kclManager.ast)
  const pathToNode = pathToNodeFromRustNodePath(props.hideOperation.nodePath)

  if (
    props.hideOperation.unlabeledArg.value.type === 'Array' &&
    'codeRef' in props.targetArtifact
  ) {
    const wasmInstance = await props.kclManager.rustContext.wasmInstancePromise
    // Multi-item case: remove that target artifact's name
    const termToDelete = getVariableNameFromNodePath(
      pathToNodeFromRustNodePath(props.targetArtifact.codeRef.nodePath),
      modifiedAst,
      wasmInstance
    )
    if (!termToDelete) {
      return new Error(
        'Variable name to delete not found while trying to unhide'
      )
    }

    const deleteResult = deleteTermFromUnlabeledArgumentArray(
      props.kclManager.ast,
      pathToNode,
      wasmInstance,
      termToDelete
    )
    if (err(deleteResult)) {
      return deleteResult
    }
    modifiedAst = deleteResult
  } else {
    // Single item case: Delete the node
    const result = deleteTopLevelStatement(modifiedAst, pathToNode)
    if (err(result)) {
      return result
    }
  }

  return updateModelingState(
    modifiedAst,
    EXECUTION_TYPE_REAL,
    props.kclManager,
    {
      focusPath: [],
    }
  )
}
