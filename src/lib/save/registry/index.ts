import { editorViewForTarget } from '@src/lib/editors/focus'
import { factory, contribute, provide } from 'plankton'
import { observations as savingObservations } from '@src/lib/save/registry/contract'
import { observations as editorsObservations } from '@src/lib/editors/registry/contract'
import { useSignals } from '@preact/signals-react/runtime'
import { createElement } from 'react'
import { createEditorSave } from '@src/lib/save/save'
import { editorSaveService } from '@src/lib/save/registry/contract'
import {
  editorCapabilityFacet,
  codeEditorsExtensionFacet,
  editorTabIndicatorsFacet,
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
import { keymapEventOwnersFacet } from '@src/registry/contracts/keymap'

export const SAVE_EDITOR_COMMAND = {
  id: 'zds.editors.save',
  name: 'save-editor',
  groupId: 'editors',
} as const

/** Assemble saving, focused keyboard behavior, and its optional tab decoration. */
const extension = factory({
  key: 'save',
  dependencies: { saving: savingObservations, editors: editorsObservations },
  create: ({ saving: savingInputs, editors: editorsInputs }) => {
    const saving = createEditorSave(() => savingInputs.editorOnSaveFacet.value)
    const editorForEvent = (event: Event) =>
      editorViewForTarget(
        editorsInputs.editorsService.current.value?.views.peek() ?? [],
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
      start: () => {
        window.addEventListener('focusin', onFocus)
        window.addEventListener('keydown', onKeyDown)
        return () => {
          window.removeEventListener('focusin', onFocus)
          window.removeEventListener('keydown', onKeyDown)
        }
      },
      items: [
        provide(editorSaveService, saving.service),
        contribute(editorCapabilityFacet, () => ({
          id: 'editors.save',
          matches: '*' as const,
          setup: saving.setup,
        })),
        contribute(codeEditorsExtensionFacet, () => ({
          id: 'editors.save.focused',
          matches: '*' as const,
          extensions: saving.codeExtensions,
        })),
        contribute(editorTabIndicatorsFacet, () => ({
          id: 'editors.unsaved',
          component: UnsavedIndicator,
        })),
        contribute(keymapEventOwnersFacet, () => ({
          id: 'editors.save',
          scope: 'editors.save.focused',
          owns: (event) =>
            isSaveShortcut(event) && editorForEvent(event) !== undefined,
        })),
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
        saving.dispose()
      },
    }
  },
})

/** The semantic save extension can be installed with any persistence strategy. */
export const saveExtension = withProjectShellFeature(extension, 'save')

/** The app's default bundle installs file persistence as a separate contribution. */
export default [saveExtension, persistToFilesExtension, autosaveExtension]
