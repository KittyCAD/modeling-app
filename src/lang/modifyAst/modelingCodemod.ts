import type { planImportedRegionAnchor } from '@src/lib/projectSession/importedSketchAnchor'
import { getRelativePathIfContained } from '@src/lib/paths'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import {
  applyProjectFileSnapshots,
  zookeeperEditPatchHistoryEvent,
} from '@src/lib/zookeeper/editorPlugin'
import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { KclManager } from '@src/lang/KclManager'
import {
  mockExecAstAndReportErrors,
  updateModelingState,
} from '@src/lang/modelingWorkflows'
import { setExperimentalFeatures } from '@src/lang/modifyAst/settings'
import {
  parse,
  recast,
  resultIsOk,
  type PathToNode,
  type Program,
} from '@src/lang/wasm'
import type { CommandReviewValidationError } from '@src/lib/commandTypes'
import { EXECUTION_TYPE_REAL } from '@src/lib/constants'
import type RustContext from '@src/lib/rustContext'
import { err, isErr } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'

const NO_INPUT_PROVIDED_MESSAGE = 'No input provided'

type ModelingCodemodRunContext<CommandArgs> = {
  args: CommandArgs
  ast: Node<Program>
  kclManager: KclManager
  wasmInstance: ModuleType
  planProjectEdits?: boolean
}

export type ModelingCodemodSuccess = {
  modifiedAst: Node<Program>
  pathToNode: PathToNode | PathToNode[]
  importedAnchor?: NonNullable<
    Awaited<ReturnType<typeof planImportedRegionAnchor>>
  >
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
  sourceSnapshot,
  planProjectEdits = false,
}: {
  codemod: ModelingCodemod<CommandArgs>
  commandArgs: CommandArgs
  kclManager: KclManager
  wasmInstance?: ModuleType
  planProjectEdits?: boolean
  sourceSnapshot?: {
    ast: Node<Program>
    code: string
  }
}) {
  const resolvedWasmInstance =
    wasmInstance ?? (await kclManager.wasmInstancePromise)
  let ast = sourceSnapshot?.ast ?? kclManager.ast

  if (
    shouldEnableExperimentalFeatures(codemod, commandArgs) &&
    kclManager.fileSettings.experimentalFeatures?.type !== 'Allow'
  ) {
    const astWithNewSetting = setExperimentalFeatures(
      sourceSnapshot?.code ?? kclManager.code,
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
    planProjectEdits,
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
  ): Promise<undefined | CommandReviewValidationError> => {
    if (!modelingActor) {
      return new Error('modelingMachine not found')
    }

    const { engineCommandManager, kclManager, rustContext } =
      modelingActor.getSnapshot().context
    const hasConnectionRes = hasEngineConnection(engineCommandManager)
    if (err(hasConnectionRes)) {
      return hasConnectionRes
    }

    const wasmInstance = await context.wasmInstancePromise
    const sourceSnapshot = {
      ast: kclManager.ast,
      code: kclManager.code,
    }
    const codemodResult = await runModelingCodemod({
      codemod,
      commandArgs: context.argumentsToSubmit as CommandArgs,
      kclManager,
      wasmInstance,
      sourceSnapshot,
    })
    if (err(codemodResult)) {
      return codemodResult
    }

    const execRes = await mockExecAstAndReportErrors(
      codemodResult.modifiedAst,
      rustContext
    )
    if (isErr(execRes)) {
      const proposedCode = recast(codemodResult.modifiedAst, wasmInstance)
      if (isErr(proposedCode)) {
        return execRes
      }

      return Object.assign(new Error(execRes.message, { cause: execRes }), {
        reviewDetails: {
          type: 'codemod' as const,
          currentCode: sourceSnapshot.code,
          proposedCode,
        },
      })
    }
  }
}

export function createModelingCodemodActor<CommandArgs>(
  codemod: ModelingCodemod<CommandArgs>
) {
  return async ({
    input,
    signal,
  }: {
    signal?: AbortSignal
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

    const { kclManager } = input
    const sourceSnapshot = { ast: kclManager.ast, code: kclManager.code }
    const consumerPath = kclManager.path
    const codemodResult = await runModelingCodemod({
      codemod,
      commandArgs: input.data,
      kclManager: input.kclManager,
      wasmInstance: input.wasmInstance,
      sourceSnapshot,
      planProjectEdits: true,
    })
    if (err(codemodResult)) {
      return Promise.reject(codemodResult)
    }

    const anchor = codemodResult.importedAnchor
    if (anchor) {
      const { fileOperations } = kclManager.systemDeps
      const relativePath = getRelativePathIfContained(
        anchor.projectPath,
        consumerPath
      )
      if (!relativePath)
        throw new Error('The consumer is outside the current project.')
      const wasm = input.wasmInstance ?? (await kclManager.wasmInstancePromise)
      const code = recast(codemodResult.modifiedAst, wasm)
      if (isErr(code)) throw code
      const parsed = parse(code, wasm)
      if (isErr(parsed)) throw parsed
      if (!resultIsOk(parsed))
        throw new Error('Could not parse the anchored fillet.')
      const consumer = {
        relativePath,
        absolutePath: consumerPath,
        previousContent: sourceSnapshot.code,
        nextContent: code,
      }
      const assertCurrent = () => {
        if (
          signal?.aborted ||
          kclManager.path !== consumerPath ||
          kclManager.code !== sourceSnapshot.code ||
          kclManager.systemDeps.project.peek()?.path !== anchor.projectPath
        ) {
          throw new Error('The current file changed while applying the fillet.')
        }
      }
      let staged = false
      try {
        assertCurrent()
        await applyProjectFileSnapshots(fileOperations, [anchor.edit], 'redo')
        staged = true
        await input.rustContext.sendUpdateFile(
          anchor.fileId,
          anchor.edit.nextContent
        )
        const settings = jsAppSettings(input.rustContext.settingsActor)
        const refreshed = await input.rustContext.hackSetProgram(
          sourceSnapshot.ast,
          settings
        )
        if (refreshed.type !== 'Success')
          throw new Error('Could not load the imported anchor.')
        await input.rustContext.execute(parsed.program, settings, consumerPath)
        assertCurrent()
        await applyProjectFileSnapshots(fileOperations, [consumer], 'redo')
      } catch (error) {
        if (staged) {
          await applyProjectFileSnapshots(fileOperations, [anchor.edit], 'undo')
          await input.rustContext.sendUpdateFile(
            anchor.fileId,
            anchor.edit.previousContent
          )
          if (kclManager.path === consumerPath) {
            await kclManager.executeAst({ ast: sourceSnapshot.ast })
          }
        }
        throw error
      }
      kclManager.addGlobalHistoryEventWithCodeChange(
        zookeeperEditPatchHistoryEvent({
          projectPath: anchor.projectPath,
          activeFilePath: consumerPath,
          patch: { run_id: crypto.randomUUID() },
          snapshotFiles: [anchor.edit, consumer],
        }),
        code,
        sourceSnapshot.code,
        { shouldExecute: false }
      )
      await kclManager.executeAst({ ast: parsed.program })
      return
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
