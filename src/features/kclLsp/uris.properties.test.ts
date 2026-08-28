import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { pathToUri, uriToPath } from '@src/features/kclLsp/uris'
import { absolutePath, relativePathText } from '@src/test/properties'

/**
 * Paths and URIs, checked as the bijection the language server needs.
 *
 * `uris.ts` states the requirement itself: "the conversion has to be exactly
 * reversible or a response comes back for a file nobody can find". That is a
 * property, not an example — the failure is one character class nobody listed,
 * and what the user sees is diagnostics that never arrive for the one file whose
 * name has a `%` in it.
 *
 * `uris.test.ts` lists seven paths by hand. This generates them.
 */

describe('uris properties', () => {
  /** The stated requirement, for any path a filesystem could hand over. */
  it('round-trips every absolute path exactly', () => {
    fc.assert(
      fc.property(absolutePath, (path) => {
        expect(uriToPath(pathToUri(path))).toBe(path)
      })
    )
  })

  /**
   * Distinct files must get distinct URIs. A collision is worse than a failure:
   * the server answers, and the answer is attached to the wrong document.
   */
  it('never gives two different paths the same URI', () => {
    fc.assert(
      fc.property(absolutePath, absolutePath, (left, right) => {
        if (left === right) return
        expect(pathToUri(left)).not.toBe(pathToUri(right))
      })
    )
  })

  /**
   * The output has to survive being parsed as a URI by somebody else — the
   * `@codemirror/lsp-client` on one side, the KCL server on the other. Any of
   * these characters left raw would be read as authority, query or fragment, and
   * the path would silently end early.
   */
  it('produces a URI with nothing left for a parser to misread', () => {
    fc.assert(
      fc.property(absolutePath, (path) => {
        const uri = pathToUri(path)

        expect(uri.startsWith('file:///')).toBe(true)
        for (const character of [' ', '#', '?', '\\', '"', '<', '>']) {
          expect(uri.slice('file://'.length)).not.toContain(character)
        }
      })
    )
  })

  /**
   * A relative path has nowhere to start, so it gets rooted — which means the
   * round trip is only an identity on absolute paths. Stated so the asymmetry is
   * deliberate rather than discovered.
   */
  it('roots a relative path, and round-trips it from there', () => {
    fc.assert(
      fc.property(relativePathText, (relative) => {
        expect(uriToPath(pathToUri(relative))).toBe(`/${relative}`)
      })
    )
  })

  it('refuses anything that is not a file URI', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('https', 'untitled', 'vscode-vfs', 'FILE', 'file:'),
        absolutePath,
        (scheme, path) => {
          expect(uriToPath(`${scheme}://${path}`)).toBeNull()
        }
      )
    )
  })
})
