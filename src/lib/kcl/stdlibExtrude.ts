import { isolateHistory } from '@codemirror/commands'
import { Transaction } from '@codemirror/state'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { prepareModelingCodemodAst } from '@src/lang/modifyAst/modelingCodemod'
import {
  type ExecState,
  type Program,
  kclSettings,
  parse,
  recast,
  resultIsOk,
} from '@src/lang/wasm'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import type { ExtrudeCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import { documentChanges } from '@src/lib/editors/changes'
import type { Editor } from '@src/lib/editors/registry/contract'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export { extrudeCommandConfig } from '@src/lib/commandBarConfigs/modelingCommandConfig'

/** The host must publish source and execution state together, replacing the snapshot for each run. */
export interface KclModelSnapshot {
  readonly src: string | undefined
  readonly contents: string
  readonly execState: ExecState
}

/** Prepare the existing stdlib-derived operation without owning a modeling actor, file IO, or engine transport. */
export async function prepareStdlibExtrude({
  editor,
  args,
  getExecution,
  wasmInstance,
  validate,
}: {
  editor: Editor
  args: ExtrudeCommandArgs
  getExecution: () => KclModelSnapshot | undefined
  wasmInstance: ModuleType
  /** Review uses the host's analysis context and must not execute against the visible engine scene. */
  validate: (
    ast: Node<Program>,
    snapshot: KclModelSnapshot
  ) => Promise<Error | undefined>
}) {
  const snapshot = getExecution()
  const document = editor.view.state.doc
  const source = editor.src.peek()
  if (
    !snapshot ||
    snapshot.src !== source ||
    snapshot.contents !== document.toString()
  )
    return new Error('Execute the current buffer before preparing Extrude')
  const isCurrent = () =>
    editor.view.state.doc === document &&
    editor.src.peek() === source &&
    getExecution() === snapshot
  const parsed = parse(snapshot.contents, wasmInstance)
  if (isErr(parsed)) return parsed
  if (!resultIsOk(parsed))
    return new Error('Fix the KCL syntax before preparing Extrude')
  const settings = kclSettings(parsed.program, wasmInstance)
  if (isErr(settings)) return settings
  const codemod = modelingCommandCodemods.Extrude
  const ast = prepareModelingCodemodAst({
    codemod,
    commandArgs: args,
    source: { ast: parsed.program, code: snapshot.contents },
    experimentalFeaturesAllowed:
      settings?.experimentalFeatures?.type === 'Allow',
    wasmInstance,
  })
  if (isErr(ast)) return ast
  const result = codemod.transform({
    args,
    ast,
    artifactGraph: snapshot.execState.artifactGraph,
    wasmInstance,
  })
  if (isErr(result)) return result
  let validationError: Error | undefined
  try {
    validationError = await validate(result.modifiedAst, snapshot)
  } catch (cause) {
    return cause instanceof Error
      ? cause
      : new Error('Unable to validate Extrude', { cause })
  }
  if (!isCurrent())
    return new Error('The buffer or execution changed while preparing Extrude')
  if (validationError) return validationError
  const code = recast(result.modifiedAst, wasmInstance)
  if (isErr(code)) return code
  const changes = documentChanges(document, code)
  return {
    changes,
    code,
    pathToNode: result.pathToNode,
    /** Check again at application time; moving the cursor is allowed, changing the source or execution is not. */
    commit: (): Error | undefined => {
      if (!isCurrent())
        return new Error(
          'The buffer or execution changed before applying Extrude'
        )
      if (!changes.empty)
        editor.view.dispatch({
          changes,
          annotations: [
            Transaction.userEvent.of('input.modeling.extrude'),
            isolateHistory.of('full'),
          ],
        })
    },
  }
}
