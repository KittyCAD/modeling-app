import type { ProjectAction } from '@src/contracts/projectHistory'

/**
 * The project's history, as something to read.
 *
 * `ProjectAction` is a record for *undoing* — an id, a label, the paths it
 * touched — and reading it is a different job with two questions the record does
 * not answer directly: who did this, and which of these happened alongside each
 * other. Both are derived here rather than stored, because both are opinions
 * about the log rather than facts in it.
 *
 * Pure, and separate from the panel, so the export and the timeline cannot
 * disagree about what the history says. The export is the point of that: a
 * history nobody can carry out of the app is a history you have to be looking at
 * the app to believe.
 */

/** Who made a change. Derived from the opaque author id the writer recorded. */
export type HistoryAuthor =
  /** The person at the keyboard. `author: null` on the record. */
  | { kind: 'you' }
  /** One Zookeeper conversation. Several can be running at once. */
  | { kind: 'agent'; conversationId: string }
  /** Someone whose id this app does not have a name for. */
  | { kind: 'other'; id: string }

export interface TimelineEntry {
  action: ProjectAction
  author: HistoryAuthor
  /**
   * A small number per author, stable as the log grows.
   *
   * What makes concurrent work legible: two Zookeepers editing at once are two
   * colours down the spine rather than an undifferentiated list. Assigned by
   * first appearance in *chronological* order, so an author's lane never changes
   * as later entries arrive.
   */
  lane: number
}

/** How the agent writes its author id. See `createZookeeperService`. */
const AGENT_PREFIX = 'zookeeper:'

export function authorOf(id: string | null): HistoryAuthor {
  if (id === null) return { kind: 'you' }
  if (id.startsWith(AGENT_PREFIX)) {
    return { kind: 'agent', conversationId: id.slice(AGENT_PREFIX.length) }
  }
  return { kind: 'other', id }
}

/** A stable key for an author, for lanes and for grouping. */
export const authorKey = (author: HistoryAuthor): string => {
  switch (author.kind) {
    case 'you':
      return 'you'
    case 'agent':
      return `${AGENT_PREFIX}${author.conversationId}`
    case 'other':
      return author.id
  }
}

/**
 * What to call an author in a chip.
 *
 * A conversation id is a UUID and nobody can tell two of them apart at a glance,
 * so it is shortened — enough to distinguish the ones on screen, not enough to
 * mistake for the whole id. The export carries the full one.
 */
export function authorLabel(author: HistoryAuthor): string {
  switch (author.kind) {
    case 'you':
      return 'you'
    case 'agent':
      return `zookeeper ${author.conversationId.slice(0, 4)}`
    case 'other':
      return author.id
  }
}

/**
 * The log as a timeline, newest first.
 *
 * Newest first because that is where the answer usually is: the thing you want
 * to undo is nearly always the thing that just happened, and a list that grows
 * downwards puts it further away every time somebody does something.
 */
export function timelineFrom(
  entries: readonly ProjectAction[]
): readonly TimelineEntry[] {
  const lanes = new Map<string, number>()

  // Oldest first, so a lane is assigned by first appearance and never moves.
  for (const action of entries) {
    const key = authorKey(authorOf(action.author))
    if (!lanes.has(key)) lanes.set(key, lanes.size)
  }

  return [...entries].reverse().map((action) => {
    const author = authorOf(action.author)
    return { action, author, lane: lanes.get(authorKey(author)) ?? 0 }
  })
}

/** Everyone who has changed the project, in the order they first did. */
export function authorsOf(
  entries: readonly ProjectAction[]
): readonly HistoryAuthor[] {
  const seen = new Map<string, HistoryAuthor>()

  for (const action of entries) {
    const author = authorOf(action.author)
    const key = authorKey(author)
    if (!seen.has(key)) seen.set(key, author)
  }

  return [...seen.values()]
}

/**
 * The history as text somebody can keep.
 *
 * Tab-separated with a comment header: readable in a terminal, pasteable into a
 * spreadsheet, and parseable in one line of anything. Oldest first, because an
 * exported history is read forwards — it is a record of what happened, not a
 * list of what to undo.
 *
 * Exact rather than pretty. The full contribution id is on every row, because
 * that id is what identifies the change in the change log and in every
 * transaction it dispatched; a shortened one would make the export look tidy and
 * stop it being evidence. Same for the author id and the timestamps.
 */
export function formatHistoryExport(
  entries: readonly ProjectAction[],
  options: { now?: number; project?: string } = {}
): string {
  const now = options.now ?? Date.now()
  const authors = authorsOf(entries)

  const header = [
    '# Project history',
    ...(options.project ? [`# Project\t${options.project}`] : []),
    `# Exported\t${new Date(now).toISOString()}`,
    `# Actions\t${entries.length}`,
    `# Authors\t${authors.map(authorKey).join('\t') || '—'}`,
    '#',
    '# when\twho\twhat\tfiles\tid',
  ]

  const rows = entries.map((action) =>
    [
      new Date(action.at).toISOString(),
      action.author ?? 'you',
      action.label,
      action.paths.join(','),
      action.id,
    ].join('\t')
  )

  return [...header, ...rows].join('\n')
}
