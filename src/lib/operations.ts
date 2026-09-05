import type { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type {
  OpArg,
  Operation,
  OpKclValue,
} from '@rust/kcl-lib/bindings/Operation'
import type { CustomIconName } from '@src/components/CustomIcon'
import { toUtf16 } from '@src/lang/errors'
import type { KclManager } from '@src/lang/KclManager'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import {
  deleteTermFromUnlabeledArgumentArray,
  deleteTopLevelStatement,
} from '@src/lang/modifyAst'
import {
  retrieveHoleBodyArgs,
  retrieveHoleBottomArgs,
  retrieveHoleTypeArgs,
} from '@src/lang/modifyAst/faces'
import {
  retrieveBodyTypeFromOpArg,
  retrieveTagDeclaratorFromOpArg,
  SWEEP_CONSTANTS,
  SWEEP_MODULE,
  type SweepRelativeTo,
} from '@src/lang/modifyAst/sweeps'
import type { StdLibCallOp } from '@src/lang/queryAst'
import {
  getNodeFromPath,
  getVariableNameFromNodePath,
} from '@src/lang/queryAst'
import type { Artifact } from '@src/lang/std/artifactGraph'
import {
  type ArtifactGraph,
  type CallExpressionKw,
  type Program,
  pathToNodeFromRustNodePath,
} from '@src/lang/wasm'
import type {
  HelixModes,
  ModelingCommandSchema,
} from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { KclCommandValue, KclExpression } from '@src/lib/commandTypes'
import {
  EXECUTION_TYPE_REAL,
  KCL_PRELUDE_EXTRUDE_METHOD_MERGE,
  KCL_PRELUDE_EXTRUDE_METHOD_NEW,
  type KclPreludeBodyType,
  type KclPreludeExtrudeMethod,
  LEGACY_SKETCH_MODE_FEATURE_FLAG,
  LEGACY_SKETCH_MODE_REMOVED_MESSAGE,
} from '@src/lib/constants'
import { getStringValue, stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import { err } from '@src/lib/trap'
import { isNonNullable, stripQuotes } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { CommandBarMachineEvent } from '@src/machines/commandBarMachine'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { ActorRefFrom } from 'xstate'

type ExecuteCommandEvent = CommandBarMachineEvent & {
  type: 'Find and select command'
}
type ExecuteCommandEventPayload = ExecuteCommandEvent['data']
type PrepareToEditFailurePayload = { reason: string }
type ProfileGdtFunction = NonNullable<
  ModelingCommandSchema['GDT Profile']['profileFunction']
>
type PrepareToEditCallback = (
  props: EnterEditFlowProps
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
  supportsTranslate?: boolean
  supportsRotate?: boolean
  supportsScale?: boolean
}

function hasLegacySketchMode(): boolean {
  return (
    window.app?.userFeatures.has(LEGACY_SKETCH_MODE_FEATURE_FLAG, false) ??
    false
  )
}

const OMITTED_EDIT_SELECTIONS: Selections = {
  graphSelections: [],
  otherSelections: [],
}

function getProfileFunctionFromOperationName(
  operationName: string
): ProfileGdtFunction | undefined {
  switch (operationName) {
    case 'gdt::profile':
      return 'profile'
    case 'gdt::profileLine':
      return 'profileLine'
    case 'gdt::profileSurface':
      return 'profileSurface'
    default:
      return undefined
  }
}

// Helper functions for argument extraction
async function extractKclArgument(
  code: string,
  operation: StdLibCallOp,
  argName: string,
  rustContext: RustContext,
  isArray?: boolean,
  allowStringArrays?: boolean
): Promise<KclCommandValue | { error: string }> {
  const arg = operation.labeledArgs?.[argName]
  if (!arg?.sourceRange) {
    return { error: `Missing or invalid ${argName} argument` }
  }

  const result = await stringToKclExpression(
    code.slice(...arg.sourceRange.map((r) => toUtf16(r, code))),
    rustContext,
    { allowArrays: isArray, allowStringArrays }
  )

  if (err(result) || 'errors' in result) {
    return { error: `Failed to parse ${argName} argument as KCL expression` }
  }

  return result
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

function extractRequiredStringArgument(
  code: string,
  operation: StdLibCallOp,
  argName: string
): string | { error: string } {
  const arg = operation.labeledArgs?.[argName]
  if (!arg?.sourceRange) {
    return { error: `Missing or invalid ${argName} argument` }
  }

  const value = code.slice(...arg.sourceRange.map((r) => toUtf16(r, code)))
  if (!value) {
    return { error: `Couldn't retrieve ${argName} argument` }
  }

  return value
}

function extractAxisFromOpArg(opArg: OpArg): 'X' | 'Y' | 'Z' | undefined {
  const value = opArg.value
  if (value.type !== 'Object') return undefined

  const direction = value.value.direction
  if (direction?.type !== 'Array') return undefined

  const index = direction.value.findIndex(
    (component) => component.type === 'Number' && component.value !== 0
  )
  return index >= 0 && index < 3 ? (['X', 'Y', 'Z'] as const)[index] : undefined
}

async function extractOptionalKclArrayArgument(
  code: string,
  operation: StdLibCallOp,
  argName: string,
  rustContext: RustContext
): Promise<KclCommandValue | undefined | { error: string }> {
  return extractOptionalKclArgument(
    code,
    operation,
    argName,
    rustContext,
    true,
    true
  )
}

async function extractOptionalKclArgument(
  code: string,
  operation: StdLibCallOp,
  argName: string,
  rustContext: RustContext,
  isArray?: boolean,
  allowStringArrays?: boolean
): Promise<KclCommandValue | undefined | { error: string }> {
  if (!operation.labeledArgs?.[argName]?.sourceRange) {
    return undefined
  }

  return extractKclArgument(
    code,
    operation,
    argName,
    rustContext,
    isArray,
    allowStringArrays
  )
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

  const to = operation.labeledArgs.to ? OMITTED_EDIT_SELECTIONS : undefined

  // symmetric argument from a string to boolean
  let symmetric: boolean | undefined
  if ('symmetric' in operation.labeledArgs && operation.labeledArgs.symmetric) {
    symmetric =
      code.slice(
        ...operation.labeledArgs.symmetric.sourceRange.map(boundToUtf16)
      ) === 'true'
  }

  const direction = operation.labeledArgs.direction
    ? OMITTED_EDIT_SELECTIONS
    : undefined

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

  // draftAngle argument from a string to a KCL expression
  let draftAngle: KclCommandValue | undefined
  if (
    'draftAngle' in operation.labeledArgs &&
    operation.labeledArgs.draftAngle
  ) {
    const result = await stringToKclExpression(
      code.slice(
        ...operation.labeledArgs.draftAngle.sourceRange.map(boundToUtf16)
      ),
      rustContext
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve draftAngle argument" }
    }

    draftAngle = result
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
    sketches: OMITTED_EDIT_SELECTIONS,
    length,
    to,
    symmetric,
    direction,
    bidirectionalLength,
    tagStart,
    tagEnd,
    draftAngle,
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

  const toleranceResult = await extractOptionalKclArgument(
    code,
    operation,
    'tolerance',
    rustContext
  )
  if (toleranceResult && 'error' in toleranceResult) {
    return { reason: toleranceResult.error }
  }
  const tolerance = toleranceResult

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
    sketches: OMITTED_EDIT_SELECTIONS,
    vDegree,
    bezApproximateRational,
    baseCurveIndex,
    tolerance,
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
}) => {
  const baseCommand = {
    name: 'Fillet',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  // 2. Convert the radius argument from a string to a KCL expression
  const radius = await extractKclArgument(
    code,
    operation,
    'radius',
    rustContext
  )
  if ('error' in radius) return { reason: radius.error }

  const tag = extractStringArgument(code, operation, 'tag')
  const toleranceResult = await extractOptionalKclArgument(
    code,
    operation,
    'tolerance',
    rustContext
  )
  if (toleranceResult && 'error' in toleranceResult) {
    return { reason: toleranceResult.error }
  }
  const tolerance = toleranceResult
  const versionResult = await extractKclArgument(
    code,
    operation,
    'version',
    rustContext
  )
  const version = 'error' in versionResult ? undefined : versionResult

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Fillet'] = {
    selection: OMITTED_EDIT_SELECTIONS,
    radius,
    tolerance,
    tag,
    version,
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
}) => {
  const baseCommand = {
    name: 'Chamfer',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

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
    extractKclArgument(code, operation, 'version', rustContext),
  ])

  const [secondLength, angle, version] = optionalArgs.map((arg) =>
    'error' in arg ? undefined : arg
  )

  const tag = extractStringArgument(code, operation, 'tag')

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Chamfer'] = {
    selection: OMITTED_EDIT_SELECTIONS,
    length,
    secondLength,
    angle,
    tag,
    version,
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
    faces: OMITTED_EDIT_SELECTIONS,
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
  code,
}) => {
  const baseCommand = {
    name: 'Hole',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

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
    countersinkHeadClearance,
  } = rType

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Hole'] = {
    face: OMITTED_EDIT_SELECTIONS,
    cutAt,
    holeType,
    counterboreDepth,
    counterboreDiameter,
    countersinkAngle,
    countersinkDiameter,
    countersinkHeadClearance,
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
 * Gather up the argument values for the Helical Gear command
 * to be used in the command bar edit flow.
 */
const prepareToEditHelicalGear: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'Helical Gear',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  const [nTeeth, module, pressureAngle, helixAngle, gearHeight] =
    await Promise.all([
      extractKclArgument(code, operation, 'nTeeth', rustContext),
      extractKclArgument(code, operation, 'module', rustContext),
      extractKclArgument(code, operation, 'pressureAngle', rustContext),
      extractKclArgument(code, operation, 'helixAngle', rustContext),
      extractKclArgument(code, operation, 'gearHeight', rustContext),
    ])

  if ('error' in nTeeth) return { reason: nTeeth.error }
  if ('error' in module) return { reason: module.error }
  if ('error' in pressureAngle) return { reason: pressureAngle.error }
  if ('error' in helixAngle) return { reason: helixAngle.error }
  if ('error' in gearHeight) return { reason: gearHeight.error }

  const argDefaultValues: ModelingCommandSchema['Helical Gear'] = {
    nTeeth,
    module,
    pressureAngle,
    helixAngle,
    gearHeight,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }
  return {
    ...baseCommand,
    argDefaultValues,
  }
}

/**
 * Gather up the argument values for the Herringbone Gear command
 * to be used in the command bar edit flow.
 */
const prepareToEditHerringboneGear: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'Herringbone Gear',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  const [nTeeth, module, pressureAngle, gearHeight, helixAngle] =
    await Promise.all([
      extractKclArgument(code, operation, 'nTeeth', rustContext),
      extractKclArgument(code, operation, 'module', rustContext),
      extractKclArgument(code, operation, 'pressureAngle', rustContext),
      extractKclArgument(code, operation, 'gearHeight', rustContext),
      extractKclArgument(code, operation, 'helixAngle', rustContext),
    ])

  if ('error' in nTeeth) return { reason: nTeeth.error }
  if ('error' in module) return { reason: module.error }
  if ('error' in pressureAngle) return { reason: pressureAngle.error }
  if ('error' in gearHeight) return { reason: gearHeight.error }
  if ('error' in helixAngle) return { reason: helixAngle.error }

  const argDefaultValues: ModelingCommandSchema['Herringbone Gear'] = {
    nTeeth,
    module,
    pressureAngle,
    gearHeight,
    helixAngle,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }
  return {
    ...baseCommand,
    argDefaultValues,
  }
}

/**
 * Gather up the argument values for the Spur Gear command
 * to be used in the command bar edit flow.
 */
const prepareToEditSpurGear: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'Spur Gear',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  const [nTeeth, module, pressureAngle, gearHeight] = await Promise.all([
    extractKclArgument(code, operation, 'nTeeth', rustContext),
    extractKclArgument(code, operation, 'module', rustContext),
    extractKclArgument(code, operation, 'pressureAngle', rustContext),
    extractKclArgument(code, operation, 'gearHeight', rustContext),
  ])

  if ('error' in nTeeth) return { reason: nTeeth.error }
  if ('error' in module) return { reason: module.error }
  if ('error' in pressureAngle) return { reason: pressureAngle.error }
  if ('error' in gearHeight) return { reason: gearHeight.error }

  const argDefaultValues: ModelingCommandSchema['Spur Gear'] = {
    nTeeth,
    module,
    pressureAngle,
    gearHeight,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }
  return {
    ...baseCommand,
    argDefaultValues,
  }
}

/**
 * Gather up the argument values for the Ring Gear command
 * to be used in the command bar edit flow.
 */
const prepareToEditRingGear: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'Ring Gear',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  const [nTeeth, module, pressureAngle, helixAngle, gearHeight] =
    await Promise.all([
      extractKclArgument(code, operation, 'nTeeth', rustContext),
      extractKclArgument(code, operation, 'module', rustContext),
      extractKclArgument(code, operation, 'pressureAngle', rustContext),
      extractKclArgument(code, operation, 'helixAngle', rustContext),
      extractKclArgument(code, operation, 'gearHeight', rustContext),
    ])

  if ('error' in nTeeth) return { reason: nTeeth.error }
  if ('error' in module) return { reason: module.error }
  if ('error' in pressureAngle) return { reason: pressureAngle.error }
  if ('error' in helixAngle) return { reason: helixAngle.error }
  if ('error' in gearHeight) return { reason: gearHeight.error }

  const argDefaultValues: ModelingCommandSchema['Ring Gear'] = {
    nTeeth,
    module,
    pressureAngle,
    helixAngle,
    gearHeight,
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
  if (
    !(operation.type === 'GroupBegin' && operation.group.type === 'SketchBlock')
  ) {
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
    plane: OMITTED_EDIT_SELECTIONS,
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
  rustContext,
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

  // optional arguments
  let sectional: boolean | undefined
  if ('sectional' in operation.labeledArgs && operation.labeledArgs.sectional) {
    sectional =
      code.slice(
        ...operation.labeledArgs.sectional.sourceRange.map(boundToUtf16)
      ) === 'true'
  }

  const toleranceResult = await extractOptionalKclArgument(
    code,
    operation,
    'tolerance',
    rustContext
  )
  if (toleranceResult && 'error' in toleranceResult) {
    return { reason: toleranceResult.error }
  }
  const tolerance = toleranceResult

  let translateProfileToPath: boolean | undefined
  if (
    'translateProfileToPath' in operation.labeledArgs &&
    operation.labeledArgs.translateProfileToPath
  ) {
    translateProfileToPath =
      code.slice(
        ...operation.labeledArgs.translateProfileToPath.sourceRange.map(
          boundToUtf16
        )
      ) === 'true'
  }

  let orientProfilePerpendicular: boolean | undefined
  if (
    'orientProfilePerpendicular' in operation.labeledArgs &&
    operation.labeledArgs.orientProfilePerpendicular
  ) {
    orientProfilePerpendicular =
      code.slice(
        ...operation.labeledArgs.orientProfilePerpendicular.sourceRange.map(
          boundToUtf16
        )
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

  let version: KclCommandValue | undefined
  if ('version' in operation.labeledArgs && operation.labeledArgs.version) {
    const result = await stringToKclExpression(
      code.slice(
        ...operation.labeledArgs.version.sourceRange.map(boundToUtf16)
      ),
      rustContext
    )
    if (err(result) || 'errors' in result) {
      return { reason: "Couldn't retrieve version argument" }
    }
    version = result
  }

  // 3. Assemble the default argument values for the command,
  // with `nodeToEdit` set, which will let the actor know
  // to edit the node that corresponds to the StdLibCall.
  const argDefaultValues: ModelingCommandSchema['Sweep'] = {
    sketches: OMITTED_EDIT_SELECTIONS,
    path: OMITTED_EDIT_SELECTIONS,
    sectional,
    tolerance,
    relativeTo,
    translateProfileToPath,
    orientProfilePerpendicular,
    tagStart,
    tagEnd,
    bodyType,
    version,
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
}) => {
  const baseCommand = {
    name: 'Helix',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall' || !operation.labeledArgs) {
    return { reason: 'Wrong operation type or arguments' }
  }

  /** Version of `toUtf16` bound to our code, for mapping source range values. */
  const boundToUtf16 = (n: number) => toUtf16(n, code)

  const axisArg = operation.labeledArgs.axis
  const cylinderArg = operation.labeledArgs.cylinder
  if (!axisArg && !cylinderArg) {
    return {
      reason: "The axis or cylinder arguments couldn't be retrieved.",
    }
  }
  const axis = axisArg ? extractAxisFromOpArg(axisArg) : undefined
  const mode: HelixModes = cylinderArg ? 'Cylinder' : axis ? 'Axis' : 'Edge'

  // revolutions kcl arg (required for all)
  const revolutions = await stringToKclExpression(
    code.slice(
      ...(operation.labeledArgs.revolutions?.sourceRange.map(boundToUtf16) ??
        [])
    ),
    rustContext
  )
  if (err(revolutions) || 'errors' in revolutions) {
    return { reason: 'Errors found in revolutions argument' }
  }

  // angleStart kcl arg (required for all)
  const angleStart = await stringToKclExpression(
    code.slice(
      ...(operation.labeledArgs.angleStart?.sourceRange.map(boundToUtf16) ?? [])
    ),
    rustContext
  )
  if (err(angleStart) || 'errors' in angleStart) {
    return { reason: 'Errors found in angleStart argument' }
  }

  // radius and cylinder and kcl arg (only for axis or edge)
  let radius: KclExpression | undefined // axis or edge modes only
  if ('radius' in operation.labeledArgs && operation.labeledArgs.radius) {
    const r = await stringToKclExpression(
      code.slice(...operation.labeledArgs.radius.sourceRange.map(boundToUtf16)),
      rustContext
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
    edge: mode === 'Edge' ? OMITTED_EDIT_SELECTIONS : undefined,
    cylinder: mode === 'Cylinder' ? OMITTED_EDIT_SELECTIONS : undefined,
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
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'Revolve',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall' || !operation.labeledArgs) {
    return { reason: 'Wrong operation type or arguments' }
  }

  /** Version of `toUtf16` bound to our code, for mapping source range values. */
  const boundToUtf16 = (n: number) => toUtf16(n, code)

  // 2. Prepare labeled arguments
  // axis options string arg
  if (!('axis' in operation.labeledArgs) || !operation.labeledArgs.axis) {
    return { reason: "Couldn't find axis argument" }
  }

  const axis = extractAxisFromOpArg(operation.labeledArgs.axis)

  // angle kcl arg
  // Default to '360' if not present
  const angle = await stringToKclExpression(
    'angle' in operation.labeledArgs && operation.labeledArgs.angle
      ? code.slice(...operation.labeledArgs.angle.sourceRange.map(boundToUtf16))
      : '360deg',
    rustContext
  )
  if (err(angle) || 'errors' in angle) {
    return { reason: 'Error in angle argument retrieval' }
  }

  const toleranceResult = await extractOptionalKclArgument(
    code,
    operation,
    'tolerance',
    rustContext
  )
  if (toleranceResult && 'error' in toleranceResult) {
    return { reason: toleranceResult.error }
  }
  const tolerance = toleranceResult

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
    sketches: OMITTED_EDIT_SELECTIONS,
    axisOrEdge: axis ? 'Axis' : 'Edge',
    axis,
    edge: axis ? undefined : OMITTED_EDIT_SELECTIONS,
    angle,
    tolerance,
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
  const axisResult = extractRequiredStringArgument(code, operation, 'axis')
  if (typeof axisResult !== 'string') {
    return { reason: axisResult.error }
  }
  const axisString = axisResult

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
    solids: OMITTED_EDIT_SELECTIONS,
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
  const axisResult = extractRequiredStringArgument(code, operation, 'axis')
  if (typeof axisResult !== 'string') {
    return { reason: axisResult.error }
  }
  const axisString = axisResult

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
    solids: OMITTED_EDIT_SELECTIONS,
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

/** Prepares GDT Flatness annotations for editing. */
const prepareToEditGdtFlatness: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'GDT Flatness',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
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
    extractKclArgument(code, operation, 'fontSize', rustContext),
  ])

  const [precision, framePosition, leaderScale, fontSize] = optionalArgs.map(
    (arg) => ('error' in arg ? undefined : arg)
  )

  const framePlane = extractStringArgument(code, operation, 'framePlane')

  const argDefaultValues: ModelingCommandSchema['GDT Flatness'] = {
    faces: OMITTED_EDIT_SELECTIONS,
    tolerance,
    precision,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditGdtStraightness: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'GDT Straightness',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
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
    extractKclArgument(code, operation, 'fontSize', rustContext),
  ])

  const [precision, framePosition, leaderScale, fontSize] = optionalArgs.map(
    (arg) => ('error' in arg ? undefined : arg)
  )

  const framePlane = extractStringArgument(code, operation, 'framePlane')

  const argDefaultValues: ModelingCommandSchema['GDT Straightness'] = {
    objects: OMITTED_EDIT_SELECTIONS,
    tolerance,
    precision,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditGdtCircularity: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'GDT Circularity',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
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
    extractKclArgument(code, operation, 'fontSize', rustContext),
  ])

  const [precision, framePosition, leaderScale, fontSize] = optionalArgs.map(
    (arg) => ('error' in arg ? undefined : arg)
  )

  const framePlane = extractStringArgument(code, operation, 'framePlane')

  const argDefaultValues: ModelingCommandSchema['GDT Circularity'] = {
    objects: OMITTED_EDIT_SELECTIONS,
    tolerance,
    precision,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditGdtCylindricity: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'GDT Cylindricity',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
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
    extractKclArgument(code, operation, 'fontSize', rustContext),
  ])

  const [precision, framePosition, leaderScale, fontSize] = optionalArgs.map(
    (arg) => ('error' in arg ? undefined : arg)
  )

  const framePlane = extractStringArgument(code, operation, 'framePlane')

  const argDefaultValues: ModelingCommandSchema['GDT Cylindricity'] = {
    objects: OMITTED_EDIT_SELECTIONS,
    tolerance,
    precision,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
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
  code,
}) => {
  const baseCommand = {
    name: 'GDT Datum',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  // Extract name argument as a plain string (strip quotes if present)
  const nameRaw = extractStringArgument(code, operation, 'name')
  const name = stripQuotes(nameRaw)

  // Extract optional parameters
  const optionalArgs = await Promise.all([
    extractKclArgument(code, operation, 'framePosition', rustContext, true),
    extractKclArgument(code, operation, 'leaderScale', rustContext),
    extractKclArgument(code, operation, 'fontSize', rustContext),
  ])

  const [framePosition, leaderScale, fontSize] = optionalArgs.map((arg) =>
    'error' in arg ? undefined : arg
  )

  const framePlane = extractStringArgument(code, operation, 'framePlane')

  const argDefaultValues: ModelingCommandSchema['GDT Datum'] = {
    faces: OMITTED_EDIT_SELECTIONS,
    name,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditGdtPosition: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'GDT Position',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
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
    extractKclArgument(code, operation, 'fontSize', rustContext),
  ])

  const [precision, framePosition, leaderScale, fontSize] = optionalArgs.map(
    (arg) => ('error' in arg ? undefined : arg)
  )

  const framePlane = extractStringArgument(code, operation, 'framePlane')
  const datums = await extractOptionalKclArrayArgument(
    code,
    operation,
    'datums',
    rustContext
  )
  if (datums && 'error' in datums) {
    return { reason: datums.error }
  }

  const argDefaultValues: ModelingCommandSchema['GDT Position'] = {
    objects: OMITTED_EDIT_SELECTIONS,
    datums,
    tolerance,
    precision,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditGdtProfile: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'GDT Profile',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
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
    extractKclArgument(code, operation, 'fontSize', rustContext),
  ])

  const [precision, framePosition, leaderScale, fontSize] = optionalArgs.map(
    (arg) => ('error' in arg ? undefined : arg)
  )

  const framePlane = extractStringArgument(code, operation, 'framePlane')
  const datums = await extractOptionalKclArrayArgument(
    code,
    operation,
    'datums',
    rustContext
  )
  if (datums && 'error' in datums) {
    return { reason: datums.error }
  }

  const argDefaultValues: ModelingCommandSchema['GDT Profile'] = {
    objects: OMITTED_EDIT_SELECTIONS,
    profileFunction: getProfileFunctionFromOperationName(operation.name),
    datums,
    tolerance,
    precision,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditGdtDistance: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'GDT Distance',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
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
    extractKclArgument(code, operation, 'fontSize', rustContext),
  ])

  const [precision, framePosition, leaderScale, fontSize] = optionalArgs.map(
    (arg) => ('error' in arg ? undefined : arg)
  )

  const framePlane = extractStringArgument(code, operation, 'framePlane')

  const argDefaultValues: ModelingCommandSchema['GDT Distance'] = {
    objects: OMITTED_EDIT_SELECTIONS,
    tolerance,
    precision,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditGdtPerpendicularity: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'GDT Perpendicularity',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
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
    extractKclArgument(code, operation, 'fontSize', rustContext),
  ])

  const [precision, framePosition, leaderScale, fontSize] = optionalArgs.map(
    (arg) => ('error' in arg ? undefined : arg)
  )

  const framePlane = extractStringArgument(code, operation, 'framePlane')
  const datums = await extractOptionalKclArrayArgument(
    code,
    operation,
    'datums',
    rustContext
  )
  if (datums && 'error' in datums) {
    return { reason: datums.error }
  }

  const argDefaultValues: ModelingCommandSchema['GDT Perpendicularity'] = {
    objects: OMITTED_EDIT_SELECTIONS,
    datums,
    tolerance,
    precision,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditGdtAngularity: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'GDT Angularity',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
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
    extractKclArgument(code, operation, 'fontSize', rustContext),
  ])

  const [precision, framePosition, leaderScale, fontSize] = optionalArgs.map(
    (arg) => ('error' in arg ? undefined : arg)
  )

  const framePlane = extractStringArgument(code, operation, 'framePlane')
  const datums = await extractOptionalKclArrayArgument(
    code,
    operation,
    'datums',
    rustContext
  )
  if (datums && 'error' in datums) {
    return { reason: datums.error }
  }

  const argDefaultValues: ModelingCommandSchema['GDT Angularity'] = {
    objects: OMITTED_EDIT_SELECTIONS,
    datums,
    tolerance,
    precision,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditGdtConcentricity: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'GDT Concentricity',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  const datums = await extractKclArgument(
    code,
    operation,
    'datums',
    rustContext,
    true,
    true
  )
  if ('error' in datums) {
    return { reason: datums.error }
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
    extractKclArgument(code, operation, 'fontSize', rustContext),
  ])

  const [precision, framePosition, leaderScale, fontSize] = optionalArgs.map(
    (arg) => ('error' in arg ? undefined : arg)
  )

  const framePlane = extractStringArgument(code, operation, 'framePlane')

  const argDefaultValues: ModelingCommandSchema['GDT Concentricity'] = {
    objects: OMITTED_EDIT_SELECTIONS,
    datums,
    tolerance,
    precision,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditGdtSymmetry: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'GDT Symmetry',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  const datums = await extractKclArgument(
    code,
    operation,
    'datums',
    rustContext,
    true,
    true
  )
  if ('error' in datums) {
    return { reason: datums.error }
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
    extractKclArgument(code, operation, 'fontSize', rustContext),
  ])

  const [precision, framePosition, leaderScale, fontSize] = optionalArgs.map(
    (arg) => ('error' in arg ? undefined : arg)
  )

  const framePlane = extractStringArgument(code, operation, 'framePlane')

  const argDefaultValues: ModelingCommandSchema['GDT Symmetry'] = {
    objects: OMITTED_EDIT_SELECTIONS,
    datums,
    tolerance,
    precision,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditGdtRunout: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'GDT Runout',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  const datums = await extractKclArgument(
    code,
    operation,
    'datums',
    rustContext,
    true,
    true
  )
  if ('error' in datums) {
    return { reason: datums.error }
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
    extractKclArgument(code, operation, 'fontSize', rustContext),
  ])

  const [precision, framePosition, leaderScale, fontSize] = optionalArgs.map(
    (arg) => ('error' in arg ? undefined : arg)
  )

  const framePlane = extractStringArgument(code, operation, 'framePlane')

  const argDefaultValues: ModelingCommandSchema['GDT Runout'] = {
    objects: OMITTED_EDIT_SELECTIONS,
    datums,
    tolerance,
    precision,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditGdtParallelism: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'GDT Parallelism',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
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
    extractKclArgument(code, operation, 'fontSize', rustContext),
  ])

  const [precision, framePosition, leaderScale, fontSize] = optionalArgs.map(
    (arg) => ('error' in arg ? undefined : arg)
  )

  const framePlane = extractStringArgument(code, operation, 'framePlane')
  const datums = await extractOptionalKclArrayArgument(
    code,
    operation,
    'datums',
    rustContext
  )
  if (datums && 'error' in datums) {
    return { reason: datums.error }
  }

  const argDefaultValues: ModelingCommandSchema['GDT Parallelism'] = {
    objects: OMITTED_EDIT_SELECTIONS,
    datums,
    tolerance,
    precision,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditGdtAnnotation: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'GDT Annotation',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  const annotationRaw = extractStringArgument(code, operation, 'annotation')
  if (!annotationRaw) {
    return { reason: 'Missing or invalid annotation argument' }
  }
  const annotation = stripQuotes(annotationRaw)

  const optionalArgs = await Promise.all([
    extractKclArgument(code, operation, 'framePosition', rustContext, true),
    extractKclArgument(code, operation, 'leaderScale', rustContext),
    extractKclArgument(code, operation, 'fontSize', rustContext),
  ])

  const [framePosition, leaderScale, fontSize] = optionalArgs.map((arg) =>
    'error' in arg ? undefined : arg
  )

  const framePlane = extractStringArgument(code, operation, 'framePlane')

  const argDefaultValues: ModelingCommandSchema['GDT Annotation'] = {
    objects: OMITTED_EDIT_SELECTIONS,
    annotation,
    framePosition,
    framePlane,
    leaderScale,
    fontSize,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditGdtNote: PrepareToEditCallback = async ({
  operation,
  rustContext,
  code,
}) => {
  const baseCommand = {
    name: 'GDT Note',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
  }

  const noteRaw = extractStringArgument(code, operation, 'note')
  if (!noteRaw) {
    return { reason: 'Missing or invalid note argument' }
  }
  const note = stripQuotes(noteRaw)

  const optionalArgs = await Promise.all([
    extractKclArgument(code, operation, 'framePosition', rustContext, true),
    extractKclArgument(code, operation, 'fontSize', rustContext),
  ])
  const [framePosition, fontSize] = optionalArgs.map((arg) =>
    'error' in arg ? undefined : arg
  )

  const framePlane = extractStringArgument(code, operation, 'framePlane')

  const argDefaultValues: ModelingCommandSchema['GDT Note'] = {
    note,
    framePosition,
    framePlane,
    fontSize,
    nodeToEdit: pathToNodeFromRustNodePath(operation.nodePath),
  }

  return {
    ...baseCommand,
    argDefaultValues,
  }
}

const prepareToEditSplit: PrepareToEditCallback = async ({
  operation,
  code,
}) => {
  const baseCommand = {
    name: 'Boolean Split',
    groupId: 'modeling',
  }
  if (operation.type !== 'StdLibCall') {
    return { reason: 'Wrong operation type' }
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
    targets: OMITTED_EDIT_SELECTIONS,
    tools: OMITTED_EDIT_SELECTIONS,
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
  'gdt::straightness': {
    label: 'Straightness',
    icon: 'gdtStraightness',
    prepareToEdit: prepareToEditGdtStraightness,
  },
  'gdt::circularity': {
    label: 'Circularity',
    icon: 'gdtCircularity',
    prepareToEdit: prepareToEditGdtCircularity,
  },
  'gdt::cylindricity': {
    label: 'Cylindricity',
    icon: 'gdtCylindricity',
    prepareToEdit: prepareToEditGdtCylindricity,
  },
  'gdt::position': {
    label: 'Position',
    icon: 'gdtPosition',
    prepareToEdit: prepareToEditGdtPosition,
  },
  'gdt::perpendicularity': {
    label: 'Perpendicularity',
    icon: 'perpendicular',
    prepareToEdit: prepareToEditGdtPerpendicularity,
  },
  'gdt::angularity': {
    label: 'Angularity',
    icon: 'angle',
    prepareToEdit: prepareToEditGdtAngularity,
  },
  'gdt::concentricity': {
    label: 'Concentricity',
    icon: 'gdtConcentricity',
    prepareToEdit: prepareToEditGdtConcentricity,
  },
  'gdt::symmetry': {
    label: 'Symmetry',
    icon: 'gdtSymmetry',
    prepareToEdit: prepareToEditGdtSymmetry,
  },
  'gdt::runout': {
    label: 'Runout',
    icon: 'gdtRunout',
    prepareToEdit: prepareToEditGdtRunout,
  },
  'gdt::parallelism': {
    label: 'Parallelism',
    icon: 'parallel',
    prepareToEdit: prepareToEditGdtParallelism,
  },
  'gdt::annotation': {
    label: 'Annotation',
    icon: 'text',
    prepareToEdit: prepareToEditGdtAnnotation,
  },
  'gdt::note': {
    label: 'Note',
    icon: 'note',
    prepareToEdit: prepareToEditGdtNote,
  },
  'gdt::distance': {
    label: 'Distance',
    icon: 'dimension',
    prepareToEdit: prepareToEditGdtDistance,
  },
  'gdt::profile': {
    label: 'Profile',
    icon: 'gdtProfile',
    prepareToEdit: prepareToEditGdtProfile,
  },
  'gdt::profileLine': {
    label: 'Profile Line',
    icon: 'gdtProfile',
    prepareToEdit: prepareToEditGdtProfile,
  },
  'gdt::profileSurface': {
    label: 'Profile Surface',
    icon: 'gdtProfile',
    prepareToEdit: prepareToEditGdtProfile,
  },
  'gear::helical': {
    label: 'Helical Gear',
    icon: 'gear',
    prepareToEdit: prepareToEditHelicalGear,
    supportsAppearance: true,
    supportsTransform: true,
  },
  'gear::herringbone': {
    label: 'Herringbone Gear',
    icon: 'gear',
    prepareToEdit: prepareToEditHerringboneGear,
    supportsAppearance: true,
    supportsTransform: true,
  },
  'gear::spur': {
    label: 'Spur Gear',
    icon: 'gear',
    prepareToEdit: prepareToEditSpurGear,
    supportsAppearance: true,
    supportsTransform: true,
  },
  'gear::ring': {
    label: 'Ring Gear',
    icon: 'gear',
    prepareToEdit: prepareToEditRingGear,
    supportsAppearance: true,
    supportsTransform: true,
  },
  helix: {
    label: 'Helix',
    icon: 'helix',
    prepareToEdit: prepareToEditHelix,
    supportsTranslate: true,
    supportsRotate: true,
    supportsScale: true,
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
  mirror3d: {
    label: 'Mirror',
    icon: 'mirror3d',
  },
  region: {
    label: 'Region',
    // TODO: add a region icon
    icon: 'oneDot',
    // TODO: add a prepareToEdit function
    // prepareToEdit: prepareToEditRegion,
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
  delete: {
    label: 'Delete',
    icon: 'trash',
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
    icon: 'symmetric',
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
  joinSurfaces: {
    label: 'Join Surfaces',
    icon: 'joinSurfaces',
    supportsAppearance: true,
    supportsTransform: true,
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
    // TODO: fix matching sketches-on-faces and offset planes back to their
    // original plane artifacts in order to edit them.
    async prepareToEdit({ artifact }) {
      if (!hasLegacySketchMode()) {
        return { reason: LEGACY_SKETCH_MODE_REMOVED_MESSAGE }
      }
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
  'view::named': {
    label: 'Named View',
    icon: 'namedView',
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
      } else if (op.group.type === 'SketchBlock') {
        return 'Sketch'
      } else {
        const _exhaustiveCheck: never = op.group
        return '' // unreachable
      }
    case 'ModuleInstance':
      return op.name
    case 'GroupEnd':
      return 'Group end'
    default:
      const _exhaustiveCheck: never = op
      return '' // unreachable
  }
}

export {
  filterOperations,
  groupNestedOperations,
  groupOperationTypeStreaks,
} from '@src/lib/operationGrouping'

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
      if (op.group.type === 'FunctionCall') {
        return 'function'
      }
      if (op.group.type === 'SketchBlock') {
        return 'sketch'
      }
      return 'make-variable'
    case 'ModuleInstance':
      return 'import' // TODO: Use insert icon.
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
    case 'Enum':
      // Shown by nominal identity, the way the user writes it and the way the
      // variables pane shows it. A variant's representation never appears here.
      return `${op.enum_name}::${op.variant}`
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

  if (
    op.type !== 'StdLibCall' &&
    !(op.type === 'GroupBegin' && op.group.type === 'SketchBlock') &&
    !(op.type === 'GroupBegin' && op.group.type === 'FunctionCall') &&
    op.type !== 'ModuleInstance'
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
  if (op.type === 'ModuleInstance') {
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
 * Filter Operations list to just hide() calls
 */
export function getHideOperations(ops: Operation[]): Operation[] {
  return ops.filter((op) => op.type === 'StdLibCall' && op.name === 'hide')
}

export interface EnterEditFlowProps {
  operation: Operation
  code: string
  artifact?: Artifact
  rustContext: RustContext
}

export async function enterEditFlow({
  operation,
  code,
  artifact,
  rustContext,
}: EnterEditFlowProps): Promise<Error | CommandBarMachineEvent> {
  // Operate on VariableDeclarations differently from StdLibCall's
  if (operation.type === 'VariableDeclaration') {
    const eventPayload = await prepareToEditParameter({
      operation,
      rustContext,
      code,
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
  let stdLibInfo: StdLibCallInfo | undefined
  if (operation.type === 'StdLibCall') {
    stdLibInfo = stdLibMap[operation.name]
  } else if (
    operation.type === 'GroupBegin' &&
    operation.group.type === 'SketchBlock'
  ) {
    stdLibInfo = stdLibMap.sketchSolve
  } else {
    return new Error(
      'Feature tree editing not yet supported for user-defined functions or modules. Please edit in the code editor.'
    )
  }

  if (stdLibInfo && stdLibInfo.prepareToEdit) {
    if (typeof stdLibInfo.prepareToEdit === 'function') {
      const eventPayload = await stdLibInfo.prepareToEdit({
        operation,
        code,
        artifact,
        rustContext,
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

  const xyzResult = await extractOptionalKclArgument(
    code,
    operation,
    'xyz',
    rustContext,
    true
  )
  if (xyzResult && 'error' in xyzResult) {
    return { reason: xyzResult.error }
  }
  const xyz = xyzResult

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
    objects: OMITTED_EDIT_SELECTIONS,
    x,
    y,
    z,
    global,
    xyz,
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
    objects: OMITTED_EDIT_SELECTIONS,
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

  const axis = extractStringArgument(code, operation, 'axis')

  const angleResult = await extractOptionalKclArgument(
    code,
    operation,
    'angle',
    rustContext
  )
  if (angleResult && 'error' in angleResult) {
    return { reason: angleResult.error }
  }
  const angle = angleResult

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
    objects: OMITTED_EDIT_SELECTIONS,
    roll,
    pitch,
    yaw,
    axis,
    angle,
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
    objects: OMITTED_EDIT_SELECTIONS,
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

/**
 * Collects the artifact ids an operation value refers to.
 *
 * `OpKclValue` serializes an artifact id in two different shapes, because the
 * Rust enum tags its variants without renaming their fields: variants whose
 * payload is a struct carry the id one level down as `value.artifactId`, while
 * variants that hold the id directly carry it as `artifact_id` on the variant
 * itself. Reading only the nested shape made hidden planes, GD&T annotations and
 * imported geometry invisible to every caller below.
 *
 * Every variant is listed so that adding one to `OpKclValue` fails to compile
 * here rather than silently dropping its id.
 */
function artifactIdsInOpValue(value: OpKclValue): string[] {
  switch (value.type) {
    // The id is a field of the variant, spelled as Rust spells it. `hide()`
    // accepts only Plane, GdtAnnotation and ImportedGeometry of these; Face and
    // Segment are read too, because what this function depends on is the
    // serialized shape rather than any one caller's accepted types.
    case 'Plane':
    case 'Face':
    case 'Segment':
    case 'GdtAnnotation':
    case 'ImportedGeometry':
      return [value.artifact_id]

    // The id belongs to a struct payload, which serializes camelCase.
    case 'Sketch':
    case 'Solid':
    case 'Helix':
      return [value.value.artifactId]

    // `hide([body001, body002])` arrives as an array of the variants above.
    case 'Array':
      return value.value.flatMap(artifactIdsInOpValue)

    // A tag identifier's artifact id is optional and a tag is not a hideable
    // value, so it is not collected. Object fields are not descended into for
    // the same reason: no hideable value is passed inside an object.
    case 'TagIdentifier':
    case 'TagDeclarator':
    case 'Object':
    case 'Uuid':
    case 'Bool':
    case 'Number':
    case 'String':
    case 'Enum':
    case 'SketchVar':
    case 'CameraView':
    case 'Function':
    case 'Module':
    case 'Type':
    case 'KclNone':
    case 'BoundedEdge':
      return []

    default: {
      const _exhaustiveCheck: never = value
      return _exhaustiveCheck
    }
  }
}

function getHideOperationArtifactIds(op: Operation): string[] {
  if (!(op.type === 'StdLibCall' && op.name === 'hide')) {
    return []
  }

  const value = op.unlabeledArg?.value
  if (!value) {
    return []
  }

  return artifactIdsInOpValue(value)
}

/** Returns every artifact id the used in the program as an argument to `hide()`*/
export function hiddenArtifactIdsFromOperations(
  operations: Operation[]
): Set<string> {
  return new Set(operations.flatMap(getHideOperationArtifactIds))
}

export function getHideOpByArtifactId(
  ops: Operation[],
  searchId: string
): HideOperation | undefined {
  const found = ops.find((op) =>
    getHideOperationArtifactIds(op).includes(searchId)
  )

  return found as HideOperation | undefined
}

type ArtifactCodeRef = Extract<Artifact, { codeRef: unknown }>['codeRef']

function codeRefsMatch(left: ArtifactCodeRef, right: ArtifactCodeRef) {
  return (
    left.range.length === right.range.length &&
    left.range.every((value, index) => value === right.range[index]) &&
    JSON.stringify(left.nodePath) === JSON.stringify(right.nodePath)
  )
}

export function getHideOpForArtifact(input: {
  operations: Operation[]
  artifact: Artifact
  artifactGraph: ArtifactGraph
}): HideOperation | undefined {
  const { operations, artifact, artifactGraph } = input
  const directHideOperation = getHideOpByArtifactId(operations, artifact.id)
  if (directHideOperation) {
    return directHideOperation
  }

  if (!('codeRef' in artifact)) {
    return undefined
  }

  const equivalentArtifactIds = new Set(
    [...artifactGraph.values()].flatMap((candidate) => {
      if (
        !('codeRef' in candidate) ||
        !codeRefsMatch(candidate.codeRef, artifact.codeRef)
      ) {
        return []
      }

      return [candidate.id]
    })
  )

  return operations.find((op) =>
    getHideOperationArtifactIds(op).some((id) => equivalentArtifactIds.has(id))
  ) as HideOperation | undefined
}

export function onHide(props: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  modelingActor: ActorRefFrom<typeof modelingMachine>
  objects?: Selections
}) {
  const selection =
    props.objects ?? props.modelingActor.getSnapshot().context.selectionRanges

  props.modelingActor.send({
    type: 'Hide',
    data: {
      objects: selection,
    },
  })
}

export function onDelete(props: {
  modelingActor: ActorRefFrom<typeof modelingMachine>
  objects: Selections
}) {
  props.modelingActor.send({
    type: 'Delete',
    data: {
      objects: props.objects,
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
  const wasmInstance = await props.kclManager.rustContext.wasmInstancePromise
  const hideCall = getNodeFromPath<Node<CallExpressionKw>>(
    modifiedAst,
    pathToNode,
    wasmInstance,
    'CallExpressionKw'
  )
  const hideArgIsSyntacticArray =
    !err(hideCall) && hideCall.node.unlabeled?.type === 'ArrayExpression'

  if (
    props.hideOperation.unlabeledArg.value.type === 'Array' &&
    hideArgIsSyntacticArray &&
    'codeRef' in props.targetArtifact
  ) {
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
