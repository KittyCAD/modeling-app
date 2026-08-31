import type { ReasoningMessage } from '@kittycad/lib'
import type { ReasoningEntry } from '@src/contracts/zookeeper'

/**
 * One `ReasoningMessage` as this app models it.
 *
 * The protocol adapter for the service's working, sitting beside `deriveEdit.ts`
 * for the same reason: this file knows the wire union, and nothing downstream
 * does. Fifteen arms map onto six kinds — see `ReasoningEntry` for why — and an
 * arm added to the protocol lands in `null` rather than in a crash, which is the
 * right failure for something whose only job is explanation.
 *
 * Empty content returns null too. The service emits prose in chunks and an empty
 * one is a heartbeat, not a thought; rendering it would put a blank line in the
 * middle of somebody's explanation.
 */
export function reasoningEntryFrom(
  message: ReasoningMessage
): ReasoningEntry | null {
  switch (message.type) {
    case 'text':
    case 'markdown': {
      /*
       * Markdown is kept as text rather than rendered. The pane has no markdown
       * renderer, and running one over model output is a decision about
       * sanitisation and link handling that this feature should not be making
       * on the way past.
       */
      const content = message.content
      return content === '' ? null : { kind: 'text', content }
    }

    case 'design_plan': {
      const steps = message.steps.map((step) => ({
        path: step.filepath_to_edit,
        instructions: step.edit_instructions,
      }))
      return steps.length === 0 ? null : { kind: 'plan', steps }
    }

    case 'generated_kcl_code':
      return message.code === ''
        ? null
        : { kind: 'code', content: message.code }

    case 'kcl_code_error':
      return message.error === ''
        ? null
        : { kind: 'error', message: message.error }

    case 'created_kcl_file':
    case 'created_project_file':
      return { kind: 'file', action: 'created', path: message.file_name }

    case 'updated_kcl_file':
    case 'updated_project_file':
      return { kind: 'file', action: 'updated', path: message.file_name }

    case 'deleted_kcl_file':
    case 'deleted_project_file':
      return { kind: 'file', action: 'deleted', path: message.file_name }

    case 'kcl_docs':
      return message.content === ''
        ? null
        : {
            kind: 'reference',
            label: 'KCL documentation',
            content: message.content,
          }

    case 'kcl_code_examples':
      return message.content === ''
        ? null
        : { kind: 'reference', label: 'KCL examples', content: message.content }

    case 'feature_tree_outline':
      return message.content === ''
        ? null
        : { kind: 'reference', label: 'Feature tree', content: message.content }

    default:
      /*
       * An arm this build has not been taught. Dropped rather than rendered as
       * a stringified object, and deliberately not thrown: the protocol gains
       * reasoning kinds faster than a client ships, and a turn that edits files
       * correctly should not fail because it also explained itself in a new way.
       */
      return null
  }
}

/**
 * One line naming what the service was doing, for a collapsed summary.
 *
 * Short and present-tense, because while a turn streams this *is* the answer to
 * "what is it doing" — the thing the pane could previously only call "Working…".
 */
export function describeReasoning(entry: ReasoningEntry): string {
  switch (entry.kind) {
    case 'text':
      return 'Thinking'
    case 'plan':
      return `Planning ${entry.steps.length} ${
        entry.steps.length === 1 ? 'file' : 'files'
      }`
    case 'code':
      return 'Writing KCL'
    case 'error':
      return 'Working through a KCL error'
    case 'file':
      return `${
        entry.action === 'created'
          ? 'Created'
          : entry.action === 'updated'
            ? 'Updated'
            : 'Deleted'
      } ${entry.path}`
    case 'reference':
      return `Reading ${entry.label.toLowerCase()}`
  }
}

/**
 * The disclosure's label.
 *
 * The newest step while it is happening, a count once it is over: mid-turn the
 * useful thing is what it is doing *now*, and afterwards it is how much there is
 * to read.
 */
export function reasoningHeadline(
  entries: readonly ReasoningEntry[],
  streaming: boolean
): string {
  const latest = entries.at(-1)
  if (streaming && latest !== undefined) return describeReasoning(latest)
  return `Working — ${entries.length} ${
    entries.length === 1 ? 'step' : 'steps'
  }`
}

/**
 * Add an entry to a turn's working, joining prose as it streams.
 *
 * Text arrives in chunks the way `delta` does, and one entry per chunk would
 * render a paragraph as forty fragments. Only *adjacent* text is joined — a plan
 * or a file event between two chunks means the service moved on and came back,
 * which is a real boundary in its working and the pane should show it as one.
 */
export function appendReasoning(
  entries: readonly ReasoningEntry[],
  entry: ReasoningEntry
): readonly ReasoningEntry[] {
  const last = entries.at(-1)
  if (last?.kind === 'text' && entry.kind === 'text') {
    return [
      ...entries.slice(0, -1),
      { kind: 'text', content: last.content + entry.content },
    ]
  }
  return [...entries, entry]
}
