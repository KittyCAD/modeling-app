import '@src/lib/projectSession/next/testFeature'
import { highlightingFor, language } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { codeSurface, requireSuccess } from '@src/lib/editors/testViews'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import kclExtension from '@src/lib/kcl/registry'
import markdownExtension from '@src/lib/markdown/registry'
import { Registry } from 'plankton'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

describe('built-in editor capability contributions', () => {
  let registry: Registry
  beforeAll(async () => {
    await moduleFsViaModuleImport({
      type: StorageName.NodeFS,
      options: {},
    })
  })
  beforeEach(async () => {
    registry = new Registry()
    await registry.configure([
      editorsExtension,
      markdownExtension,
      kclExtension,
    ])
  })
  afterEach(async () => {
    await registry.dispose()
  })
  it('provides undo and redo history through the wildcard defaults', () => {
    const editor = requireSuccess(
      registry.required(editorsService).openEditor('notes.txt', 'original')
    )
    const view = codeSurface(registry.required(editorsService), editor)
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: 'edited',
      },
    })
    expect(editor.undo()).toBe(true)
    expect(view.state.doc.toString()).toBe('original')
    expect(editor.redo()).toBe(true)
    expect(view.state.doc.toString()).toBe('edited')
  })
  it('adds Markdown syntax highlighting', () => {
    const editor = requireSuccess(
      registry
        .required(editorsService)
        .openEditor('notes.md', '# Heading\n\n**bold** text')
    )
    const view = codeSurface(registry.required(editorsService), editor)
    expect(view.state.facet(language)?.name).toBe('markdown')
    const headingClass = highlightingFor(view.state, [tags.heading1])!
    expect(view.contentDOM.querySelector('span')?.className).toContain(
      headingClass
    )
  })
  it('adds KCL syntax highlighting without an execution runtime', () => {
    // This registry has no LSP, WASM, engine or project services.
    const editor = requireSuccess(
      registry
        .required(editorsService)
        .openEditor('main.KCL', 'length = 42\n// comment')
    )
    const view = codeSurface(registry.required(editorsService), editor)
    expect(view.state.facet(language)?.name).toBe('kcl')
    const numberClass = highlightingFor(view.state, [tags.number])!
    const number = Array.from(view.contentDOM.querySelectorAll('span')).find(
      (span) => span.textContent === '42'
    )
    expect(number?.className).toContain(numberClass)
  })
  it('keeps plain text free of file-specific language support', () => {
    const editor = requireSuccess(
      registry
        .required(editorsService)
        .openEditor('notes.txt', '# Heading\nlength = 42')
    )
    const view = codeSurface(registry.required(editorsService), editor)
    expect(view.state.facet(language)).toBeNull()
    expect(view.dom.querySelector('.cm-lineNumbers')).not.toBeNull()
  })
})
