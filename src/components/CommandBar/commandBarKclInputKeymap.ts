import { acceptCompletion, completionStatus } from '@codemirror/autocomplete'
import { StateEffect } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import type { EditorView, KeyBinding, ViewUpdate } from '@codemirror/view'
import { ViewPlugin } from '@codemirror/view'

const queuePendingEnter = StateEffect.define()

export function createCommandBarKclInputPendingEnterExtension({
  onSubmit,
}: {
  onSubmit: () => void
}): Extension {
  return ViewPlugin.fromClass(
    class {
      private enterQueued = false
      private replayScheduled = false
      private destroyed = false

      constructor(private readonly view: EditorView) {}

      update(update: ViewUpdate) {
        if (
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(queuePendingEnter))
          )
        ) {
          this.enterQueued = true
        }

        this.scheduleReplay()
      }

      private scheduleReplay() {
        if (
          !this.enterQueued ||
          this.replayScheduled ||
          completionStatus(this.view.state) === 'pending'
        ) {
          return
        }

        this.replayScheduled = true
        queueMicrotask(() => {
          this.replayScheduled = false
          if (this.destroyed || !this.enterQueued) return

          const status = completionStatus(this.view.state)
          if (status === 'pending') return

          this.enterQueued = false
          if (status === 'active' && acceptCompletion(this.view)) return

          onSubmit()
        })
      }

      destroy() {
        this.destroyed = true
        this.enterQueued = false
      }
    }
  )
}

export function createCommandBarKclInputKeymap({
  onSubmit,
  stepBack,
}: {
  onSubmit: () => void
  stepBack: () => void
}): KeyBinding[] {
  return [
    {
      key: 'Enter',
      preventDefault: true,
      run: (editor) => {
        // The autocomplete keymap has higher precedence and accepts an active
        // completion first. If it is still pending, defer this Enter until the
        // completion finishes so a fast keypress is not lost.
        const status = completionStatus(editor.state)
        if (status === 'pending') {
          editor.dispatch({ effects: queuePendingEnter.of(null) })
          return true
        }
        if (status === 'active') {
          return true
        }
        onSubmit()
        return true
      },
    },
    {
      key: 'Meta-Backspace',
      run: () => {
        stepBack()
        return true
      },
    },
  ]
}
