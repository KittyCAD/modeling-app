import { Text, type Extension } from '@codemirror/state'
import { ViewPlugin, keymap } from '@codemirror/view'
import { batch, computed, signal } from '@preact/signals-core'
import type {
  Editor,
  EditorResourceHost,
  CodeEditorHost,
} from '@src/lib/editors/registry/contract'
import type { EditorSave, EditorOnSave } from '@src/lib/save/registry/contract'
import { matchesEditor } from '@src/lib/editors/matching'
import { isErr, trap, reportRejection } from '@src/lib/trap'

/** In-flight writes share a source's adoption revision, including across buffers. */
interface SourceSaveQueue {
  adoption: number
  pending?: Promise<undefined | Error>
}

/** A document baseline survives capability reconfiguration; attached entries own subscriptions. */
export function createEditorSave(
  getSaveHandlers: () => readonly EditorOnSave[]
) {
  const entries = new WeakMap<Editor, ReturnType<typeof createEntry>>()
  const attached = new Set<Editor>()
  const saves = new Map<string, SourceSaveQueue>()
  const lastFocusedEditor = signal<Editor | undefined>(undefined)
  let disposed = false

  function createEntry(editor: Editor) {
    const saved = signal(editor.state.doc)
    const document = signal(editor.state.doc)
    const pending = signal(0)
    const error = signal<Error | undefined>(undefined)
    const state = computed(() => ({
      dirty: !editor.src.value || !document.value.eq(saved.value),
      saving: pending.value > 0,
      error: error.value,
    }))
    return { saved, document, pending, error, state }
  }
  function entryFor(editor: Editor) {
    let entry = entries.get(editor)
    if (!entry) {
      entry = createEntry(editor)
      entries.set(editor, entry)
    }
    return entry
  }
  const focus = (editor: Editor) => {
    if (attached.has(editor)) lastFocusedEditor.value = editor
  }
  const service: EditorSave = {
    lastFocusedEditor,
    adopt: (editor, contents) => {
      if (disposed || !attached.has(editor))
        return new Error('This editor is no longer open')
      const entry = entryFor(editor)
      const src = editor.src.peek()
      const queue = src ? saves.get(src) : undefined
      if (queue) queue.adoption++
      batch(() => {
        entry.saved.value = Text.of(contents.split(/\r\n?|\n/))
        entry.error.value = undefined
      })
    },
    state: (editor) => entryFor(editor).state,
    save: (editor) => {
      if (disposed || !attached.has(editor)) {
        return Promise.resolve(new Error('This editor is no longer open'))
      }
      const entry = entryFor(editor)
      const fail = (error: Error) => {
        if (!disposed && attached.has(editor)) entry.error.value = error
        return error
      }
      const src = editor.src.peek()
      if (!src)
        return Promise.resolve(
          fail(new Error('Assign a file path before saving this buffer'))
        )
      const document: Text = editor.state.doc
      const saved = {
        editor,
        src,
        contents: document.toString(),
        ...editor.classification.peek(),
      }
      const queue: SourceSaveQueue = saves.get(src) ?? { adoption: 0 }
      saves.set(src, queue)
      const previous = queue.pending
      const adoption = queue.adoption
      entry.pending.value++
      entry.error.value = undefined
      const runSave = async (): Promise<undefined | Error> => {
        // Preserve invocation order even when distinct buffers save the same source.
        await previous
        if (disposed || !attached.has(editor) || editor.src.peek() !== src) {
          return fail(new Error('The editor changed before saving started'))
        }
        if (queue.adoption !== adoption) return undefined
        try {
          const handlers = getSaveHandlers()
            .filter((handler) => matchesEditor(handler.matches, saved))
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          if (!handlers.length)
            return fail(
              new Error('No save behavior is available for this editor')
            )
          for (const handler of handlers) {
            // Closing a project destroys its editors. Never run a later step for
            // a different opening, including one with the same root path.
            if (
              disposed ||
              !attached.has(editor) ||
              editor.src.peek() !== src
            ) {
              return fail(
                new Error('The editor changed before saving completed')
              )
            }
            if (queue.adoption !== adoption) return undefined
            const result = await handler.onSave(saved)
            if (queue.adoption !== adoption) return undefined
            if (isErr(result)) return fail(result)
          }
          if (disposed || !attached.has(editor) || editor.src.peek() !== src) {
            return fail(new Error('The editor changed before saving completed'))
          }
          if (queue.adoption !== adoption) return undefined
          batch(() => {
            entry.error.value = undefined
            // All buffers for this source compare with the completed save snapshot.
            for (const candidate of attached) {
              if (candidate.src.peek() === src)
                entryFor(candidate).saved.value = document
            }
          })
        } catch (cause) {
          if (queue.adoption !== adoption) return undefined
          const error = isErr(cause)
            ? cause
            : new Error('Unable to save the editor', { cause })
          return fail(error)
        }
      }
      const result = runSave().finally(() => {
        if (!disposed && attached.has(editor)) entry.pending.value--
        if (queue.pending === result) saves.delete(src)
      })
      queue.pending = result
      return result
    },
  }
  return {
    service,
    focus,
    setup: ({ editor, onDispose }: EditorResourceHost) => {
      const entry = entryFor(editor)
      attached.add(editor)
      entry.document.value = editor.state.doc
      onDispose(
        editor.subscribe((transaction) => {
          if (transaction.docChanged)
            entry.document.value = transaction.state.doc
        })
      )
      onDispose(() => {
        attached.delete(editor)
        if (lastFocusedEditor.peek() === editor)
          lastFocusedEditor.value = undefined
      })
      return undefined
    },
    codeExtensions: ({ editor }: CodeEditorHost): Extension => [
      ViewPlugin.define(() => ({
        update: (update) => {
          if (update.view.hasFocus) focus(editor)
        },
      })),
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            if (!attached.has(editor)) return false
            void service
              .save(editor)
              .then((result) => {
                if (isErr(result)) trap(result)
              })
              .catch(reportRejection)
            return true
          },
        },
      ]),
    ],
    dispose: () => {
      disposed = true
      attached.clear()
      lastFocusedEditor.value = undefined
    },
  }
}
