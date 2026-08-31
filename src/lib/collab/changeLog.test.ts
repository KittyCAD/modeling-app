import { ChangeSet, Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  type SerialisedChangeLog,
  applyHorizon,
  compactEntries,
  parseChangeLog,
  serialiseChangeLog,
} from '@src/lib/collab/changeLog'
import {
  type AppliedChange,
  inverseForContribution,
} from '@src/lib/collab/revert'

const PATH = 'main.kcl'
const TURN = 'turn-1'

/** Build a session, recording it the way the app would. */
function session(start: string) {
  let doc = Text.of(start.split('\n'))
  const entries: AppliedChange[] = []

  return {
    entries,
    head: () => doc.toString(),
    apply(
      specs: { from: number; to?: number; insert: string }[],
      contributionId: string | null
    ) {
      const changes = ChangeSet.of(specs, doc.length)
      entries.push({ changes, docBefore: doc, contributionId })
      doc = changes.apply(doc)
    },
  }
}

describe('changeLog', () => {
  /**
   * The claim the whole feature rests on: `docBefore` never needs storing,
   * because replaying a base plus every `ChangeSet` reconstructs it exactly — so
   * a reloaded log produces the *same* inverse as the live one.
   */
  it('produces the same revert after a round trip as before it', () => {
    const live = session('width = 10\ndepth = 2\nheight = 4\n')
    live.apply([{ from: 11, to: 20, insert: 'depth = 22' }], TURN)
    live.apply([{ from: 0, to: 0, insert: '// mine\n' }], null)
    live.apply([{ from: 0, to: 0, insert: '// more\n' }], null)

    const before = inverseForContribution({
      applied: live.entries,
      contributionId: TURN,
    })

    const restored = parseChangeLog(
      JSON.parse(
        JSON.stringify(
          serialiseChangeLog({
            path: PATH,
            entries: live.entries,
            head: live.head(),
          })
        )
      ) as SerialisedChangeLog,
      { path: PATH, head: live.head() }
    )

    expect(restored).not.toBeNull()
    if (restored === null) return

    const after = inverseForContribution({
      applied: restored,
      contributionId: TURN,
    })

    const head = Text.of(live.head().split('\n'))
    const applyInverse = (inverse: typeof before) =>
      inverse.changes === null
        ? head.toString()
        : inverse.changes.apply(head).toString()

    expect(applyInverse(after)).toBe(applyInverse(before))
    // Down to the stranded ranges, which is the part a weaker reconstruction
    // would get wrong quietly.
    expect(after.stranded).toEqual(before.stranded)
  })

  it('reverts a turn from a reloaded log, keeping later typing', () => {
    const live = session('width = 10\ndepth = 2\n')
    live.apply([{ from: 11, to: 20, insert: 'depth = 22' }], TURN)
    live.apply([{ from: 0, to: 0, insert: '// mine\n' }], null)

    const restored = parseChangeLog(
      serialiseChangeLog({
        path: PATH,
        entries: live.entries,
        head: live.head(),
      }),
      { path: PATH, head: live.head() }
    )
    expect(restored).not.toBeNull()
    if (restored === null) return

    const inverse = inverseForContribution({
      applied: restored,
      contributionId: TURN,
    })
    expect(inverse.changes).not.toBeNull()
    if (inverse.changes === null) return

    const head = Text.of(live.head().split('\n'))
    expect(inverse.changes.apply(head).toString()).toBe(
      '// mine\nwidth = 10\ndepth = 2\n'
    )
  })

  /**
   * The honest limit of the whole mechanism. If the file was edited outside the
   * app the rows no longer describe it, and no amount of stored history fixes
   * that — which is why the weaker revert still has to exist.
   */
  it('refuses a log whose file changed outside the app', () => {
    const live = session('width = 10\n')
    live.apply([{ from: 0, to: 5, insert: 'thickness' }], TURN)

    const log = serialiseChangeLog({
      path: PATH,
      entries: live.entries,
      head: live.head(),
    })

    expect(
      parseChangeLog(log, { path: PATH, head: 'edited in vim\n' })
    ).toBeNull()
  })

  it('refuses a log written by a different format', () => {
    const live = session('width = 10\n')
    live.apply([{ from: 0, to: 5, insert: 'thickness' }], TURN)
    const log = serialiseChangeLog({
      path: PATH,
      entries: live.entries,
      head: live.head(),
    })

    expect(
      parseChangeLog({ ...log, v: 99 }, { path: PATH, head: live.head() })
    ).toBeNull()
  })

  /** Filenames are hashed, and a hash can collide. */
  it('refuses a log that belongs to another file', () => {
    const live = session('width = 10\n')
    live.apply([{ from: 0, to: 5, insert: 'thickness' }], TURN)
    const log = serialiseChangeLog({
      path: PATH,
      entries: live.entries,
      head: live.head(),
    })

    expect(
      parseChangeLog(log, { path: 'other.kcl', head: live.head() })
    ).toBeNull()
  })

  it('refuses a log with a corrupt row', () => {
    const live = session('width = 10\n')
    live.apply([{ from: 0, to: 5, insert: 'thickness' }], TURN)
    const log = serialiseChangeLog({
      path: PATH,
      entries: live.entries,
      head: live.head(),
    })

    expect(
      parseChangeLog(
        { ...log, rows: [{ c: 'nonsense', k: TURN }] },
        { path: PATH, head: live.head() }
      )
    ).toBeNull()
  })

  it('round-trips an empty log', () => {
    const log = serialiseChangeLog({ path: PATH, entries: [], head: '' })

    expect(parseChangeLog(log, { path: PATH, head: '' })).toEqual([])
  })

  describe('compaction', () => {
    it('composes a run that shares a contribution', () => {
      const live = session('a\n')
      live.apply([{ from: 2, insert: 'b' }], null)
      live.apply([{ from: 3, insert: 'c' }], null)
      live.apply([{ from: 4, insert: 'd' }], null)

      const compacted = compactEntries(live.entries)

      expect(compacted).toHaveLength(1)
      expect(
        compacted[0].changes.apply(compacted[0].docBefore).toString()
      ).toBe('a\nbcd')
    })

    /**
     * Merging across a boundary would destroy the stranded-range detection, which
     * walks entries one at a time and has to tell a contribution's own later edits
     * from somebody else's.
     */
    it('never merges across a contribution boundary', () => {
      const live = session('a\n')
      live.apply([{ from: 2, insert: 'b' }], null)
      live.apply([{ from: 3, insert: 'c' }], TURN)
      live.apply([{ from: 4, insert: 'd' }], null)

      const compacted = compactEntries(live.entries)

      expect(compacted.map((entry) => entry.contributionId)).toEqual([
        null,
        TURN,
        null,
      ])
    })

    it('drops entries that changed nothing', () => {
      const live = session('a\n')
      live.apply([], null)
      live.apply([{ from: 2, insert: 'b' }], null)

      expect(compactEntries(live.entries)).toHaveLength(1)
    })

    /** The storage argument, as a ratio rather than a promise. */
    it('turns many keystrokes into one row sized by the text', () => {
      const live = session('width = 10\n')
      for (let key = 0; key < 200; key += 1) {
        live.apply([{ from: 11 + key, insert: 'x' }], null)
      }

      const uncompacted = serialiseChangeLog({
        path: PATH,
        entries: live.entries,
        head: live.head(),
      }).rows.length
      const compacted = compactEntries(live.entries).length

      expect(uncompacted).toBe(1)
      expect(compacted).toBe(1)
      // Serialising already compacts, so a 200-keystroke burst is one row.
      expect(
        JSON.stringify(
          serialiseChangeLog({
            path: PATH,
            entries: live.entries,
            head: live.head(),
          }).rows
        ).length
      ).toBeLessThan(400)
    })
  })

  describe('horizon', () => {
    it('keeps everything when there is less history than the window', () => {
      const live = session('a\n')
      live.apply([{ from: 2, insert: 'b' }], 'turn-1')
      live.apply([{ from: 3, insert: 'c' }], 'turn-2')

      const { entries } = applyHorizon(live.entries, 5)

      expect(entries).toHaveLength(2)
    })

    /**
     * Bounded by the window rather than by the session. What is lost is the
     * ability to revert a turn from further back than the horizon, which the log
     * expresses by simply not holding it.
     */
    it('folds older contributions into a new base', () => {
      const live = session('a\n')
      for (let turn = 1; turn <= 5; turn += 1) {
        live.apply([{ from: 1, insert: String(turn) }], `turn-${turn}`)
      }

      const { base, entries } = applyHorizon(live.entries, 2)

      expect(entries).toHaveLength(2)
      expect(entries.map((entry) => entry.contributionId)).toEqual([
        'turn-4',
        'turn-5',
      ])
      // The base is the document those two rows apply to, not the original.
      expect(base).not.toBe('a\n')
      expect(entries[0].docBefore.toString()).toBe(base)
    })

    it('still reaches the same head after folding', () => {
      const live = session('a\n')
      for (let turn = 1; turn <= 5; turn += 1) {
        live.apply([{ from: 1, insert: String(turn) }], `turn-${turn}`)
      }

      const restored = parseChangeLog(
        serialiseChangeLog({
          path: PATH,
          entries: live.entries,
          head: live.head(),
          horizon: 2,
        }),
        { path: PATH, head: live.head() }
      )

      expect(restored).not.toBeNull()
      expect(restored).toHaveLength(2)
    })

    it('can still revert a turn inside the window', () => {
      const live = session('a\n')
      for (let turn = 1; turn <= 5; turn += 1) {
        live.apply([{ from: 1, insert: String(turn) }], `turn-${turn}`)
      }

      const restored = parseChangeLog(
        serialiseChangeLog({
          path: PATH,
          entries: live.entries,
          head: live.head(),
          horizon: 2,
        }),
        { path: PATH, head: live.head() }
      )
      if (restored === null) return

      const inverse = inverseForContribution({
        applied: restored,
        contributionId: 'turn-5',
      })

      expect(inverse.changes).not.toBeNull()
    })

    it('cannot revert a turn older than the window', () => {
      const live = session('a\n')
      for (let turn = 1; turn <= 5; turn += 1) {
        live.apply([{ from: 1, insert: String(turn) }], `turn-${turn}`)
      }

      const restored = parseChangeLog(
        serialiseChangeLog({
          path: PATH,
          entries: live.entries,
          head: live.head(),
          horizon: 2,
        }),
        { path: PATH, head: live.head() }
      )
      if (restored === null) return

      const inverse = inverseForContribution({
        applied: restored,
        contributionId: 'turn-1',
      })

      // Nothing to undo, reported rather than guessed at.
      expect(inverse.changes).toBeNull()
    })
  })
})
