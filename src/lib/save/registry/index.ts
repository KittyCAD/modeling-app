import { editorViewForTarget } from '@src/lib/editors/focus'
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
  codeEditorsExtensionValueSpec,
  editorTabIndicatorsValueSpec,
  editorsService,
  type Editor,
} from '@src/lib/editors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import autosaveExtension from '@src/lib/save/autosave/registry'
import persistToFilesExtension from '@src/lib/save/persistToFiles/registry'
import {
  GLOBAL_COMMAND_SCOPES,
  provideCommand,
} from '@src/registry/contracts/commands'
import { isErr, trap, reportRejection } from '@src/lib/trap'
import { keymapEventOwnersValueSpec } from '@src/registry/contracts/keymap'

export const SAVE_EDITOR_COMMAND = {
  id: 'zds.editors.save',
  name: 'save-editor',
  groupId: 'editors',
} as const

/** Assemble saving, focused keyboard behavior, and its optional tab decoration. */
const extension = defineRegistryItemFactory(({ services, valueSpecs }) => {
  const saving = createEditorSave(() => valueSpecs.get(editorOnSaveValueSpec))
  const editorForEvent = (event: Event) =>
    editorViewForTarget(
      services.optional(editorsService)?.views.peek() ?? [],
      event.composedPath()[0] ?? event.target
    )?.editor
  const isSaveShortcut = (event: KeyboardEvent) =>
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 's'
  const onFocus = (event: FocusEvent) => {
    const editor = editorForEvent(event)
    if (editor) saving.focus(editor)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !isSaveShortcut(event)) return
    const editor = editorForEvent(event)
    if (!editor) return
    event.preventDefault()
    event.stopPropagation()
    saving.focus(editor)
    void saving.service
      .save(editor)
      .then((result) => {
        if (isErr(result)) trap(result)
      })
      .catch(reportRejection)
  }
  window.addEventListener('focusin', onFocus)
  window.addEventListener('keydown', onKeyDown)
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
      provide(codeEditorsExtensionValueSpec, {
        id: 'editors.save.focused',
        matches: '*',
        extensions: saving.codeExtensions,
      }),
      provide(editorTabIndicatorsValueSpec, {
        id: 'editors.unsaved',
        component: UnsavedIndicator,
      }),
      provide(keymapEventOwnersValueSpec, {
        id: 'editors.save',
        scope: 'editors.save.focused',
        owns: (event) =>
          isSaveShortcut(event) && editorForEvent(event) !== undefined,
      }),
      provideCommand({
        ...SAVE_EDITOR_COMMAND,
        displayName: 'Save editor',
        description: 'Save the last focused editor.',
        scopes: GLOBAL_COMMAND_SCOPES,
        needsReview: false,
        onSubmit: async () => {
          const editor = saving.service.lastFocusedEditor.peek()
          if (!editor) return new Error('Focus an editor to save it')
          const result = await saving.service.save(editor)
          return result
        },
      }),
    ],
    dispose: () => {
      window.removeEventListener('focusin', onFocus)
      window.removeEventListener('keydown', onKeyDown)
      saving.dispose()
    },
  }
}, 'save')

/** The semantic save extension can be installed with any persistence strategy. */
export const saveExtension = withProjectShellFeature(extension, 'save')

/** The app's default bundle installs file persistence as a separate contribution. */
export default defineRegistryItem({
  id: 'save.defaults',
  uses: [saveExtension, persistToFilesExtension, autosaveExtension],
})
