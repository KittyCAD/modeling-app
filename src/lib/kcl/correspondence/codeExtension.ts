import { toUtf8, toUtf16 } from '@src/lang/errors'
import { correspondenceStyle } from '@src/lib/kcl/correspondence/appearance'
import type { ReadonlySignal } from '@preact/signals-core'
import { StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import type { CodeEditorHost } from '@src/lib/editors/registry/contract'
import type {
  KclCorrespondenceEndpoints,
  CodeCorrespondenceHandle,
} from '@src/lib/kcl/correspondence/contract'
import { reportRejection } from '@src/lib/trap'
import type { SourceRange } from '@src/lang/wasm'

const setCorrespondence = StateEffect.define<readonly SourceRange[]>()
const correspondence = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (previous, transaction) => {
    for (const effect of transaction.effects) {
      if (!effect.is(setCorrespondence)) continue
      const ranges = new Map(
        effect.value
          .filter(
            (range) =>
              range[0] < range[1] &&
              range[0] >= 0 &&
              range[1] <= transaction.newDoc.length
          )
          .map((range) => [`${range[0]}:${range[1]}`, range])
      )
      return Decoration.set(
        [...ranges.values()].map((range) =>
          Decoration.mark({ class: 'cm-geometry-correspondence' }).range(
            range[0],
            range[1]
          )
        ),
        true
      )
    }
    // Correspondence describes executed bytes. Mapping it across arbitrary source edits would imply unproven provenance.
    return transaction.docChanged ? Decoration.none : previous
  },
  provide: (field) => EditorView.decorations.from(field),
})

/** Decorations never replace text selection, scroll a pane, or generate new picking intent. */
export function correspondenceCodeExtension(
  host: CodeEditorHost,
  bridge: KclCorrespondenceEndpoints,
  enabled?: ReadonlySignal<boolean>
) {
  return [
    correspondence,
    EditorView.baseTheme({
      '.cm-geometry-correspondence': {
        backgroundColor: 'rgba(245, 185, 60, 0.22)',
        borderBottom: '1px solid rgba(245, 185, 60, 0.65)',
      },
    }),
    ViewPlugin.fromClass(
      class {
        handle: CodeCorrespondenceHandle | undefined
        destroyed = false
        constructor() {
          const handle = bridge.registerCode({
            id: host.instance.id,
            style: correspondenceStyle(host.instance),
            editor: host.editor,
            enabled,
            decorate: (ranges) => {
              if (
                !this.destroyed &&
                host.view.state.field(correspondence, false) !== undefined
              )
                host.view.dispatch({
                  effects: setCorrespondence.of(
                    ranges.map((range) => [
                      toUtf16(range[0], host.view.state.doc.toString()),
                      toUtf16(range[1], host.view.state.doc.toString()),
                      range[2],
                    ])
                  ),
                })
            },
          })
          if (handle instanceof Error) reportRejection(handle)
          else this.handle = handle
        }
        update(update: ViewUpdate) {
          if (update.docChanged) this.handle?.invalidate()
          if (
            update.selectionSet &&
            update.transactions.some((transaction) =>
              transaction.isUserEvent('select')
            )
          )
            this.handle?.select(
              update.state.selection.ranges.map((range) =>
                toUtf8([range.from, range.to, 0], update.state.doc.toString())
              )
            )
        }
        destroy() {
          this.destroyed = true
          this.handle?.dispose()
        }
      }
    ),
  ]
}
