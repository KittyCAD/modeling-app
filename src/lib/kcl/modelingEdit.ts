import { isolateHistory } from '@codemirror/commands'
import {
  ChangeSet,
  Transaction,
  type ChangeSpec,
  type Text,
} from '@codemirror/state'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { prepareModelingCodemodAst } from '@src/lang/modifyAst/modelingCodemodDefinition'
import {
  type ExecState,
  type Program,
  kclSettings,
  parse,
  recast,
  resultIsOk,
} from '@src/lang/wasm'
import { documentChanges } from '@src/lib/editors/changes'
import type { Editor } from '@src/lib/editors/registry/contract'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

import type { KclModelSnapshot } from '@src/lib/kcl/modelingTarget'
import type {
  ModelingCodemod,
  ModelingCodemodSuccess,
} from '@src/lang/modifyAst/modelingCodemodDefinition'
import type { PathToNode } from '@src/lang/wasm'

/** A codemod can return an AST or disjoint changes expressed in the captured source's coordinates. */
export type ModelingEditResult =
  | ModelingCodemodSuccess
  | {
      changes: ChangeSpec
      pathToNode?: PathToNode | PathToNode[]
    }

/** Tools borrow execution data from the executor-owned session; they own no runtime resources. */
export interface KclModelingCodemod<Args>
  extends Pick<ModelingCodemod<Args>, 'enableExperimentalFeatures'> {
  transform: (context: {
    args: Args
    ast: Node<Program>
    source: Text
    artifactGraph: ExecState['artifactGraph']
    variables: ExecState['variables']
    wasmInstance: ModuleType
  }) => ModelingEditResult | Error | Promise<ModelingEditResult | Error>
}

/** Prepare the existing stdlib-derived operation without owning a modeling actor, file IO, or engine transport. */
export async function prepareModelingEdit<Args>({
  name,
  codemod,
  editor,
  args,
  getExecution,
  wasmInstance,
  validate,
}: {
  editor: Editor
  name: string
  codemod: KclModelingCodemod<Args>
  args: Args
  getExecution: () => KclModelSnapshot | undefined
  wasmInstance: ModuleType
  /** Review uses the host's analysis context and must not execute against the visible engine scene. */
  validate: (
    ast: Node<Program>,
    snapshot: KclModelSnapshot
  ) => Promise<Error | undefined>
}) {
  const snapshot = getExecution()
  const document = editor.state.doc
  const source = editor.src.peek()
  if (
    editor.readOnly.peek() ||
    !snapshot ||
    snapshot.src !== (source ?? '') ||
    snapshot.contents !== document.toString()
  )
    return new Error(`Execute the current buffer before preparing ${name}`)
  const isCurrent = () =>
    !editor.signal.aborted &&
    !editor.readOnly.peek() &&
    editor.state.doc === document &&
    editor.src.peek() === source &&
    getExecution() === snapshot
  const parsed = parse(snapshot.contents, wasmInstance)
  if (isErr(parsed)) return parsed
  if (!resultIsOk(parsed))
    return new Error(`Fix the KCL syntax before preparing ${name}`)
  const result = await codemod.transform({
    args,
    ast: parsed.program,
    source: document,
    artifactGraph: snapshot.execState.artifactGraph,
    variables: snapshot.execState.variables,
    wasmInstance,
  })
  if (isErr(result)) return result
  let changes: ChangeSet
  let proposed: Node<Program>
  if ('changes' in result) {
    try {
      changes = ChangeSet.of(result.changes, document.length)
    } catch (cause) {
      return new Error(`Invalid source changes for ${name}`, { cause })
    }
    const changed = changes.apply(document)
    const parsedChanges = parse(changed.toString(), wasmInstance)
    if (isErr(parsedChanges)) return parsedChanges
    if (!resultIsOk(parsedChanges))
      return new Error(`Invalid KCL produced by ${name}`)
    proposed = parsedChanges.program
  } else {
    proposed = result.modifiedAst
    const printed = recast(proposed, wasmInstance)
    if (isErr(printed)) return printed
    changes = documentChanges(document, printed)
  }
  const changed = changes.apply(document)
  const settings = kclSettings(proposed, wasmInstance)
  if (isErr(settings)) return settings
  // Annotate after the transform so AST ranges and native edits share the original source coordinates.
  const annotatedAst = prepareModelingCodemodAst({
    codemod,
    commandArgs: args,
    source: { ast: proposed, code: changed.toString() },
    experimentalFeaturesAllowed:
      settings?.experimentalFeatures?.type === 'Allow',
    wasmInstance,
  })
  if (isErr(annotatedAst)) return annotatedAst
  if (annotatedAst !== proposed) {
    const annotated = recast(annotatedAst, wasmInstance)
    if (isErr(annotated)) return annotated
    changes = changes.compose(documentChanges(changed, annotated))
    proposed = annotatedAst
  }
  let validationError: Error | undefined
  try {
    validationError = await validate(proposed, snapshot)
  } catch (cause) {
    return cause instanceof Error
      ? cause
      : new Error(`Unable to validate ${name}`, { cause })
  }
  if (!isCurrent())
    return new Error(`The buffer or execution changed while preparing ${name}`)
  if (validationError) return validationError
  const code = changes.apply(document).toString()
  return {
    changes,
    code,
    pathToNode: result.pathToNode,
    /** Check again at application time; moving the cursor is allowed, changing the source or execution is not. */
    commit: (): Error | undefined => {
      if (!isCurrent())
        return new Error(
          `The buffer or execution changed before applying ${name}`
        )
      if (!changes.empty)
        editor.dispatch({
          changes,
          annotations: [
            Transaction.userEvent.of(`input.modeling.${name.toLowerCase()}`),
            isolateHistory.of('full'),
          ],
        })
    },
  }
}
