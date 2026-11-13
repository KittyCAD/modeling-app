import '@src/lib/projectSession/next/testFeature'
import { language } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import editorsExtension from '@src/lib/editors/registry'
import {
  codeEditorsExtensionFacet,
  editorLanguagesFacet,
  editorsService,
  editorViewsFacet,
} from '@src/lib/editors/registry/contract'
import {
  codeSurface,
  presentation,
  requireSuccess,
} from '@src/lib/editors/testViews'
import { defineEditorView } from '@src/lib/editors/views'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import kclExtension from '@src/lib/kcl/registry'
import markdownExtension from '@src/lib/markdown/registry'
import {
  extension as defineExtension,
  contribute,
  slot as createSlot,
  type InputOf,
  Registry,
} from 'plankton'
import { afterEach, beforeAll, expect, it } from 'vitest'
beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})
let registry: Registry
afterEach(() => registry?.dispose())
it('lets an unnamed buffer choose Markdown, retaining that choice until source inference is restored', async () => {
  registry = new Registry()
  await registry.configure([editorsExtension, markdownExtension, kclExtension])
  const editors = registry.required(editorsService)
  const editor = requireSuccess(editors.createEditor('# Draft'))
  expect(editor.classification.value).toBeUndefined()
  expect(editors.setLanguage(editor.id, 'markdown')).toBeUndefined()
  expect(editor.src.value).toBeUndefined()
  expect(
    codeSurface(registry.required(editorsService), editor).state.facet(language)
      ?.name
  ).toBe('markdown')
  expect(editor.classification.value).toEqual({
    languageId: 'markdown',
    mediaType: 'text/markdown',
  })
  codeSurface(editors, editor).dispatch({
    changes: {
      from: 0,
      insert: 'edited ',
    },
    selection: {
      anchor: 3,
    },
  })
  editors.setSource(editor.id, '/main.kcl')
  expect(
    codeSurface(registry.required(editorsService), editor).state.facet(language)
      ?.name
  ).toBe('markdown')
  expect(editors.setLanguage(editor.id, 'missing')).toBeInstanceOf(Error)
  expect(editor.classification.value?.languageId).toBe('markdown')
  editors.setLanguage(editor.id, undefined)
  expect(editor.classification.value).toEqual({
    languageId: 'kcl',
  })
  expect(
    codeSurface(registry.required(editorsService), editor).state.facet(language)
      ?.name
  ).toBe('kcl')
  expect(
    codeSurface(registry.required(editorsService), editor).state.selection.main
      .anchor
  ).toBe(3)
  expect(editor.undo()).toBe(true)
  expect(editor.contents.value).toBe('# Draft')
})
it('reclassifies from live source/content contributions and makes media metadata available to modes', async () => {
  const descriptors = createSlot([], Symbol())
  registry = new Registry()
  const _editorLanguagesContribution: InputOf<typeof editorLanguagesFacet> = {
    id: 'csv',
    mediaType: 'text/csv',
    matches: '*',
    priority: -100,
  } satisfies InputOf<typeof editorLanguagesFacet>
  const csv = [
    contribute(editorLanguagesFacet, () => _editorLanguagesContribution),
  ]
  const _editorLanguagesContribution2: InputOf<typeof editorLanguagesFacet> = {
    id: 'tagged',
    matches: ({ contents }) => contents.startsWith('tag:'),
    priority: 10,
  } satisfies InputOf<typeof editorLanguagesFacet>
  const tagged = [
    contribute(editorLanguagesFacet, () => _editorLanguagesContribution2),
  ]
  const _codeEditorsExtensionContribution: InputOf<
    typeof codeEditorsExtensionFacet
  > = {
    id: 'csv-tabs',
    matches: ({ mediaType }) => mediaType === 'text/csv',
    extensions: EditorState.tabSize.of(8),
  } satisfies InputOf<typeof codeEditorsExtensionFacet>
  const _editorViewsContribution: InputOf<typeof editorViewsFacet> =
    defineEditorView({
      id: 'table',
      label: 'Table',
      matches: ({ mediaType }) => mediaType === 'text/csv',
      Component: () => null,
    })
  await registry.configure([
    editorsExtension,
    defineExtension({
      ...descriptors,
      create: () => ({
        items: [csv, tagged],
      }),
    }),
    [
      contribute(
        codeEditorsExtensionFacet,
        () => _codeEditorsExtensionContribution
      ),
      contribute(editorViewsFacet, () => _editorViewsContribution),
    ],
  ])
  const editors = registry.required(editorsService)
  const editor = requireSuccess(editors.openEditor('/data', 'a,b'))
  expect(
    editors.viewState(presentation(registry.required(editorsService), editor))
      .value.selected?.id
  ).toBe('table')
  expect(
    codeSurface(registry.required(editorsService), editor).state.tabSize
  ).toBe(8)
  editor.dispatch({
    changes: {
      from: 0,
      insert: 'tag:',
    },
  })
  await Promise.resolve()
  expect(editor.classification.value).toEqual({
    languageId: 'tagged',
  })
  expect(
    codeSurface(registry.required(editorsService), editor).state.tabSize
  ).toBe(4)
  expect(
    editors.viewState(presentation(registry.required(editorsService), editor))
      .value.selected?.id
  ).toBe('editors.code')
  await registry.replace(descriptors, [])
  expect(editor.classification.value).toBeUndefined()
  expect(editor.contents.value).toBe('tag:a,b')
})
