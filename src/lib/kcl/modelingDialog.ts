import { entityReferenceKey } from '@src/lib/scene/entityReference'
import type { SelectionReferenceHost } from '@src/hooks/useSelectionReferences'
import { getKclLanguageVersion } from '@src/lang/kclLanguageVersion'
import { isolateHistory } from '@codemirror/commands'
import { Transaction } from '@codemirror/state'
import { defineRegistryItem, provide, Registry } from '@kittycad/registry'
import {
  computed,
  effect,
  signal,
  batch,
  type ReadonlySignal,
} from '@preact/signals-core'
import type { EntityReference } from '@kittycad/lib'
import {
  filterDialogSelection,
  getDialogFields,
  hasValue,
  resolveArguments,
} from '@src/components/ModelingDialog/arguments'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { evaluateCommandArgumentFlags } from '@src/components/CommandBar/utils'
import type { CommandKclModel } from '@src/components/CommandBar/CommandKclInput'
import { resolveToCodeRef } from '@src/lang/queryAst'
import { documentChanges } from '@src/lib/editors/changes'
import { editorsExtension } from '@src/lib/editors/registry'
import {
  editorsService,
  editorViewsValueSpec,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import { createEditorCleanup } from '@src/lib/editors/lifecycle'
import {
  captureModel,
  type KclModelSnapshot,
} from '@src/lib/kcl/modelingTarget'
import { prepareModelingEdit } from '@src/lib/kcl/modelingEdit'
import type { ModelingViewContext } from '@src/lib/kcl/registry/contract'
import type { StdlibTool } from '@src/lib/kcl/stdlibTools'
import { toolCommand } from '@src/lib/kcl/stdlibTools'
import { parseToolArguments } from '@src/lib/kcl/toolArguments'
import { boundSceneQueries } from '@src/lib/kcl/viewCommands'
import { defaultSelectionFilter } from '@src/lib/selectionFilterUtils'
import {
  engineTopologyFallbackFromReference,
  getEngineRegionSelectionFromPoint,
  normalizeEntityReference,
} from '@src/lib/selections'
import type {
  SelectionModel,
  SceneSelection,
  PickingArgument,
} from '@src/lib/scene/selection'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { isErr } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import { createElement, lazy, Suspense } from 'react'
const Form = lazy(() => import('@src/lib/kcl/ModelingToolForm'))

export function parseToolDocument(
  contents: string
): Record<string, unknown> | Error {
  try {
    const value: unknown = JSON.parse(contents)
    return value && typeof value === 'object' && !isArray(value)
      ? (value as Record<string, unknown>)
      : new Error('Command arguments must be a JSON object.')
  } catch (cause) {
    return new Error('Fix the JSON to edit or submit the arguments.', { cause })
  }
}
function selectionsFor(
  references: readonly EntityReference[],
  snapshot: KclModelSnapshot
): Selections {
  return {
    graphSelections: references.map((reference) => ({
      entityRef: reference,
      ...resolveToCodeRef(
        { entityRef: reference },
        snapshot.execState.artifactGraph
      ),
      engineTopologyFallback: engineTopologyFallbackFromReference(reference),
    })),
    otherSelections: [],
  }
}

/** Both modes share one argument document. Only pick provenance and unused dialog selection live outside JSON. */
export async function createModelingDialog<Args extends object>(
  context: ModelingViewContext,
  tool: StdlibTool<Args>,
  experimental: boolean,
  onClose: () => void,
  isOpeningCurrent: () => boolean = () => true
) {
  const initial = captureModel(context)
  if (isErr(initial)) return initial
  const wasm = await context.wasm
  if (!isOpeningCurrent() || !initial.isCurrent())
    return new Error('The model changed before the tool opened.')
  const command = toolCommand(tool, initial.contents, wasm, experimental)
  if (isErr(command)) return command
  const resources = createEditorCleanup()
  const registry = new Registry()
  resources.onDispose(() => registry[Symbol.dispose]())
  const target = signal(initial)
  const activeName = signal<string | undefined>(undefined)
  const error = signal<Error | undefined>(undefined)
  const submitting = signal(false)
  const picks = new Map<
    string,
    { arg: PickingArgument; values: ReadonlySignal<readonly SceneSelection[]> }
  >()
  const sourceValues = (references: readonly EntityReference[]) =>
    selectionsFor(references, target.peek())
  const defaults: Record<string, unknown> = {}
  for (const [name, arg] of Object.entries(command.args ?? {})) {
    if (arg.inputType === 'selection') continue
    const { isRequired, isHidden } = evaluateCommandArgumentFlags(arg, {
      argumentsToSubmit: defaults,
    })
    if (isHidden || !(isRequired || arg.prepopulate || arg.skip)) continue
    if ('defaultValue' in arg && typeof arg.defaultValue !== 'function')
      defaults[name] = arg.defaultValue
    if (defaults[name] === undefined && arg.inputType === 'options') {
      const options =
        typeof arg.options === 'function'
          ? arg.options({ argumentsToSubmit: defaults })
          : arg.options
      defaults[name] = (
        options.find((option) => option.isCurrent) ?? options[0]
      )?.value
    }
  }
  try {
    registry.configure([
      editorsExtension,
      defineRegistryItem({
        provides: [
          provide(
            editorViewsValueSpec,
            defineEditorView({
              id: 'modeling-arguments.form',
              label: 'Form',
              matches: '*',
              priority: 1000,
              Component: () =>
                createElement(
                  Suspense,
                  { fallback: null },
                  createElement(Form, { dialog, context })
                ),
            })
          ),
        ],
      }),
    ])
    const editors = registry.get(editorsService)
    const editor = editors.createEditor(JSON.stringify(defaults, null, 2))
    if (isErr(editor)) {
      resources.dispose()
      return editor
    }
    const instance = editors.createView(editor, 'modeling-arguments.form')
    if (isErr(instance)) {
      resources.dispose()
      return instance
    }
    const receipts = signal<ReadonlyMap<string, SelectionModel>>(new Map())
    const raw = computed(() => parseToolDocument(editor.contents.value))
    const unused = signal<readonly SceneSelection[]>([])
    const automaticField = signal<string | undefined>(undefined)
    const writeField = (name: string, value: unknown, userEdit = true) => {
      const parsed = raw.peek()
      if (isErr(parsed)) return parsed
      if (JSON.stringify(parsed[name]) === JSON.stringify(value)) return
      editor.dispatch({
        changes: documentChanges(
          editor.state.doc,
          JSON.stringify({ ...parsed, [name]: value }, null, 2)
        ),
        userEvent: 'input.form',
        annotations: Transaction.addToHistory.of(userEdit),
      })
    }
    const remember = (next: readonly SceneSelection[]) => {
      const previous = receipts.peek()
      const entries = new Map(previous)
      for (const value of next) {
        const key = entityReferenceKey(value.reference)
        if (key) entries.set(key, value.model)
      }
      if ([...entries].some(([key, owner]) => previous.get(key) !== owner))
        receipts.value = entries
    }
    const references = (value: unknown): EntityReference[] | Error => {
      if (value === undefined) return []
      if (!isArray(value))
        return new Error(
          'Selection arguments must contain an array of picked entity references.'
        )
      const result: EntityReference[] = []
      for (const item of value) {
        const reference = normalizeEntityReference(item)
        const key = reference && entityReferenceKey(reference)
        if (!reference || !key)
          return new Error(
            'Invalid geometry reference. Pick geometry in this scene.'
          )
        if (receipts.value.get(key) !== target.value.model)
          return new Error(
            'This geometry was not picked from the current model. Pick again.'
          )
        result.push(reference)
      }
      return result
    }
    for (const [name, definition] of Object.entries(command.args ?? {})) {
      if (definition.inputType !== 'selection') continue
      const values = computed<readonly SceneSelection[]>(() => {
        const document = raw.value
        if (isErr(document)) return []
        const refs = references(document[name])
        return isErr(refs)
          ? []
          : refs.map((reference) => ({ model: target.value.model, reference }))
      })
      const arg: PickingArgument = {
        id: name,
        multiple: definition.multiple,
        filter: definition.selectionFilter ?? defaultSelectionFilter,
        value: values,
        accepts: (reference) =>
          hasValue(
            filterDialogSelection(
              sourceValues([reference]),
              definition,
              target.peek().ast,
              target.peek().execState.artifactGraph
            )
          ),
        setValue: (next, intent) =>
          batch(() => {
            remember(next)
            const failure = writeField(
              name,
              next.length ? next.map((value) => value.reference) : undefined,
              !!intent
            )
            if (failure) error.value = failure
          }),
      }
      picks.set(name, { arg, values })
    }
    const automaticValue = computed(() =>
      automaticField.value
        ? (picks.get(automaticField.value)?.values.value ?? [])
        : unused.value
    )
    const automatic: PickingArgument = {
      id: 'dialog.scope',
      filter: defaultSelectionFilter,
      multiple: true,
      value: automaticValue,
      accepts: () => true,
      setValue: (next, intent) => {
        if (!intent) {
          unused.value = []
          automaticField.value = undefined
          return
        }
        if (next === automaticValue.peek()) return
        const draft = values.peek()
        if (isErr(draft)) {
          batch(() => {
            remember(next)
            unused.value = next
            automaticField.value = undefined
          })
          return
        }
        const fields = getDialogFields({
          selectedCommand: command,
          argumentsToSubmit: draft,
        }).filter((field) => field.arg.inputType === 'selection')
        const previous = automaticField.peek()
        const prior =
          previous && fields.some((field) => field.name === previous)
            ? picks.get(previous)
            : undefined
        const destination =
          intent.additive &&
          prior?.arg.multiple &&
          next.every((value) => prior.arg.accepts(value.reference))
            ? prior
            : next.length
              ? fields
                  .map((field) => picks.get(field.name))
                  .find(
                    (item) =>
                      item &&
                      !item.values.peek().length &&
                      next.every((value) => item.arg.accepts(value.reference))
                  )
              : undefined
        batch(() => {
          if (destination) {
            destination.arg.setValue(next, intent)
            automaticField.value = destination.arg.id
            unused.value = []
          } else {
            remember(next)
            unused.value = next
            automaticField.value = undefined
          }
        })
      },
    }
    const picking = initial.scene.selection.beginPicking({
      arguments: [...picks.values()].map((item) => item.arg).concat(automatic),
      seed: 'sketches',
    })
    if (isErr(picking)) {
      resources.dispose()
      return picking
    }
    resources.onDispose(picking.close)
    const values = computed(() => {
      const document = raw.value
      if (isErr(document)) return document
      if (Object.hasOwn(document, 'nodeToEdit'))
        return new Error(
          'Editing existing operations is not supported by this tool.'
        )
      const result = { ...document }
      for (const [name, item] of picks) {
        const refs = references(document[name])
        if (isErr(refs)) return refs
        if (
          (!item.arg.multiple && refs.length > 1) ||
          refs.some((reference) => !item.arg.accepts(reference))
        )
          return new Error(`That geometry cannot be used for ${name}.`)
        result[name] = selectionsFor(refs, target.value)
      }
      return result
    })
    const model = computed<CommandKclModel | undefined>(() => {
      const snapshot = target.value
      const output = context.executor.output.value
      const source = context.executor.editor
      const scene = context.session.resource.value
      if (
        output.running ||
        source.contents.value !== snapshot.contents ||
        (source.src.value ?? '') !== snapshot.src ||
        source.readOnly.value ||
        scene !== snapshot.scene
      )
        return
      if (picking.model.value !== snapshot.model || !snapshot.isCurrent())
        return
      return {
        ast: snapshot.ast,
        astSignal: computed(() => snapshot.ast),
        codeSignal: computed(() => snapshot.contents),
        variablesSignal: computed(() => snapshot.execState.variables),
        rustContext: {
          wasmInstancePromise: context.wasm,
          evaluateExpression: async (ast) => {
            if (!snapshot.isCurrent())
              return Promise.reject(new Error('The model changed. Pick again.'))
            const result = await snapshot.scene.runtime.evaluateExpression(ast)
            return snapshot.isCurrent()
              ? result
              : Promise.reject(new Error('The model changed. Pick again.'))
          },
          waitForAllEngineModelingCommands:
            snapshot.scene.runtime.waitForAllEngineModelingCommands,
        },
      }
    })
    const referenceModel = computed<SelectionReferenceHost | undefined>(() => {
      const inputModel = model.value
      const snapshot = target.value
      return inputModel
        ? {
            ast: inputModel.ast,
            artifactGraph: snapshot.execState.artifactGraph,
            engineCommandManager: boundSceneQueries(
              context,
              snapshot.scene,
              snapshot.model
            ),
          }
        : undefined
    })
    const current = () => {
      const snapshot = target.peek()
      if (resources.closed || !snapshot.isCurrent())
        return new Error('The model changed. Pick again.')
      return picking.validate(
        [...picks.values()].flatMap((item) => item.values.peek())
      )
    }
    const save = (name: string, value: unknown) => {
      if (resources.closed) return new Error('The dialog closed.')
      if (picks.has(name))
        return new Error('Geometry arguments must be picked in the scene.')
      const nextValue =
        isKclCommandValue(value) && !('variableName' in value)
          ? value.valueText
          : value === ''
            ? undefined
            : value
      const failure = writeField(name, nextValue)
      if (failure) return failure
      error.value = undefined
    }
    const dialog = {
      command,
      editor,
      editors,
      instance,
      values,
      activeName,
      error,
      submitting,
      model,
      referenceModel,
      unusedSelection: unused as ReadonlySignal<readonly SceneSelection[]>,
      picking,
      invalidated: computed(
        () =>
          !picking.model.value ||
          picking.model.value !== initial.scene.selection.model.value
      ),
      canSubmit: computed(() => {
        const draft = values.value
        return (
          !submitting.value &&
          !!model.value &&
          !isErr(draft) &&
          getDialogFields({
            selectedCommand: command,
            argumentsToSubmit: draft,
          }).every((field) => !field.required || hasValue(draft[field.name]))
        )
      }),
      cancel: () => {
        resources.dispose()
        onClose()
      },
      save,
      activate: (name: string | undefined) => {
        error.value = undefined
        if (name && (!picking.model.peek() || !target.peek().isCurrent())) {
          const next = captureModel(context)
          if (isErr(next)) {
            error.value = next
            return next
          }
          if (next.scene !== initial.scene)
            return new Error('The scene closed. Reopen the tool.')
          if (
            getKclLanguageVersion(next.ast, wasm) !==
            getKclLanguageVersion(initial.ast, wasm)
          ) {
            const failure = new Error(
              'The KCL version changed. Reopen the tool.'
            )
            error.value = failure
            return failure
          }
          const rebound = picking.bindCurrentModel()
          if (isErr(rebound)) {
            error.value = rebound
            return rebound
          }
          target.value = next
        }
        if (!name && !picking.model.peek()) {
          activeName.value = undefined
          return
        }
        if (!name && activeName.peek()) automaticField.value = activeName.peek()
        const result = picking.activate(name ?? automatic.id)
        if (isErr(result)) error.value = result
        else activeName.value = name
        return result
      },
      setMode: (id: string) => {
        dialog.activate(undefined)
        editor.dispatch({ annotations: isolateHistory.of('full') })
        return editors.setView(instance.id, id)
      },
      updateSelection: (name: string, next: Selections) => {
        const item = picks.get(name)
        if (!item) return new Error('Unknown selection argument.')
        const previous = item.values.peek()
        const keys = new Set(
          next.graphSelections.map(
            (selection) =>
              selection.entityRef && entityReferenceKey(selection.entityRef)
          )
        )
        if (
          next.otherSelections.length ||
          keys.has(undefined) ||
          [...keys].some(
            (key) =>
              !previous.some(
                (value) => entityReferenceKey(value.reference) === key
              )
          )
        )
          return new Error('Pick geometry in the owning scene.')
        item.arg.setValue(
          previous.filter((value) =>
            keys.has(entityReferenceKey(value.reference))
          ),
          { additive: false }
        )
      },
      submit: async () => {
        if (submitting.peek() || resources.closed) return
        const draft = editor.state.doc
        const snapshot = target.peek()
        const initialValues = values.peek()
        if (isErr(initialValues)) {
          error.value = initialValues
          return
        }
        const requestCurrent = () =>
          !isErr(current()) && editor.state.doc === draft
        const ownership = current()
        if (isErr(ownership)) {
          error.value = ownership
          return
        }
        submitting.value = true
        error.value = undefined
        try {
          const commands = boundSceneQueries(
            context,
            snapshot.scene,
            snapshot.model
          )
          const converted = { ...initialValues }
          for (const [name, item] of picks) {
            const selection: Selections = {
              graphSelections: [],
              otherSelections: [],
            }
            for (const { reference } of item.values.peek()) {
              if (reference.type === 'region') {
                const region = await getEngineRegionSelectionFromPoint(
                  reference.region_id,
                  snapshot.execState.artifactGraph,
                  snapshot.ast,
                  commands,
                  wasm
                )
                if (!region)
                  return void (error.value = new Error(
                    'Unable to resolve that region. Pick again.'
                  ))
                selection.otherSelections.push(region)
              } else
                selection.graphSelections.push(
                  ...selectionsFor([reference], snapshot).graphSelections
                )
              if (!requestCurrent())
                return void (error.value = new Error(
                  'The draft or model changed. Submit again.'
                ))
            }
            converted[name] = selection
          }
          const runtime = model.peek()?.rustContext
          if (!runtime)
            return void (error.value = new Error(
              'The model changed. Pick again.'
            ))
          const resolved = await resolveArguments(
            { selectedCommand: command, argumentsToSubmit: converted },
            converted,
            runtime,
            snapshot.ast,
            snapshot.execState.artifactGraph
          )
          if (isErr(resolved)) return void (error.value = resolved)
          const parsed = parseToolArguments(
            tool.arguments,
            resolved,
            command.args ?? {}
          )
          if (parsed instanceof Error) return void (error.value = parsed)
          const prepared = await prepareModelingEdit({
            name: tool.name,
            codemod: tool.codemod,
            editor: context.executor.editor,
            args: parsed,
            wasmInstance: wasm,
            getExecution: () => (requestCurrent() ? snapshot : undefined),
            validate: (ast, execution) =>
              snapshot.scene.runtime.validate(ast, execution.src || 'main.kcl'),
          })
          if (resources.closed) return
          if (isErr(prepared)) return void (error.value = prepared)
          const failure = prepared.commit()
          if (failure) error.value = failure
          else dialog.cancel()
        } catch (cause) {
          if (!resources.closed)
            error.value = isErr(cause)
              ? cause
              : new Error('Unable to apply the command.', { cause })
        } finally {
          submitting.value = false
        }
      },
    }
    resources.onDispose(
      effect(() => {
        if (!picking.model.value) {
          activeName.value = undefined
          receipts.value = new Map()
        }
      })
    )
    resources.onDispose(() =>
      context.executor.editor.signal.removeEventListener('abort', dialog.cancel)
    )
    context.executor.editor.signal.addEventListener('abort', dialog.cancel, {
      once: true,
    })
    picking.activate(automatic.id)
    command.onSubmit = dialog.submit
    return dialog
  } catch (cause) {
    resources.dispose()
    return isErr(cause)
      ? cause
      : new Error('Unable to open command arguments.', { cause })
  }
}
export type ModelingToolDialog = Exclude<
  Awaited<ReturnType<typeof createModelingDialog>>,
  Error
>
