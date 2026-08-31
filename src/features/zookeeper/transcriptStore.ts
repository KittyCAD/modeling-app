import type { FileSystem } from '@src/contracts/fileSystem'
import type { FsOperationQueue } from '@src/contracts/fsOperations'
import type {
  ConversationId,
  ReasoningEntry,
  Turn,
  UnappliedChange,
} from '@src/contracts/zookeeper'
import { hashString } from '@src/lib/hash'
import { joinPath } from '@src/lib/paths'

/** Where transcripts live, relative to the project root. */
export const TRANSCRIPT_DIRECTORY = '.zoo/conversations'

/** Bumped when a line's shape changes, so an old file can be recognised. */
const FORMAT_VERSION = 1

export interface StoredTranscript {
  id: ConversationId
  /** The service's own conversation id, for resuming. */
  remoteId: string | null
  createdAt: number
  turns: readonly Turn[]
}

export interface TranscriptStore {
  /** Every conversation stored for the project, newest first. */
  list(): Promise<readonly StoredTranscript[]>
  read(id: ConversationId): Promise<StoredTranscript | null>
  save(transcript: StoredTranscript): Promise<void>
  remove(id: ConversationId): Promise<void>
}

interface MetaLine {
  v: number
  kind: 'meta'
  id: ConversationId
  remoteId: string | null
  createdAt: number
}

interface TurnLine {
  v: number
  kind: 'turn'
  /** Fields added later are optional on the way in: older files lack them. */
  turn: Omit<Turn, 'reasoning' | 'unapplied'> & {
    reasoning?: readonly ReasoningEntry[]
    unapplied?: readonly UnappliedChange[]
  }
}

/**
 * Conversations on disk, beside the project they are about.
 *
 * **`<project>/.zoo/conversations/<id>.jsonl`.** In the project rather than in
 * the app's config directory so a transcript travels with the work it describes,
 * and under a dotted directory because `src/lib/projectFiles.ts` already skips
 * names starting with `.` — which means the explorer, `session.files` and the
 * baseline capture all ignore it for free. That last one matters: without it the
 * agent would be sent its own transcripts as project context.
 *
 * **JSONL, not JSON.** A transcript is append-shaped and unbounded, and a crash
 * mid-write must not cost the previous two hundred turns. One object per line
 * gives that. TOML is out for a different reason: `SettingsValue` is scalar-only,
 * so `project.toml` cannot hold nested turns.
 *
 * **Written at turn boundaries, never per streamed token.** `writeFile` is
 * whole-file with no append, so a line is added by read-modify-write — cheap at
 * turn granularity, ruinous per delta.
 *
 * The server is a peer, not the owner. It has the authoritative context for the
 * *model*; this is what the app shows, and it survives the client being wrong
 * about a replay.
 */
export function createTranscriptStore(dependencies: {
  /** Absolute project root. */
  projectPath: string
  fileSystem: FileSystem
  /** Serialises writes per path, and records provenance for the watcher. */
  queue: FsOperationQueue
}): TranscriptStore {
  const { projectPath, fileSystem, queue } = dependencies

  const directory = () => joinPath(projectPath, TRANSCRIPT_DIRECTORY)
  const fileFor = (id: ConversationId) => joinPath(directory(), `${id}.jsonl`)

  const parse = (contents: string): StoredTranscript | null => {
    let meta: MetaLine | null = null
    const turns: Turn[] = []

    for (const line of contents.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue

      let parsed: MetaLine | TurnLine
      try {
        parsed = JSON.parse(trimmed) as MetaLine | TurnLine
      } catch {
        /*
         * One unreadable line does not condemn the file. A crash mid-write can
         * leave a partial last line, and losing the turns before it because of
         * that would defeat the point of the format.
         */
        continue
      }

      if (parsed.v !== FORMAT_VERSION) continue
      if (parsed.kind === 'meta') meta = parsed
      /*
       * `reasoning` is normalised rather than trusted, because turns written
       * before it existed do not have it and `Turn` says they must.
       *
       * And the version is deliberately **not** bumped for it. A line whose
       * version is unrecognised is skipped, which for an older file means every
       * line — including the meta line, without which the whole transcript reads
       * as absent. Bumping to add an optional field would silently delete every
       * conversation anybody had already had. A version bump is for a change that
       * makes an old line *wrong*, not one that makes it incomplete.
       */ else
        turns.push({
          ...parsed.turn,
          reasoning: parsed.turn.reasoning ?? [],
          unapplied: parsed.turn.unapplied ?? [],
        })
    }

    if (meta === null) return null
    return {
      id: meta.id,
      remoteId: meta.remoteId,
      createdAt: meta.createdAt,
      turns,
    }
  }

  const serialise = (transcript: StoredTranscript): string => {
    const meta: MetaLine = {
      v: FORMAT_VERSION,
      kind: 'meta',
      id: transcript.id,
      remoteId: transcript.remoteId,
      createdAt: transcript.createdAt,
    }
    const lines = [
      JSON.stringify(meta),
      ...transcript.turns.map((turn) =>
        JSON.stringify({
          v: FORMAT_VERSION,
          kind: 'turn',
          turn,
        } satisfies TurnLine)
      ),
    ]
    return `${lines.join('\n')}\n`
  }

  return {
    async list() {
      /*
       * The directory is the index. A separate index file would be a second
       * source of truth, and the one thing it could do — be wrong — is not worth
       * the read it saves.
       */
      let entries: readonly { name: string; kind: string }[]
      try {
        entries = await fileSystem.readDirectory(directory())
      } catch {
        // No directory yet is the ordinary case for a project nobody has asked
        // Zookeeper about.
        return []
      }

      const found = await Promise.all(
        entries
          .filter(
            (entry) => entry.kind === 'file' && entry.name.endsWith('.jsonl')
          )
          .map(async (entry) => {
            const contents = await fileSystem.readTextFileIfPresent(
              joinPath(directory(), entry.name)
            )
            return contents === null ? null : parse(contents)
          })
      )

      return found
        .filter((each): each is StoredTranscript => each !== null)
        .sort((left, right) => right.createdAt - left.createdAt)
    },

    async read(id) {
      const contents = await fileSystem.readTextFileIfPresent(fileFor(id))
      return contents === null ? null : parse(contents)
    },

    async save(transcript) {
      const path = fileFor(transcript.id)
      const contents = serialise(transcript)

      await queue.enqueue(path, async () => {
        await fileSystem.makeDirectory(directory())
        /*
         * Recorded before the write, so the watcher can recognise the change as
         * ours by content. Recording afterwards leaves a window in which our own
         * write comes back as an external one.
         */
        queue.recordWrite(path, hashString(contents))
        await fileSystem.writeTextFile(path, contents)
      })
    },

    async remove(id) {
      const path = fileFor(id)
      await queue.enqueue(path, async () => {
        try {
          await fileSystem.remove(path)
        } catch {
          // Already gone is the outcome the caller wanted.
        }
      })
    },
  }
}
