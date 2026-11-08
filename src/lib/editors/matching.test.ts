import '@src/lib/projectSession/next/testFeature'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { undo } from '@codemirror/commands'
import { defineRegistryItem, provide, Registry } from '@kittycad/registry'
import { beforeAll, afterEach, expect, it } from 'vitest'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorsService,
  editorCapabilityValueSpec,
} from '@src/lib/editors/registry/contract'
import { matchesEditor } from '@src/lib/editors/matching'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
let registry: Registry | undefined
afterEach(() => registry?.[Symbol.dispose]())

it('keeps wildcard and case-insensitive extension shorthand alongside predicates', () => {
  const snapshot = { src: '/project/NOTES.MD', contents: '# Heading' }
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
    expect(matchesEditor('.kcl', { src, contents: '' })).toBe(expected)
  }
)

it('updates path and content capabilities without reentrant dispatch or resetting history', async () => {
  registry = new Registry()
  registry.configure([
    editorsExtension,
    defineRegistryItem({
      provides: [
        provide(editorCapabilityValueSpec, {
          id: 'settings',
          matches: ({ src }) => fsZds.basename(src) === 'settings.toml',
          capabilities: EditorState.tabSize.of(7),
        }),
        provide(editorCapabilityValueSpec, {
          id: 'wrapping',
          matches: ({ contents }) => contents.startsWith('wrap '),
          capabilities: EditorView.lineWrapping,
        }),
      ],
    }),
  ])
  const editors = registry.get(editorsService)
  const editor = editors.openEditor('/project/other.toml', 'original')
  expect(editor.view.state.tabSize).not.toBe(7)
  editors.setSource(editor.id, '/project/settings.toml')
  expect(editor.view.state.tabSize).toBe(7)
  editor.view.dispatch({
    changes: {
      from: 0,
      to: editor.view.state.doc.length,
      insert: 'wrap contents',
    },
  })
  expect(editor.contents.value).toBe('wrap contents')
  await Promise.resolve()
  expect(editor.view.contentDOM.classList.contains('cm-lineWrapping')).toBe(
    true
  )
  expect(undo(editor.view)).toBe(true)
  await Promise.resolve()
  expect(editor.contents.value).toBe('original')
  expect(editor.view.contentDOM.classList.contains('cm-lineWrapping')).toBe(
    false
  )
  editors.setSource(editor.id, '/project/other.toml')
  expect(editor.view.state.tabSize).not.toBe(7)
  editor.view.dispatch({ changes: { from: 0, insert: 'wrap ' } })
  editors.closeEditor(editor.id)
  await Promise.resolve()
  expect(editors.editors.value).toEqual([])
})
