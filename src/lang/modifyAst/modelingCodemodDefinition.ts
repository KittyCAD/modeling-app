import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { KclManager } from '@src/lang/KclManager'
import { setExperimentalFeatures } from '@src/lang/modifyAst/settings'
import type { PathToNode, Program } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
type ModelingCodemodRunContext<CommandArgs> = {
  args: CommandArgs
  ast: Node<Program>
  kclManager: KclManager
  wasmInstance: ModuleType
}

export type ModelingCodemodSuccess = {
  modifiedAst: Node<Program>
  pathToNode: PathToNode | PathToNode[]
}

export type ModelingCodemodResult = ModelingCodemodSuccess | Error

type MaybePromise<T> = T | Promise<T>

export type ModelingCodemod<CommandArgs> = {
  run: (
    context: ModelingCodemodRunContext<CommandArgs>
  ) => MaybePromise<ModelingCodemodResult>
  enableExperimentalFeatures?: boolean | ((commandArgs: CommandArgs) => boolean)
  focusPath?:
    | false
    | ((
        result: ModelingCodemodSuccess,
        commandArgs: CommandArgs
      ) => PathToNode[] | undefined)
}

export const defineModelingCodemod = <CommandArgs>(
  codemod: ModelingCodemod<CommandArgs>
) => codemod

const shouldEnableExperimentalFeatures = <CommandArgs>(
  codemod: Pick<ModelingCodemod<CommandArgs>, 'enableExperimentalFeatures'>,
  commandArgs: CommandArgs
) =>
  typeof codemod.enableExperimentalFeatures === 'function'
    ? codemod.enableExperimentalFeatures(commandArgs)
    : Boolean(codemod.enableExperimentalFeatures)

/** Preserve command-specific experimental opt-in for hosts that do not own a KclManager. */
export function prepareModelingCodemodAst<Args>({
  codemod,
  commandArgs,
  source,
  experimentalFeaturesAllowed,
  wasmInstance,
}: {
  codemod: Pick<ModelingCodemod<Args>, 'enableExperimentalFeatures'>
  commandArgs: Args
  source: { ast: Node<Program>; code: string }
  experimentalFeaturesAllowed: boolean
  wasmInstance: ModuleType
}): Node<Program> | Error {
  return shouldEnableExperimentalFeatures(codemod, commandArgs) &&
    !experimentalFeaturesAllowed
    ? setExperimentalFeatures(source.code, { type: 'Allow' }, wasmInstance)
    : source.ast
}
