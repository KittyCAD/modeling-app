import '@src/lib/projectSession/next/testFeature'
import { redo, undo } from '@codemirror/commands'
import { highlightingFor, language } from '@codemirror/language'
import { Registry } from '@kittycad/registry'
import { tags } from '@lezer/highlight'
import editorsExtension from '@src/lib/editors/registry'
import markdownExtension from '@src/lib/markdown/registry'
import kclExtension from '@src/lib/kcl/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

describe('built-in editor capability contributions', () => {
  let registry: Registry
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })
  beforeEach(() => {
    registry = new Registry()
    registry.configure([editorsExtension, markdownExtension, kclExtension])
  })
  afterEach(() => {
    registry[Symbol.dispose]()
  })

  it('provides undo and redo history through the wildcard defaults', () => {
    const { view } = registry
      .get(editorsService)
      .openEditor('notes.txt', 'original')
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'edited' },
    })
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('original')
    expect(redo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('edited')
  })

  it('adds Markdown syntax highlighting', () => {
    const { view } = registry
      .get(editorsService)
      .openEditor('notes.md', '# Heading\n\n**bold** text')
    expect(view.state.facet(language)?.name).toBe('markdown')
    const headingClass = highlightingFor(view.state, [tags.heading1])!
    expect(view.contentDOM.querySelector('span')?.className).toContain(
      headingClass
    )
  })

  it('adds KCL syntax highlighting without an execution runtime', () => {
    // This registry has no LSP, WASM, engine or project services.
    const { view } = registry
      .get(editorsService)
      .openEditor('main.KCL', 'length = 42\n// comment')
    expect(view.state.facet(language)?.name).toBe('kcl')
    const numberClass = highlightingFor(view.state, [tags.number])!
    const number = Array.from(view.contentDOM.querySelectorAll('span')).find(
      (span) => span.textContent === '42'
    )
    expect(number?.className).toContain(numberClass)
  })

  it('keeps plain text free of file-specific language support', () => {
    const { view } = registry
      .get(editorsService)
      .openEditor('notes.txt', '# Heading\nlength = 42')
    expect(view.state.facet(language)).toBeNull()
    expect(view.dom.querySelector('.cm-lineNumbers')).not.toBeNull()
  })
})
