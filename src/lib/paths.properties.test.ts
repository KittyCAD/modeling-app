import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  basename,
  dirname,
  extname,
  isPathInside,
  joinPath,
  normalizePath,
  relativePath,
  toDirectoryName,
  uniqueFileName,
  uniqueName,
} from '@src/lib/paths'
import {
  absolutePath,
  plainSegment,
  relativePathText,
} from '@src/test/properties'

/**
 * Path helpers, as the algebra the rest of the app assumes they are.
 *
 * These functions are load-bearing in a way that is easy to miss: a normalised
 * path is a map key and a signal identity, `isPathInside` decides which library
 * owns a project folder, and `toDirectoryName` decides what gets created on
 * disk. Nothing here is complicated, and that is exactly why it is worth
 * generating inputs for — the failures are all in the combinations, and
 * `paths.test.ts` can only hold the combinations somebody thought of.
 *
 * Every property below is a sentence the rest of the codebase already believes.
 */

describe('normalizePath properties', () => {
  /**
   * The property that makes a normalised path usable as an identity. Called at
   * the filesystem boundary and then again by `dirname`, `basename`,
   * `isPathInside` and `joinPath` — if a second pass could change the answer,
   * two callers would disagree about whether they hold the same path.
   */
  it('is idempotent', () => {
    fc.assert(
      fc.property(absolutePath, (path) => {
        const once = normalizePath(path)
        expect(normalizePath(once)).toBe(once)
      })
    )
  })

  it('leaves nothing behind for a later reader to interpret', () => {
    fc.assert(
      fc.property(absolutePath, (path) => {
        const normalized = normalizePath(path)

        expect(normalized).not.toContain('\\')
        expect(normalized).not.toContain('//')
        // No `.` or `..` left as a whole segment. An absolute path can always
        // resolve its own `..`; only a relative one is allowed to keep leading
        // ones, and these are all absolute.
        expect(normalized).not.toMatch(/(^|\/)\.\.?(\/|$)/)
        if (normalized.length > 1) expect(normalized.endsWith('/')).toBe(false)
      })
    )
  })

  /**
   * Absoluteness is the one thing a path cannot afford to lose in translation:
   * a relative path that normalises to an absolute one addresses a completely
   * different file, and the buffer layer treats an absolute path as identity.
   */
  it('never changes whether a path is absolute', () => {
    fc.assert(
      fc.property(absolutePath, relativePathText, (absolute, relative) => {
        expect(normalizePath(absolute).startsWith('/')).toBe(true)
        expect(normalizePath(relative).startsWith('/')).toBe(false)
      })
    )
  })
})

describe('path parts properties', () => {
  /**
   * `dirname` and `basename` are a decomposition, not two independent string
   * operations: putting the halves back has to give the path back. Anything that
   * walks a tree upwards and back down relies on it.
   */
  it('splits into a directory and a name that rejoin', () => {
    fc.assert(
      fc.property(absolutePath, (path) => {
        const normalized = normalizePath(path)
        if (normalized === '/') return

        expect(joinPath(dirname(normalized), basename(normalized))).toBe(
          normalized
        )
      })
    )
  })

  it('produces a name that is one segment, and an extension inside it', () => {
    fc.assert(
      fc.property(absolutePath, (path) => {
        const name = basename(path)
        expect(name).not.toContain('/')

        const extension = extname(path)
        if (extension === '') return
        expect(name.endsWith(extension)).toBe(true)
        expect(extension.startsWith('.')).toBe(true)
        // From the *last* dot, so `archive.tar.gz` is `.gz`. A second dot would
        // mean the extension is not what the app matches `.kcl` against.
        expect(extension.slice(1)).not.toContain('.')
      })
    )
  })
})

describe('containment properties', () => {
  it('holds a path built beneath a root', () => {
    fc.assert(
      fc.property(absolutePath, relativePathText, (root, relative) => {
        expect(isPathInside(root, joinPath(root, relative))).toBe(true)
      })
    )
  })

  /**
   * Containment and relativity are inverses. `relativePath` is how a project's
   * files are named inside its folder, so a round trip that loses a segment
   * names the wrong file.
   */
  it('recovers the relative path it was joined with', () => {
    fc.assert(
      fc.property(absolutePath, relativePathText, (root, relative) => {
        expect(relativePath(root, joinPath(root, relative))).toBe(
          normalizePath(relative)
        )
      })
    )
  })

  it('is reflexive and transitive', () => {
    fc.assert(
      fc.property(
        absolutePath,
        relativePathText,
        relativePathText,
        (root, middle, leaf) => {
          const inner = joinPath(root, middle)
          const deepest = joinPath(inner, leaf)

          expect(isPathInside(root, root)).toBe(true)
          expect(isPathInside(root, inner)).toBe(true)
          expect(isPathInside(inner, deepest)).toBe(true)
          expect(isPathInside(root, deepest)).toBe(true)
        }
      )
    )
  })

  /**
   * The sibling trap, which a `startsWith` written without the separator falls
   * straight into: `/projects/bracket-old` is not inside `/projects/bracket`.
   * Overlapping library roots make this a real configuration, not a contrived
   * one, and getting it wrong hands a project to the wrong library.
   */
  it('is not fooled by a root that is a string prefix of a sibling', () => {
    fc.assert(
      fc.property(
        absolutePath,
        plainSegment,
        plainSegment,
        (root, name, suffix) => {
          if (suffix.length === 0) return
          const sibling = joinPath(root, name + suffix)
          const target = joinPath(root, name)
          if (normalizePath(sibling) === normalizePath(target)) return

          expect(isPathInside(target, sibling)).toBe(false)
          expect(relativePath(target, sibling)).toBeNull()
        }
      )
    )
  })
})

describe('toDirectoryName properties', () => {
  /**
   * Three claims about every folder name this can produce, for any title
   * somebody types. It is the only translation from free text to something that
   * gets created on disk, and by the time a bad name reaches the filesystem the
   * error belongs to a different subsystem.
   */
  it('always produces a usable folder name', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 120 }), (title) => {
        const name = toDirectoryName(title)

        expect(name.length).toBeGreaterThan(0)
        expect(name.length).toBeLessThanOrEqual(64)
        expect(name).toMatch(/^[a-z0-9._-]+$/)
      })
    )
  })

  /**
   * The property that found a bug.
   *
   * A trailing `.` is not a folder name on Windows: Win32 strips trailing dots
   * and spaces, so the directory created is not the one that was asked for and
   * the project is recorded at a path that does not exist. The cleanup trimmed
   * the tail and *then* cut the title to 64 characters, which put a separator
   * back on the end for any title longer than that — invisible to every example
   * test, because nobody writes a 70-character title by hand.
   */
  it('never ends in a separator, however long the title', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (title) => {
        const name = toDirectoryName(title)

        expect(name.endsWith('.')).toBe(false)
        expect(name.endsWith('-')).toBe(false)
        // The same statement from the other side: a name is already a name, so
        // translating it again has nothing left to do. A rename that reuses the
        // folder name as the title would otherwise drift a character at a time.
        expect(toDirectoryName(name)).toBe(name)
      })
    )
  })
})

describe('unique name properties', () => {
  /**
   * Both of these exist to answer "what do I call this so it does not collide",
   * and both are called in a loop as a folder fills up. The properties are the
   * two things the caller assumes without checking: the answer is free, and the
   * answer is still a `.kcl` file.
   */
  it('never returns a name that is taken, and only renames when it must', () => {
    fc.assert(
      fc.property(
        plainSegment,
        fc.array(plainSegment, { maxLength: 10 }),
        (requested, taken) => {
          for (const unique of [uniqueName, uniqueFileName]) {
            const name = unique(requested, taken)
            expect(taken).not.toContain(name)
            expect(name === requested).toBe(!taken.includes(requested))
          }
        }
      )
    )
  })

  it('keeps the extension, because the app decides by extension', () => {
    fc.assert(
      fc.property(
        plainSegment,
        fc.array(plainSegment, { maxLength: 10 }),
        (stem, taken) => {
          const requested = `${stem}.kcl`
          const name = uniqueFileName(requested, [requested, ...taken])

          expect(extname(name)).toBe('.kcl')
          expect(name).not.toBe(requested)
        }
      )
    )
  })

  /**
   * Called in a loop, the results have to stay distinct — the caller adds each
   * one to the set before asking for the next, and duplicating an entry there
   * means two files fighting over one path.
   */
  it('fills a folder without ever repeating itself', () => {
    fc.assert(
      fc.property(
        plainSegment,
        fc.integer({ min: 1, max: 12 }),
        (stem, count) => {
          const requested = `${stem}.kcl`
          const taken = new Set<string>()

          for (let index = 0; index < count; index += 1) {
            taken.add(uniqueFileName(requested, taken))
          }

          expect(taken.size).toBe(count)
        }
      )
    )
  })
})
