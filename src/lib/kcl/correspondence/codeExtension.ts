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
import type { CorrespondenceBridge } from '@src/lib/kcl/correspondence/bridge'
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
  bridge: CorrespondenceBridge,
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
        unregister: () => void
        destroyed = false
        constructor() {
          this.unregister = bridge.registerCode({
            id: host.instance.id,
            editor: host.editor,
            enabled,
            decorate: (ranges) => {
              if (
                !this.destroyed &&
                host.view.state.field(correspondence, false) !== undefined
              )
                host.view.dispatch({ effects: setCorrespondence.of(ranges) })
            },
          })
        }
        update(update: ViewUpdate) {
          if (update.docChanged) bridge.invalidateCode(host.instance.id)
          if (
            update.selectionSet &&
            update.transactions.some((transaction) =>
              transaction.isUserEvent('select')
            )
          )
            bridge.selectCode(
              host.instance.id,
              update.state.selection.ranges.map((range) => [
                range.from,
                range.to,
                0,
              ])
            )
        }
        destroy() {
          this.destroyed = true
          this.unregister()
        }
      }
    ),
  ]
}
