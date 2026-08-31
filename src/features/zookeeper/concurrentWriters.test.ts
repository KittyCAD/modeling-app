import { history } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import {
  type EditorCapability,
  type FileBackedTextBuffer,
  combineCapabilities,
} from '@src/contracts/buffers'
import {
  type ApplyTarget,
  applyChanges,
} from '@src/features/zookeeper/applyChanges'
import { deriveChanges } from '@src/features/zookeeper/deriveEdit'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import { createChangeHistory } from '@src/lib/collab/changeHistory'
import { createDivergenceLedger } from '@src/lib/collab/divergence'
import { followLocalChanges } from '@src/lib/collab/followLocalChanges'
import { inverseForContribution } from '@src/lib/collab/revert'

/**
 * Two conversations editing one file at once, with nothing hand-fed.
 *
 * This is the case Frank's multi-conversation requirement rests on, and it is
 * where the per-writer bookkeeping either works or silently corrupts. The whole
 * point is that **nobody calls `recordLocal` by hand here**: each writer's ledger
 * is kept current by its own `followLocalChanges` subscription, which folds in
 * the user's typing *and the other writer's edits*, because from either writer's
 * point of view those are the same thing — something that happened to our
 * document that it does not know about.
 */

const PATH = 'main.kcl'
const A = 'zookeeper:conversation-a'
const B = 'zookeeper:conversation-b'

const BASE = 'width = 10\ndepth = 2\nheight = 4\n'

const historyCapability: EditorCapability = {
  id: 'history',
  extension: () => history(),
}

const textOf = (buffer: FileBackedTextBuffer) =>
  buffer.state.peek().doc.toString()

/** One writer's view of one file: its own ledger, its own subscription. */
function writerOn(
  author: string,
  buffer: FileBackedTextBuffer,
  seenContent: string
) {
  const ledger = createDivergenceLedger()
  ledger.begin(PATH, seenContent.length)
  const dispose = followLocalChanges({
    path: PATH,
    buffer,
    ledger,
    remoteAuthor: author,
  })
  // What this writer last saw, advancing as its own output lands.
  let view = seenContent

  return {
    ledger,
    dispose,
    /** Send a whole new version of the file, as the service would. */
    send(contents: string, contributionId: string, target: ApplyTarget) {
      const derived = deriveChanges({
        baseline: new Map([[PATH, view]]),
        outputs: { [PATH]: contents },
      })
      const outcome = applyChanges({
        changes: derived.changes,
        baseline: new Map([[PATH, view]]),
        target,
        ledger,
        author,
        contributionId,
      })
      if (outcome.applied.length > 0) view = contents
      return outcome
    },
  }
}

describe('two writers on one file', () => {
  it('rebases each writer over the other, and reverts one of them cleanly', () => {
    const buffer = createFileBackedTextBuffer({
      path: PATH,
      contents: BASE,
      languageId: 'kcl',
      capabilities: combineCapabilities([historyCapability]),
    })
    const target: ApplyTarget = {
      bufferForPath: (path) => (path === PATH ? buffer : undefined),
      executingBufferId: () => null,
    }

    const changeHistory = createChangeHistory()
    changeHistory.follow(PATH, buffer)

    // Both writers were handed the same file at the same moment.
    const writerA = writerOn(A, buffer, BASE)
    const writerB = writerOn(B, buffer, BASE)

    // A rewrites the middle line, making it one character longer.
    const first = writerA.send(
      'width = 10\ndepth = 22\nheight = 4\n',
      'a-turn-1',
      target
    )
    expect(first.applied).toEqual([PATH])
    expect(textOf(buffer)).toBe('width = 10\ndepth = 22\nheight = 4\n')

    // B, which never saw A's change, rewrites the last line. Its own
    // subscription has folded A's edit in, so this must rebase rather than
    // apply verbatim — and the offsets have genuinely moved by one.
    const second = writerB.send(
      'width = 10\ndepth = 2\nheight = 9\n',
      'b-turn-1',
      target
    )
    expect(second.applied).toEqual([PATH])
    expect(second.conflicts).toEqual([])
    expect(textOf(buffer)).toBe('width = 10\ndepth = 22\nheight = 9\n')

    // The user types, after both.
    buffer.dispatch({ changes: { from: 0, insert: '// mine\n' } })
    expect(textOf(buffer)).toBe('// mine\nwidth = 10\ndepth = 22\nheight = 9\n')

    // Every change is in one log, tagged with who made it.
    expect(
      changeHistory.entries(PATH).map((entry) => entry.contributionId)
    ).toEqual(['a-turn-1', 'b-turn-1', null])

    // Undo A's contribution only.
    const inverse = inverseForContribution({
      applied: changeHistory.entries(PATH),
      contributionId: 'a-turn-1',
    })
    expect(inverse.changes).not.toBeNull()
    if (inverse.changes === null) return
    buffer.dispatch({ changes: inverse.changes })

    // A's work is gone; B's and the user's are untouched.
    expect(textOf(buffer)).toBe('// mine\nwidth = 10\ndepth = 2\nheight = 9\n')

    writerA.dispose()
    writerB.dispose()
  })

  it('conflicts when the two writers’ diffs genuinely overlap', () => {
    const buffer = createFileBackedTextBuffer({
      path: PATH,
      contents: BASE,
      languageId: 'kcl',
      capabilities: combineCapabilities([historyCapability]),
    })
    const target: ApplyTarget = {
      bufferForPath: (path) => (path === PATH ? buffer : undefined),
      executingBufferId: () => null,
    }

    const writerA = writerOn(A, buffer, BASE)
    const writerB = writerOn(B, buffer, BASE)

    // Both rename the same identifier, so both diffs are the same span.
    writerA.send('width = 10\nthickness = 2\nheight = 4\n', 'a-turn-1', target)
    const second = writerB.send(
      'width = 10\nradius = 2\nheight = 4\n',
      'b-turn-1',
      target
    )

    expect(second.applied).toEqual([])
    expect(second.conflicts).toHaveLength(1)
    expect(second.conflicts[0]?.reason).toBe('erased')
    // A's version stands, untouched, and nothing was merged.
    expect(textOf(buffer)).toBe('width = 10\nthickness = 2\nheight = 4\n')

    writerA.dispose()
    writerB.dispose()
  })

  /**
   * **The limit of interval-level conflict detection, and the reason the design
   * calls for a per-buffer write claim.**
   *
   * Both writers rewrite the same *line* — `depth = 2` to `depth = 22` and to
   * `depth = 33` — and it does not conflict, because their minimal diffs do not
   * overlap: A's is an insertion of `'2'` at one offset, B's is a replacement of
   * the single character before it. The ranges really are disjoint, so the rebase
   * is mechanically correct and the result is `depth = 332`, which is nonsense.
   *
   * No amount of care in `rebaseEdits` fixes this. Half-open interval arithmetic
   * cannot know that two disjoint character edits are arguing about one
   * statement, and widening the conflict rule to catch it would report a conflict
   * for every edit that lands near another — including the append-at-end case
   * that has to stay silent.
   *
   * So the claim is not about sparing the user a question. It is the mechanism
   * that stops this, by keeping the second writer's turn off a buffer the first
   * is still writing to. Until it exists, two conversations editing one file are
   * unsafe in a way one conversation is not — worth saying out loud rather than
   * leaving for someone to find.
   */
  it('merges disjoint diffs on one line into nonsense, unclaimed', () => {
    const buffer = createFileBackedTextBuffer({
      path: PATH,
      contents: BASE,
      languageId: 'kcl',
      capabilities: combineCapabilities([historyCapability]),
    })
    const target: ApplyTarget = {
      bufferForPath: (path) => (path === PATH ? buffer : undefined),
      executingBufferId: () => null,
    }

    const writerA = writerOn(A, buffer, BASE)
    const writerB = writerOn(B, buffer, BASE)

    writerA.send('width = 10\ndepth = 22\nheight = 4\n', 'a-turn-1', target)
    const second = writerB.send(
      'width = 10\ndepth = 33\nheight = 4\n',
      'b-turn-1',
      target
    )

    // Applied, with no conflict reported, and the result is not what either
    // writer asked for.
    expect(second.applied).toEqual([PATH])
    expect(second.conflicts).toEqual([])
    expect(textOf(buffer)).toBe('width = 10\ndepth = 332\nheight = 4\n')

    writerA.dispose()
    writerB.dispose()
  })

  /**
   * A writer sending twice in one turn, which is what streaming looks like. Its
   * own first output must not be folded into its own divergence, or the second
   * output lands on top of a document it has already accounted for.
   */
  it('does not double-apply a writer’s own streamed output', () => {
    const buffer = createFileBackedTextBuffer({
      path: PATH,
      contents: BASE,
      languageId: 'kcl',
      capabilities: combineCapabilities([historyCapability]),
    })
    const target: ApplyTarget = {
      bufferForPath: (path) => (path === PATH ? buffer : undefined),
      executingBufferId: () => null,
    }

    const writerA = writerOn(A, buffer, BASE)

    writerA.send(`${BASE}extrude(sketch001, length = 5)\n`, 'a-turn-1', target)
    // The user types between the two outputs.
    buffer.dispatch({ changes: { from: 0, insert: '// mine\n' } })
    writerA.send(
      `${BASE}extrude(sketch001, length = 5)\nfillet(radius = 1)\n`,
      'a-turn-1',
      target
    )

    const text = textOf(buffer)
    expect(text).toBe(
      '// mine\nwidth = 10\ndepth = 2\nheight = 4\nextrude(sketch001, length = 5)\nfillet(radius = 1)\n'
    )
    // Each line appears exactly once.
    expect(text.match(/extrude/g)).toHaveLength(1)
    expect(text.match(/fillet/g)).toHaveLength(1)

    writerA.dispose()
  })
})
