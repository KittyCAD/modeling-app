import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { KclManager } from '@src/lang/KclManager'
import {
  mockExecAstAndReportErrors,
  updateModelingState,
} from '@src/lang/modelingWorkflows'
import { setExperimentalFeatures } from '@src/lang/modifyAst/settings'
import type { PathToNode, Program } from '@src/lang/wasm'
import { EXECUTION_TYPE_REAL } from '@src/lib/constants'
import type RustContext from '@src/lib/rustContext'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'

const NO_INPUT_PROVIDED_MESSAGE = 'No input provided'

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
  codemod: ModelingCodemod<CommandArgs>,
  commandArgs: CommandArgs
) =>
  typeof codemod.enableExperimentalFeatures === 'function'
    ? codemod.enableExperimentalFeatures(commandArgs)
    : Boolean(codemod.enableExperimentalFeatures)

const hasEngineConnection = (
  engineCommandManager: ConnectionManager
): true | Error => {
  return (
    engineCommandManager.connection?.connected ||
    new Error('No engine connection to send command')
  )
}

const normalizeFocusPath = <CommandArgs>(
  codemod: ModelingCodemod<CommandArgs>,
  result: ModelingCodemodSuccess,
  commandArgs: CommandArgs
): PathToNode[] | undefined => {
  if (codemod.focusPath === false) {
    return undefined
  }

  if (typeof codemod.focusPath === 'function') {
    return codemod.focusPath(result, commandArgs)
  }

  return isArray(result.pathToNode[0]?.[0])
    ? (result.pathToNode as PathToNode[])
    : [result.pathToNode as PathToNode]
}

export async function runModelingCodemod<CommandArgs>({
  codemod,
  commandArgs,
  kclManager,
  wasmInstance,
}: {
  codemod: ModelingCodemod<CommandArgs>
  commandArgs: CommandArgs
  kclManager: KclManager
  wasmInstance?: ModuleType
}) {
  const resolvedWasmInstance =
    wasmInstance ?? (await kclManager.wasmInstancePromise)
  let ast = kclManager.ast

  if (
    shouldEnableExperimentalFeatures(codemod, commandArgs) &&
    kclManager.fileSettings.experimentalFeatures?.type !== 'Allow'
  ) {
    const astWithNewSetting = setExperimentalFeatures(
      kclManager.code,
      {
        type: 'Allow',
      },
      resolvedWasmInstance
    )
    if (err(astWithNewSetting)) {
      return astWithNewSetting
    }

    ast = astWithNewSetting
  }

  return await codemod.run({
    args: commandArgs,
    ast,
    kclManager,
    wasmInstance: resolvedWasmInstance,
  })
}

export function createModelingCodemodReviewValidation<CommandArgs>(
  codemod: ModelingCodemod<CommandArgs>
) {
  return async (
    context: {
      argumentsToSubmit: Record<string, unknown>
      wasmInstancePromise: Promise<ModuleType>
    },
    modelingActor?: {
      getSnapshot: () => {
        context: {
          engineCommandManager: ConnectionManager
          kclManager: KclManager
          rustContext: RustContext
        }
      }
    }
  ): Promise<undefined | Error> => {
    if (!modelingActor) {
      return new Error('modelingMachine not found')
    }

    const { engineCommandManager, kclManager, rustContext } =
      modelingActor.getSnapshot().context
    const hasConnectionRes = hasEngineConnection(engineCommandManager)
    if (err(hasConnectionRes)) {
      return hasConnectionRes
    }

    const codemodResult = await runModelingCodemod({
      codemod,
      commandArgs: context.argumentsToSubmit as CommandArgs,
      kclManager,
      wasmInstance: await context.wasmInstancePromise,
    })
    if (err(codemodResult)) {
      return codemodResult
    }

    const execRes = await mockExecAstAndReportErrors(
      codemodResult.modifiedAst,
      rustContext
    )
    if (err(execRes)) {
      return execRes
    }
  }
}

export function createModelingCodemodActor<CommandArgs>(
  codemod: ModelingCodemod<CommandArgs>
) {
  return async ({
    input,
  }: {
    input:
      | {
          data: CommandArgs | undefined
          kclManager: KclManager
          rustContext: RustContext
          wasmInstance?: ModuleType
        }
      | undefined
  }) => {
    if (!input || !input.data) {
      return Promise.reject(new Error(NO_INPUT_PROVIDED_MESSAGE))
    }

    const codemodResult = await runModelingCodemod({
      codemod,
      commandArgs: input.data,
      kclManager: input.kclManager,
      wasmInstance: input.wasmInstance,
    })
    if (err(codemodResult)) {
      return Promise.reject(codemodResult)
    }

    await updateModelingState(
      codemodResult.modifiedAst,
      EXECUTION_TYPE_REAL,
      input.kclManager,
      {
        focusPath: normalizeFocusPath(codemod, codemodResult, input.data),
      }
    )
  }
}
