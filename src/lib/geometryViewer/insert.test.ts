import { signal } from '@preact/signals-core'
import { createEditorDocument } from '@src/lib/editors/document'
import type { Editor } from '@src/lib/editors/registry/contract'
import { insertGeometryImport } from '@src/lib/geometryViewer/insert'
import { expect, it, vi } from 'vitest'
vi.mock('@src/lib/fs-zds', async () => ({
  default: (await import('node:path')).posix,
}))
function target(contents: string) {
  const backing = createEditorDocument(contents)
  const readOnly = signal(false)
  const editor: Editor = {
    ...backing.document,
    get state() {
      return backing.document.state
    },
    backing: { type: 'text' as const },
    id: Symbol(),
    src: signal('/model/assembly/main.kcl'),
    readOnly,
    classification: signal({ languageId: 'kcl' }),
  }
  return {
    editor,
    readOnly,
    dispose: backing.dispose,
  }
}
it('inserts a relative import with an unused alias and undoes only that edit', () => {
  const before =
    '@settings(kclVersion = 3.0)\nimportedModel = 1\nimportedModel2 = 2'
  const { editor } = target(before)
  expect(
    insertGeometryImport(editor, '/model/parts/body "A".step')
  ).toBeUndefined()
  expect(editor.contents.peek()).toBe(
    `${before}\nimport '../parts/body "A".step' as importedModel3\n`
  )
  expect(editor.undo()).toBe(true)
  expect(editor.contents.peek()).toBe(before)
})
it('keeps unsaved work while adding imports with separate names', () => {
  const { editor } = target('unsaved = 42\n')
  insertGeometryImport(editor, '/model/one.stl')
  insertGeometryImport(editor, '/model/two.stl')
  expect(editor.contents.peek()).toContain(
    'unsaved = 42\nimport "../one.stl" as importedModel\nimport "../two.stl" as importedModel2\n'
  )
})
it('rejects a read-only or closed destination without editing it', () => {
  const { editor, readOnly, dispose } = target('keep = 1')
  readOnly.value = true
  expect(insertGeometryImport(editor, '/model/body.glb')).toBeInstanceOf(Error)
  dispose()
  expect(insertGeometryImport(editor, '/model/body.glb')).toBeInstanceOf(Error)
  expect(editor.contents.peek()).toBe('keep = 1')
})
it.each(['/model/both\'"quotes.step', '/model/line\nbreak.step'])(
  'rejects an unrepresentable import path without changing KCL: %s',
  (path) => {
    const { editor } = target('keep = 1\n')
    expect(insertGeometryImport(editor, path)).toBeInstanceOf(Error)
    expect(editor.contents.peek()).toBe('keep = 1\n')
  }
)
