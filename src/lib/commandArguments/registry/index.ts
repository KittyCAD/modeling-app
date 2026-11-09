import { computed } from '@preact/signals-core'
import {
  defineRegistryItemFactory,
  provide,
  provideService,
} from '@kittycad/registry'
import { createElement, lazy, Suspense } from 'react'
import type { Editor } from '@src/lib/editors/registry/contract'
import { editorViewValueSpec } from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import {
  defineExecutorCapability,
  executorCapabilityValueSpec,
} from '@src/lib/executors/registry/contract'
import { editorDialogsExtension } from '@src/lib/editorDialogs/registry'
import { editorDialogsService } from '@src/lib/editorDialogs/registry/contract'
import {
  commandArgumentsService,
  COMMAND_ARGUMENTS_DOCUMENT,
  type CommandArgumentsBinding,
} from '@src/lib/commandArguments/registry/contract'
import { parseArgumentDocument } from '@src/lib/commandArguments/document'
import {
  initializeArguments,
  resolveArguments,
} from '@src/components/ModelingDialog/arguments'
const Form = lazy(
  () => import('@src/lib/commandArguments/CommandArgumentsForm')
)

/** The same stdlib schema resolves a raw command document and renders its contributed Form mode. */
export const commandArgumentsExtension = defineRegistryItemFactory(
  ({ services }) => {
    const bindings = new WeakMap<Editor, CommandArgumentsBinding>()
    const capability = defineExecutorCapability({
      id: 'command-arguments.resolve',
      matches: ({ documentType }) =>
        documentType === COMMAND_ARGUMENTS_DOCUMENT,
      execute: async (contents, { editor, signal }) => {
        const binding = bindings.get(editor)
        if (!binding) return new Error('This command draft is closed.')
        const values = parseArgumentDocument(contents)
        if (values instanceof Error) return values
        const model = binding.getModel(values)
        if (!model)
          return new Error(
            'Choose an executed model, or reopen the command if its execution changed.'
          )
        const resolved = await resolveArguments(
          binding.context,
          values,
          model.rustContext,
          model.ast,
          model.artifactGraph
        )
        if (resolved instanceof Error) return resolved
        if (signal.aborted)
          return new Error('Argument resolution was cancelled')
        const reviewed = await binding.prepare(resolved)
        if (reviewed instanceof Error) return reviewed
        return { values: resolved }
      },
    })
    return {
      id: 'command-arguments',
      uses: [editorDialogsExtension],
      provides: [
        provide(executorCapabilityValueSpec, capability),
        provide(
          editorViewValueSpec,
          defineEditorView(({ editor }) => {
            const binding = bindings.get(editor)
            if (!binding) return undefined
            const executor = services
              .get(editorDialogsService)
              .executorFor(editor)
            return {
              binding,
              resolution: computed(
                () => executor?.output.value.get(capability)?.values
              ),
            }
          })({
            id: 'command-arguments.form',
            label: 'Form',
            priority: 1000,
            matches: ({ documentType }) =>
              documentType === COMMAND_ARGUMENTS_DOCUMENT,
            Component: ({ editor, context }) =>
              context
                ? createElement(
                    Suspense,
                    { fallback: null },
                    createElement(Form, {
                      editor,
                      binding: context.binding,
                      resolution: context.resolution,
                    })
                  )
                : null,
          })
        ),
      ],
      providesServices: [
        provideService(commandArgumentsService, {
          open: async (binding) => {
            const values = await initializeArguments(binding.context)
            services.get(editorDialogsService).open({
              title: binding.command.displayName ?? binding.command.name,
              documentType: COMMAND_ARGUMENTS_DOCUMENT,
              contents: JSON.stringify(values, null, 2),
              capability,
              bind: (editor) => {
                bindings.set(editor, binding)
                return () => bindings.delete(editor)
              },
              prepareSubmit: (result) => binding.prepare(result.values),
            })
          },
        }),
      ],
    }
  },
  'command-arguments'
)
