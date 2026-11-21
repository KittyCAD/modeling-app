import '@src/lib/projectSession/next/testFeature'
import {
  ensureSyntaxTree,
  highlightingFor,
  language,
} from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { Prec, StateEffect } from '@codemirror/state'
import { tags } from '@lezer/highlight'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { codeSurface, requireSuccess } from '@src/lib/editors/testViews'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import typescriptExtension from '@src/lib/typescript/registry'
import { Registry } from 'plankton'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

describe('TypeScript editor support', () => {
  let registry: Registry
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })
  beforeEach(async () => {
    registry = new Registry()
    await registry.configure([editorsExtension, typescriptExtension])
  })
  afterEach(async () => {
    await registry.dispose()
  })

  it.each([
    ['hello.zds.ts', 'typescript', 'const name: string = "Zoo"'],
    ['module.mts', 'typescript', 'export type Value = number'],
    ['module.cts', 'typescript', 'const value: number = 1'],
    ['panel.tsx', 'typescriptreact', 'const panel = <div>Hello</div>'],
    ['hello.zds.js', 'javascript', 'const name = "Zoo"'],
    ['module.mjs', 'javascript', 'export const value = 1'],
    ['module.cjs', 'javascript', 'exports.value = 1'],
    ['panel.jsx', 'javascriptreact', 'const panel = <div>Hello</div>'],
  ])(
    'classifies and parses %s in its Code surface',
    (filename, languageId, contents) => {
      const editors = registry.required(editorsService)
      const editor = requireSuccess(
        editors.openEditor(`/project/${filename}`, contents)
      )
      expect(editor.classification.value?.languageId).toBe(languageId)
      const view = codeSurface(editors, editor)
      expect(view.state.facet(language)).not.toBeNull()
      const tree = ensureSyntaxTree(view.state, contents.length, 100)
      expect(tree).not.toBeNull()
      const errors: number[] = []
      tree!.iterate({
        enter: (node) => {
          if (node.type.isError) errors.push(node.from)
        },
      })
      expect(errors).toEqual([])
    }
  )

  it('installs TypeScript parsing when an unnamed buffer explicitly selects it', () => {
    const editors = registry.required(editorsService)
    const editor = requireSuccess(
      editors.createEditor('interface Plugin { name: string }')
    )
    expect(editors.setLanguage(editor.id, 'typescript')).toBeUndefined()
    expect(codeSurface(editors, editor).state.facet(language)?.name).toBe(
      'typescript'
    )
    expect(editor.src.value).toBeUndefined()
  })

  it('changes parsers when a source is renamed and removes support from unrelated files', () => {
    const editors = registry.required(editorsService)
    const editor = requireSuccess(
      editors.openEditor('/project/plugin.ts', 'const value = 1')
    )
    const view = codeSurface(editors, editor)
    expect(view.state.facet(language)?.name).toBe('typescript')
    editors.setSource(editor.id, '/project/plugin.js')
    expect(view.state.facet(language)?.name).toBe('javascript')
    editors.setSource(editor.id, '/project/notes.txt')
    expect(editor.classification.value).toBeUndefined()
    expect(view.state.facet(language)).toBeNull()
  })

  it.each([false, true])(
    'styles TypeScript tokens in the Code surface with dark theme = %s',
    (dark) => {
      const editors = registry.required(editorsService)
      const editor = requireSuccess(
        editors.openEditor('/project/plugin.ts', 'const name: string = "Zoo"')
      )
      const view = codeSurface(editors, editor)
      const lightKeyword = highlightingFor(view.state, [tags.keyword])
      view.dispatch({
        effects: StateEffect.appendConfig.of(
          Prec.highest(EditorView.theme({}, { dark }))
        ),
      })
      expect(view.state.facet(EditorView.darkTheme)).toBe(dark)
      for (const tag of [
        tags.keyword,
        tags.typeName,
        tags.string,
        tags.number,
        tags.comment,
        tags.propertyName,
      ]) {
        expect(highlightingFor(view.state, [tag])).toBeTruthy()
      }
      if (dark)
        expect(highlightingFor(view.state, [tags.keyword])).not.toBe(
          lightKeyword
        )
    }
  )
})
