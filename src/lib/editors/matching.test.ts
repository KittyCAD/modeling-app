import '@src/lib/projectSession/next/testFeature'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { matchesEditor } from '@src/lib/editors/matching'
import editorsExtension from '@src/lib/editors/registry'
import {
  codeEditorsExtensionFacet,
  editorsService,
} from '@src/lib/editors/registry/contract'
import { codeSurface, requireSuccess } from '@src/lib/editors/testViews'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { contribute, type InputOf, Registry } from 'plankton'
import { afterEach, beforeAll, expect, it } from 'vitest'
beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})
let registry: Registry | undefined
afterEach(() => registry?.dispose())
it('keeps wildcard and case-insensitive extension shorthand alongside predicates', () => {
  const snapshot = {
    src: '/project/NOTES.MD',
    contents: '# Heading',
  }
  expect(matchesEditor('*', snapshot)).toBe(true)
  expect(matchesEditor('.md', snapshot)).toBe(true)
  expect(matchesEditor('.MD', snapshot)).toBe(true)
  expect(matchesEditor('.toml', snapshot)).toBe(false)
  expect(
    matchesEditor(
      ({ src, contents }) =>
        fsZds.basename(src) === 'NOTES.MD' && contents.startsWith('#'),
      snapshot
    )
  ).toBe(true)
})
it.each([
  ['/projects/bracket/main.kcl', true],
  ['cloud:project-id/parts/main.KCL', true],
  ['C:\\projects\\bracket\\main.kcl', true],
  ['/projects/main.kcl/README', false],
  ['/projects/bracket/.kcl', false],
  ['/projects/bracket/notes.md', false],
])(
  'matches extensions without mistaking directory names for file types: %s',
  (src, expected) => {
    expect(
      matchesEditor('.kcl', {
        src,
        contents: '',
      })
    ).toBe(expected)
  }
)
it('updates path and content capabilities without reentrant dispatch or resetting history', async () => {
  registry = new Registry()
  const _codeEditorsExtensionContribution: InputOf<
    typeof codeEditorsExtensionFacet
  > = {
    id: 'settings',
    matches: ({ src }) => fsZds.basename(src) === 'settings.toml',
    extensions: EditorState.tabSize.of(7),
  } satisfies InputOf<typeof codeEditorsExtensionFacet>
  const _codeEditorsExtensionContribution2: InputOf<
    typeof codeEditorsExtensionFacet
  > = {
    id: 'wrapping',
    matches: ({ contents }) => contents.startsWith('wrap '),
    extensions: EditorView.lineWrapping,
  } satisfies InputOf<typeof codeEditorsExtensionFacet>
  await registry.configure([
    editorsExtension,
    [
      contribute(
        codeEditorsExtensionFacet,
        () => _codeEditorsExtensionContribution
      ),
      contribute(
        codeEditorsExtensionFacet,
        () => _codeEditorsExtensionContribution2
      ),
    ],
  ])
  const editors = registry.required(editorsService)
  const editor = requireSuccess(
    editors.openEditor('/project/other.toml', 'original')
  )
  expect(
    codeSurface(registry.required(editorsService), editor).state.tabSize
  ).not.toBe(7)
  editors.setSource(editor.id, '/project/settings.toml')
  expect(
    codeSurface(registry.required(editorsService), editor).state.tabSize
  ).toBe(7)
  editor.dispatch({
    changes: {
      from: 0,
      to: codeSurface(registry.required(editorsService), editor).state.doc
        .length,
      insert: 'wrap contents',
    },
  })
  expect(editor.contents.value).toBe('wrap contents')
  await Promise.resolve()
  expect(
    codeSurface(
      registry.required(editorsService),
      editor
    ).contentDOM.classList.contains('cm-lineWrapping')
  ).toBe(true)
  expect(editor.undo()).toBe(true)
  await Promise.resolve()
  expect(editor.contents.value).toBe('original')
  expect(
    codeSurface(
      registry.required(editorsService),
      editor
    ).contentDOM.classList.contains('cm-lineWrapping')
  ).toBe(false)
  editors.setSource(editor.id, '/project/other.toml')
  expect(
    codeSurface(registry.required(editorsService), editor).state.tabSize
  ).not.toBe(7)
  editor.dispatch({
    changes: {
      from: 0,
      insert: 'wrap ',
    },
  })
  editors.closeEditor(editor.id)
  await Promise.resolve()
  expect(editors.editors.value).toEqual([])
})
