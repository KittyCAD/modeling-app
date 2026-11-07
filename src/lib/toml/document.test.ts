import { EditorState } from '@codemirror/state'
import { expect, it } from 'vitest'
import {
  editToml,
  readToml,
  type TomlPath,
  type EditableTomlValue,
} from '@src/lib/toml/document'

function edit(contents: string, path: TomlPath, value: EditableTomlValue) {
  const change = editToml(contents, path, value)
  if (change instanceof Error) throw change
  return EditorState.create({ doc: contents })
    .update({ changes: change })
    .state.doc.toString()
}

it('edits nested, quoted, and array values without rewriting comments or unrelated literals', () => {
  const source = `# keep the document intact
precise = 9_223_372_036_854_775_807
notes = """
[not.a.real.section]
theme = "fake"
"""
[settings."app.appearance"]
theme = "system" # keep this comment
[[plugins]]
options = { labels = ["first", "second"] }
`
  const updated = edit(source, ['settings', 'app.appearance', 'theme'], 'dark')
  expect(updated).toBe(source.replace('"system"', '"dark"'))
  const arrayEdit = edit(
    updated,
    ['plugins', 0, 'options', 'labels', 1],
    'new\nlabel'
  )
  expect(readToml(arrayEdit)).toMatchObject({
    precise: 9223372036854775807n,
    settings: { 'app.appearance': { theme: 'dark' } },
    plugins: [{ options: { labels: ['first', 'new\nlabel'] } }],
  })
  expect(arrayEdit).toContain('theme = "dark" # keep this comment')
})

it('refuses to rewrite a malformed document or recreate a setting removed in source', () => {
  expect(editToml('[broken', ['enabled'], true)).toBeInstanceOf(Error)
  expect(
    editToml('[settings]\nother = true', ['settings', 'removed'], false)
  ).toBeInstanceOf(Error)
})
