import type { CommandArgumentsBinding } from '@src/lib/commandArguments/registry/contract'
import { createArgumentModelLookup } from '@src/lib/kcl/argumentModel'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { isSelections } from '@src/lib/selections'
import { reportRejection } from '@src/lib/trap'
import { lazy, Suspense } from 'react'
import type { ReadonlySignal } from '@preact/signals-core'
import type { Command } from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import type { ExtrudeCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import {
  extrudeCommandConfig,
  prepareStdlibExtrude,
} from '@src/lib/kcl/stdlibExtrude'
import {
  currentModel,
  modelingTargetBinding,
  type ModelingTarget,
} from '@src/lib/kcl/modelingTarget'
import { parse, resultIsOk } from '@src/lang/wasm'
import { isKclVersionAvailable } from '@src/lib/kclVersionRange'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'
// The input widgets import the app context; load them after registry initialization.
const ViewerArgumentInput = lazy(
  () => import('@src/lib/kcl/ModelingArgumentInput')
)

export const STDLIB_EXTRUDE_COMMAND = {
  id: 'kcl.extrude',
  name: 'Extrude',
  groupId: 'kcl-modeling',
} as const

/** Bind the existing stdlib definition to explicit viewer targets, retaining palette review. */
export function createViewerExtrudeCommand(
  targets: ReadonlySignal<readonly ModelingTarget[]>,
  wasmPromise: Promise<ModuleType>,
  showExperimentalCommands: () => boolean = () => false,
  openDialog?: (binding: CommandArgumentsBinding) => Promise<void>
): Command {
  let loadedWasm: ModuleType | undefined
  void wasmPromise
    .then((wasm) => {
      loadedWasm = wasm
    })
    .catch(reportRejection)
  const lookupModel = createArgumentModelLookup(wasmPromise)
  const targetFor = (args: Record<string, unknown>) =>
    typeof args.modelingTarget === 'string'
      ? targets
          .peek()
          .find(
            (target) => modelingTargetBinding(target) === args.modelingTarget
          )
      : undefined
  const args: NonNullable<Command['args']> = {
    modelingTarget: {
      inputType: 'options',
      displayName: 'Model',
      required: true,
      options: () =>
        targets.value.filter(currentModel).map((target) => ({
          name: target.editor.src.value ?? 'Untitled',
          value: modelingTargetBinding(target),
        })),
    },
  }
  for (const [name, config] of Object.entries(extrudeCommandConfig.args)) {
    const { availableInKclVersion, available: _available, ...argument } = config
    const isAvailable = (context: {
      argumentsToSubmit: Record<string, unknown>
    }) => {
      if (config.status === 'experimental' && !showExperimentalCommands())
        return false
      if (!availableInKclVersion) return true
      const target = targetFor(context.argumentsToSubmit)
      const snapshot = target && currentModel(target)
      if (!snapshot || !loadedWasm) return false
      const parsed = parse(snapshot.contents, loadedWasm)
      return (
        !(parsed instanceof Error) &&
        resultIsOk(parsed) &&
        isKclVersionAvailable(
          parsed.kclVersion,
          availableInKclVersion,
          loadedWasm
        )
      )
    }
    args[name] = {
      ...argument,
      required: (context) =>
        isAvailable(context) &&
        (typeof config.required === 'function'
          ? config.required(context)
          : config.required),
      hidden: (context) =>
        !isAvailable(context) ||
        (typeof config.hidden === 'function'
          ? config.hidden(context)
          : Boolean(config.hidden)),
    }
  }
  const prepare = async (data: Record<string, unknown>) => {
    const wasm = await wasmPromise
    const target = targetFor(data)
    if (!target || !currentModel(target))
      return new Error('Execute the selected model before using Extrude')
    const sketches = data.sketches
    if (!isSelections(sketches)) return new Error('Select profiles to extrude')
    // Prepopulated fields can reach review without mounting their input widget.
    // Resolve their source expressions just as an explicitly submitted KCL input does.
    const resolved = { ...data }
    for (const [name, arg] of Object.entries(args)) {
      const value = resolved[name]
      if (
        (arg.inputType !== 'kcl' &&
          arg.inputType !== 'vector2d' &&
          arg.inputType !== 'vector3d') ||
        typeof value !== 'string'
      )
        continue
      const expression =
        arg.inputType === 'kcl' && arg.inputToKclValue
          ? arg.inputToKclValue(value.trim())
          : value.trim()
      const parsed = await stringToKclExpression(
        expression,
        {
          wasmInstancePromise: wasmPromise,
          evaluateExpression: target.session.evaluateExpression,
          waitForAllEngineModelingCommands:
            target.session.waitForAllEngineModelingCommands,
        },
        {
          allowArrays: arg.inputType !== 'kcl' || arg.allowArrays,
          allowStringArrays:
            arg.inputType === 'kcl' ? arg.allowStringArrays : undefined,
        }
      )
      if (
        parsed instanceof Error ||
        'errors' in parsed ||
        (parsed.valueCalculated === 'NAN' &&
          !(arg.inputType === 'kcl' && arg.allowUncalculated))
      )
        return new Error(`Invalid expression for ${arg.displayName || name}.`)
      resolved[name] = parsed
    }
    if (resolved.length !== undefined && !isKclCommandValue(resolved.length))
      return new Error('Invalid expression for Length.')
    // The palette's shared argument definitions produce the stdlib command schema.
    return prepareStdlibExtrude({
      editor: target.editor,
      args: resolved as ExtrudeCommandArgs,
      wasmInstance: wasm,
      getExecution: () =>
        targetFor(data) === target ? currentModel(target) : undefined,
      validate: (ast, snapshot) => target.session.validate(ast, snapshot),
    })
  }
  const command: Command = {
    ...STDLIB_EXTRUDE_COMMAND,
    icon: extrudeCommandConfig.icon,
    description: 'Extrude profiles in a Modeling editor.',
    scopes: GLOBAL_COMMAND_SCOPES,
    needsReview: true,
    get disabled() {
      return !targets.value.some(
        (target) =>
          target.session.snapshot.value &&
          target.editor.contents.value ===
            target.session.snapshot.value.contents &&
          target.editor.src.value === target.session.snapshot.value.src
      )
    },
    openEditorDialog: openDialog
      ? (context) => {
          void openDialog({
            command,
            context,
            getModel: (values) => {
              const target = targetFor(values)
              return target && loadedWasm
                ? lookupModel(target, loadedWasm)
                : undefined
            },
            prepare,
          }).catch(reportRejection)
        }
      : undefined,
    forceCommandBar: true,
    args,
    ArgumentInput: (props) => (
      <Suspense fallback={<p role="status">Loading argument input…</p>}>
        <ViewerArgumentInput
          {...props}
          targetFor={targetFor}
          wasmPromise={wasmPromise}
        />
      </Suspense>
    ),
    reviewValidation: async (context) => {
      const result = await prepare(context.argumentsToSubmit)
      return result instanceof Error ? result : undefined
    },
    onSubmit: async (data) => {
      const result = await prepare(data ?? {})
      return result instanceof Error ? result : result.commit()
    },
  }
  return command
}
