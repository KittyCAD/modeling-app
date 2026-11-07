import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provide,
  provideService,
} from '@kittycad/registry'
import { useSignals } from '@preact/signals-react/runtime'
import { createElement } from 'react'
import { createEditorSave } from '@src/lib/save/save'
import {
  editorSaveService,
  editorOnSaveValueSpec,
} from '@src/lib/save/registry/contract'
import {
  editorCapabilityValueSpec,
  codeEditorExtensionValueSpec,
  editorTabIndicatorValueSpec,
  editorsService,
  type Editor,
} from '@src/lib/editors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import persistToDiskExtension from '@src/lib/save/persistToDisk/registry'
import {
  GLOBAL_COMMAND_SCOPES,
  provideCommand,
} from '@src/registry/contracts/commands'
import { keymapEventOwnersValueSpec } from '@src/registry/contracts/keymap'

export const SAVE_EDITOR_COMMAND = {
  id: 'zds.editors.save',
  name: 'save-editor',
  groupId: 'editors',
} as const

/** Assemble saving, focused keyboard behavior, and its optional tab decoration. */
const extension = defineRegistryItemFactory(({ services, valueSpecs }) => {
  const saving = createEditorSave(() => valueSpecs.get(editorOnSaveValueSpec))
  function UnsavedIndicator({ editor }: { editor: Editor }) {
    useSignals()
    if (!saving.service.state(editor).value.dirty) return null
    return createElement('span', {
      role: 'img',
      'aria-label': 'Unsaved changes',
      title: 'Unsaved changes',
      className: 'inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary',
    })
  }
  return {
    providesServices: [provideService(editorSaveService, saving.service)],
    provides: [
      provide(editorCapabilityValueSpec, {
        id: 'editors.save',
        matches: '*',
        setup: saving.setup,
      }),
      provide(codeEditorExtensionValueSpec, {
        id: 'editors.save.focused',
        matches: '*',
        extensions: saving.codeExtensions,
      }),
      provide(editorTabIndicatorValueSpec, {
        id: 'editors.unsaved',
        component: UnsavedIndicator,
      }),
      provide(keymapEventOwnersValueSpec, {
        id: 'editors.save',
        scope: 'editors.save.focused',
        owns: (event) =>
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          !event.shiftKey &&
          event.key.toLowerCase() === 's' &&
          (services
            .optional(editorsService)
            ?.views.peek()
            .some((instance) => {
              const view = instance.codeView.peek()
              return view ? event.composedPath().includes(view.dom) : false
            }) ??
            false),
      }),
      provideCommand({
        ...SAVE_EDITOR_COMMAND,
        displayName: 'Save editor',
        description: 'Save the last focused editor.',
        scopes: GLOBAL_COMMAND_SCOPES,
        needsReview: false,
        onSubmit: () => {
          const editor = saving.service.lastFocusedEditor.peek()
          return editor
            ? saving.service.save(editor)
            : new Error('Focus an editor to save it')
        },
      }),
    ],
    dispose: saving.dispose,
  }
}, 'save')

/** The semantic save extension can be installed with any persistence strategy. */
export const saveExtension = withProjectShellFeature(extension, 'save')

/** The app's default bundle installs disk persistence as a separate contribution. */
export default defineRegistryItem({
  id: 'save.defaults',
  uses: [saveExtension, persistToDiskExtension],
})
