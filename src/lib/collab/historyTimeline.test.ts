import { describe, expect, it } from 'vitest'
import type { ProjectAction } from '@src/contracts/projectHistory'
import {
  authorLabel,
  authorOf,
  authorsOf,
  formatHistoryExport,
  timelineFrom,
} from '@src/lib/collab/historyTimeline'

const action = (overrides: Partial<ProjectAction> = {}): ProjectAction => ({
  id: 'action-1',
  label: 'Extruded profile001',
  at: Date.parse('2026-08-31T10:00:00.000Z'),
  author: null,
  paths: ['main.kcl'],
  ...overrides,
})

describe('who made a change', () => {
  it('reads a missing author as the person at the keyboard', () => {
    expect(authorOf(null)).toEqual({ kind: 'you' })
  })

  it('reads the agent’s id as one conversation', () => {
    expect(authorOf('zookeeper:8f2a-3b')).toEqual({
      kind: 'agent',
      conversationId: '8f2a-3b',
    })
  })

  it('keeps an id it has no name for rather than guessing', () => {
    expect(authorOf('someone-else')).toEqual({
      kind: 'other',
      id: 'someone-else',
    })
  })

  /*
   * A conversation id is a UUID and nobody can tell two apart at a glance, so the
   * chip is shortened. The export carries the whole thing.
   */
  it('shortens a conversation for a chip', () => {
    expect(authorLabel(authorOf('zookeeper:8f2a-3b91-4c'))).toBe(
      'zookeeper 8f2a'
    )
    expect(authorLabel(authorOf(null))).toBe('you')
  })
})

describe('the timeline', () => {
  /*
   * The thing you want to undo is nearly always the thing that just happened, and
   * a list that grows downwards puts it further away every time.
   */
  it('puts the newest first', () => {
    const entries = timelineFrom([
      action({ id: 'first', at: 1 }),
      action({ id: 'second', at: 2 }),
    ])

    expect(entries.map((entry) => entry.action.id)).toEqual(['second', 'first'])
  })

  /*
   * What makes concurrent work legible: two Zookeepers editing at once are two
   * colours down the spine rather than an undifferentiated list.
   */
  it('gives each author a lane of their own', () => {
    const entries = timelineFrom([
      action({ id: 'a', author: null }),
      action({ id: 'b', author: 'zookeeper:one' }),
      action({ id: 'c', author: 'zookeeper:two' }),
    ])

    const lanes = new Map(entries.map((entry) => [entry.action.id, entry.lane]))
    expect(new Set(lanes.values()).size).toBe(3)
    // The local user is first, so "me" is not one colour among several.
    expect(lanes.get('a')).toBe(0)
  })

  it('gives one author the same lane every time', () => {
    const entries = timelineFrom([
      action({ id: 'a', author: 'zookeeper:one' }),
      action({ id: 'b', author: 'zookeeper:two' }),
      action({ id: 'c', author: 'zookeeper:one' }),
    ])

    const lane = (id: string) =>
      entries.find((entry) => entry.action.id === id)?.lane

    expect(lane('a')).toBe(lane('c'))
    expect(lane('b')).not.toBe(lane('a'))
  })

  /*
   * Assigned by first appearance in chronological order, so a lane never moves
   * under an author as later entries arrive.
   */
  it('does not renumber a lane when a new author arrives', () => {
    const before = timelineFrom([action({ id: 'a', author: 'zookeeper:one' })])
    const after = timelineFrom([
      action({ id: 'a', author: 'zookeeper:one' }),
      action({ id: 'b', author: 'zookeeper:two' }),
    ])

    expect(after.find((entry) => entry.action.id === 'a')?.lane).toBe(
      before[0]?.lane
    )
  })

  it('lists everyone who has changed the project, once each', () => {
    const authors = authorsOf([
      action({ author: null }),
      action({ author: 'zookeeper:one' }),
      action({ author: null }),
    ])

    expect(authors).toEqual([
      { kind: 'you' },
      { kind: 'agent', conversationId: 'one' },
    ])
  })
})

describe('the export', () => {
  const exported = () =>
    formatHistoryExport(
      [
        action({
          id: '7c1f0c2e',
          label: 'Extruded profile001',
          at: Date.parse('2026-08-31T10:00:00.000Z'),
        }),
        action({
          id: '9ab3f1',
          label: 'Zookeeper: add ribs',
          author: 'zookeeper:8f2a',
          at: Date.parse('2026-08-31T10:05:00.000Z'),
          paths: ['main.kcl', 'ribs.kcl'],
        }),
      ],
      { now: Date.parse('2026-08-31T10:06:00.000Z') }
    )

  /*
   * Forwards, because an exported history is a record of what happened rather
   * than a list of what to undo.
   */
  it('reads oldest first', () => {
    const rows = exported()
      .split('\n')
      .filter((line) => !line.startsWith('#'))

    expect(rows[0]).toContain('Extruded profile001')
    expect(rows[1]).toContain('Zookeeper: add ribs')
  })

  /*
   * Exact rather than pretty. The contribution id is what identifies the change
   * in the change log and in every transaction it dispatched, so a shortened one
   * would make the export look tidy and stop it being evidence.
   */
  it('carries the full ids and the full author', () => {
    const text = exported()

    expect(text).toContain('7c1f0c2e')
    expect(text).toContain('9ab3f1')
    expect(text).toContain('zookeeper:8f2a')
  })

  it('carries every file each action touched', () => {
    expect(exported()).toContain('main.kcl,ribs.kcl')
  })

  it('says when it was taken and what it holds', () => {
    const text = exported()

    expect(text).toContain('# Exported\t2026-08-31T10:06:00.000Z')
    expect(text).toContain('# Actions\t2')
    expect(text).toContain('zookeeper:8f2a')
  })

  /* Tab-separated, so it parses in one line of anything. */
  it('puts five fields on every row', () => {
    for (const row of exported()
      .split('\n')
      .filter((line) => !line.startsWith('#'))) {
      expect(row.split('\t')).toHaveLength(5)
    }
  })

  it('exports an empty history without pretending it has one', () => {
    const text = formatHistoryExport([], { now: 0 })

    expect(text).toContain('# Actions\t0')
    expect(text.split('\n').every((line) => line.startsWith('#'))).toBe(true)
  })
})
