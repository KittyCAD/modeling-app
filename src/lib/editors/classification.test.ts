import '@src/lib/projectSession/next/testFeature'
import { EditorState } from '@codemirror/state'
import { language } from '@codemirror/language'
import { undo } from '@codemirror/commands'
import { Registry, Slot, defineRegistryItem, provide } from '@kittycad/registry'
import { afterEach, beforeAll, expect, it } from 'vitest'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorCapabilityValueSpec,
  editorLanguageValueSpec,
  editorViewValueSpec,
  editorsService,
} from '@src/lib/editors/registry/contract'
import { defineEditorView } from '@src/lib/editors/views'
import markdownExtension from '@src/lib/markdown/registry'
import kclExtension from '@src/lib/kcl/registry'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
let registry: Registry
afterEach(() => registry?.[Symbol.dispose]())

it('lets an unnamed buffer choose Markdown, retaining that choice until source inference is restored', () => {
  registry = new Registry()
  registry.configure([editorsExtension, markdownExtension, kclExtension])
  const editors = registry.get(editorsService)
  const editor = editors.createEditor('# Draft')
  expect(editor.classification.value).toBeUndefined()
  expect(editors.setLanguage(editor.id, 'markdown')).toBeUndefined()
  expect(editor.src.value).toBeUndefined()
  expect(editor.view.state.facet(language)?.name).toBe('markdown')
  expect(editor.classification.value).toEqual({
    languageId: 'markdown',
    mediaType: 'text/markdown',
  })
  editor.view.dispatch({
    changes: { from: 0, insert: 'edited ' },
    selection: { anchor: 3 },
  })
  editors.setSource(editor.id, '/main.kcl')
  expect(editor.view.state.facet(language)?.name).toBe('markdown')
  expect(editors.setLanguage(editor.id, 'missing')).toBeInstanceOf(Error)
  expect(editor.classification.value?.languageId).toBe('markdown')
  editors.setLanguage(editor.id, undefined)
  expect(editor.classification.value).toEqual({ languageId: 'kcl' })
  expect(editor.view.state.facet(language)?.name).toBe('kcl')
  expect(editor.view.state.selection.main.anchor).toBe(3)
  expect(undo(editor.view)).toBe(true)
  expect(editor.contents.value).toBe('# Draft')
})

it('reclassifies from live source/content contributions and makes media metadata available to modes', async () => {
  const descriptors = new Slot()
  registry = new Registry()
  const csv = defineRegistryItem({
    provides: [
      provide(editorLanguageValueSpec, {
        id: 'csv',
        mediaType: 'text/csv',
        matches: '*',
        priority: -100,
      }),
    ],
  })
  const tagged = defineRegistryItem({
    provides: [
      provide(editorLanguageValueSpec, {
        id: 'tagged',
        matches: ({ contents }) => contents.startsWith('tag:'),
        priority: 10,
      }),
    ],
  })
  registry.configure([
    editorsExtension,
    descriptors.of(csv, tagged),
    defineRegistryItem({
      provides: [
        provide(editorCapabilityValueSpec, {
          id: 'csv-tabs',
          matches: ({ mediaType }) => mediaType === 'text/csv',
          capabilities: EditorState.tabSize.of(8),
        }),
        provide(
          editorViewValueSpec,
          defineEditorView({
            id: 'table',
            label: 'Table',
            matches: ({ mediaType }) => mediaType === 'text/csv',
            Component: () => null,
          })
        ),
      ],
    }),
  ])
  const editors = registry.get(editorsService)
  const editor = editors.openEditor('/data', 'a,b')
  expect(editors.viewState(editor).value.selected?.id).toBe('table')
  expect(editor.view.state.tabSize).toBe(8)
  editor.view.dispatch({ changes: { from: 0, insert: 'tag:' } })
  await Promise.resolve()
  expect(editor.classification.value).toEqual({ languageId: 'tagged' })
  expect(editor.view.state.tabSize).toBe(4)
  expect(editors.viewState(editor).value.selected?.id).toBe('editors.code')
  registry.reconfigure(descriptors, [])
  expect(editor.classification.value).toBeUndefined()
  expect(editor.contents.value).toBe('tag:a,b')
})
