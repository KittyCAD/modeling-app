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
  editorNamingService,
  editorTabIndicatorsFacet,
  type Editor,
} from '@src/lib/editors/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import autosaveExtension from '@src/lib/save/autosave/registry'
import persistToFilesExtension from '@src/lib/save/persistToFiles/registry'
import {
  GLOBAL_COMMAND_SCOPES,
  EDITOR_FOCUSED_COMMAND_SCOPE,
  provideCommand,
} from '@src/registry/contracts/commands'
import { provideKeymapItem } from '@src/registry/contracts/keymap'

import { createEditorNaming } from '@src/lib/save/naming'
import { observations as projectObservations } from '@src/lib/projectSession/next/contract'
import { observations as fileObservations } from '@src/registry/contracts/fileOperations'

export const SAVE_EDITOR_COMMAND = {
  id: 'zds.editors.save',
  name: 'save-editor',
  groupId: 'editors',
} as const

export const RENAME_EDITOR_COMMAND = {
  id: 'zds.editors.rename',
  name: 'rename-editor',
  groupId: 'editors',
} as const

/** Assemble saving, focused keyboard behavior, and its optional tab decoration. */
const extension = factory({
  key: 'save',
  dependencies: {
    saving: savingObservations,
    editors: editorsObservations,
    project: projectObservations,
    files: fileObservations,
  },
  create: ({
    saving: savingInputs,
    editors: editorsInputs,
    project,
    files,
  }) => {
    const saving = createEditorSave(
      () => savingInputs.editorOnSaveFacet.value,
      (editor) => naming.request(editor)
    )
    const naming = createEditorNaming(
      () => project.projectSessionService.current.value,
      () => editorsInputs.editorsService.current.value,
      () => files.fileOperationsService.current.value,
      saving.service,
      saving.withSourceLock,
      saving.focus,
      { defaultExtension: '.kcl' }
    )
    const editorForEvent = (event: Event) =>
      editorViewForTarget(
        editorsInputs.editorsService.current.value?.views.peek() ?? [],
        event.composedPath()[0] ?? event.target
      )?.editor
    const onFocus = (event: FocusEvent) => {
      const editor = editorForEvent(event)
      if (editor) saving.focus(editor)
    }
    const currentEditor = () =>
      editorViewForTarget(
        editorsInputs.editorsService.current.value?.views.peek() ?? [],
        document.activeElement
      )?.editor ?? saving.service.lastFocusedEditor.peek()
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
        return () => {
          window.removeEventListener('focusin', onFocus)
        }
      },
      items: [
        provide(editorSaveService, saving.service),
        provide(editorNamingService, naming.service),
        contribute(editorCapabilityFacet, () => ({
          id: 'editors.save',
          matches: '*' as const,
          setup: saving.setup,
        })),
        contribute(editorTabIndicatorsFacet, () => ({
          id: 'editors.unsaved',
          component: UnsavedIndicator,
        })),
        provideKeymapItem({
          id: SAVE_EDITOR_COMMAND.id,
          title: 'Save editor',
          source: 'Save',
          command: SAVE_EDITOR_COMMAND.id,
          keystrokes: ['mod+s'],
          when: [EDITOR_FOCUSED_COMMAND_SCOPE],
        }),
        provideKeymapItem({
          id: RENAME_EDITOR_COMMAND.id,
          title: 'Rename editor',
          source: 'Save',
          command: RENAME_EDITOR_COMMAND.id,
          keystrokes: ['f2'],
        }),
        provideCommand({
          ...RENAME_EDITOR_COMMAND,
          displayName: 'Rename editor',
          description: 'Rename the last focused editor.',
          scopes: GLOBAL_COMMAND_SCOPES,
          needsReview: false,
          onSubmit: () => {
            const editor = currentEditor()
            if (!editor) return new Error('Focus an editor to rename it')
            return naming.service.rename(editor)
          },
        }),
        provideCommand({
          ...SAVE_EDITOR_COMMAND,
          displayName: 'Save editor',
          description: 'Save the last focused editor.',
          scopes: GLOBAL_COMMAND_SCOPES,
          needsReview: false,
          onSubmit: async () => {
            const editor = currentEditor()
            if (!editor) return new Error('Focus an editor to save it')
            const result = await saving.service.save(editor)
            return result
          },
        }),
      ],
      dispose: () => {
        naming.dispose()
        saving.dispose()
      },
    }
  },
})

/** The semantic save extension can be installed with any persistence strategy. */
export const saveExtension = withProjectShellFeature(extension, 'save')

/** The app's default bundle installs file persistence as a separate contribution. */
export default [saveExtension, persistToFilesExtension, autosaveExtension]
