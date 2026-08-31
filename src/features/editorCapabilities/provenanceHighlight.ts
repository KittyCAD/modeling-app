import { type Extension, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { cssVar, tokens } from '@kittycad/ui-kit/tokens'
import { effect } from '@preact/signals'
import type { EditorCapability } from '@src/contracts/buffers'
import type { PointingService } from '@src/contracts/pointing'
import type { ProvenanceRole, RangeMark } from '@src/lib/kcl/provenance'
import { bufferOrigin } from '@src/lib/buffers/annotations'
import { isTopLevel } from '@src/lib/kcl/artifacts'

/** Replaces whatever was decorated. Marks are never added to. */
const setMarks = StateEffect.define<readonly RangeMark[]>()

const DECORATIONS: Record<ProvenanceRole, Decoration> = {
  primary: Decoration.mark({ class: 'zds-provenance zds-provenance--primary' }),
  origin: Decoration.mark({ class: 'zds-provenance zds-provenance--origin' }),
  effect: Decoration.mark({ class: 'zds-provenance zds-provenance--effect' }),
  consumed: Decoration.mark({
    class: 'zds-provenance zds-provenance--consumed',
  }),
}

/**
 * What the pointer is connected to, in this document.
 *
 * Mapped through every transaction's changes so the marks survive an edit that
 * lands while the pointer is still resting somewhere — typing in one place
 * during a hover elsewhere is ordinary, and a decoration that jumped a character
 * would be worse than one that vanished.
 */
const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,

  update(marks, transaction) {
    for (const value of transaction.effects) {
      if (!value.is(setMarks)) continue

      const ranges = value.value
        /*
         * Only this file. The third element of a source range is the module id,
         * and the top-level module is zero — an offset from an imported module
         * means nothing in this document, and drawing it would put a highlight on
         * whatever text happened to be at that byte.
         */
        .filter((mark) => isTopLevel(mark.range))
        .map((mark) => ({
          from: Math.max(0, Math.min(mark.range[0], transaction.newDoc.length)),
          to: Math.max(0, Math.min(mark.range[1], transaction.newDoc.length)),
          role: mark.role,
        }))
        /*
         * A collapsed range draws nothing and CodeMirror rejects a reversed one.
         * Both happen when the graph is from a run against text that has since
         * been edited, which is a normal state while somebody is typing.
         */
        .filter((mark) => mark.to > mark.from)
        .sort((left, right) => left.from - right.from)

      return Decoration.set(
        ranges.map((mark) => DECORATIONS[mark.role].range(mark.from, mark.to))
      )
    }

    return marks.map(transaction.changes)
  },

  provide: (field) => EditorView.decorations.from(field),
})

/**
 * How the four roles read.
 *
 * A tint rather than a stripe, because these are stretches of an expression
 * rather than whole lines, and because a stripe already means "somebody else
 * wrote this" in the attribution capability.
 *
 * The roles are drawn as one idea at three strengths, not as three colours. The
 * question a reader is answering at a glance is *how much is this the thing*,
 * and three hues would ask them to learn a legend instead. `consumed` is the
 * exception and is deliberately not a tint at all: a strikethrough, because what
 * it says is that the thing named here is gone.
 */
const provenanceTheme = EditorView.theme({
  '.zds-provenance': {
    borderRadius: cssVar(tokens.radius.content),
  },
  '.zds-provenance--primary': {
    backgroundColor: cssVar(tokens.accentMuted),
    boxShadow: `inset 0 -${cssVar(tokens.size.hairline)} 0 0 ${cssVar(tokens.accent)}`,
  },
  '.zds-provenance--origin': {
    backgroundColor: cssVar(tokens.surface.selected),
  },
  '.zds-provenance--effect': {
    backgroundColor: cssVar(tokens.surface.hover),
  },
  '.zds-provenance--consumed': {
    textDecoration: 'line-through',
    textDecorationColor: cssVar(tokens.textColor.tertiary),
  },
})

/** The ranges currently decorated, for tests and for anything presenting them. */
export function highlightedRanges(state: {
  field: (field: typeof marksField) => DecorationSet
}): { from: number; to: number; role: string }[] {
  const found: { from: number; to: number; role: string }[] = []
  const cursor = state.field(marksField).iter()

  while (cursor.value !== null) {
    const classes = String(cursor.value.spec.class ?? '')
    found.push({
      from: cursor.from,
      to: cursor.to,
      role: classes.replace(/.*zds-provenance--/, ''),
    })
    cursor.next()
  }

  return found
}

/**
 * Point at code, and see what it made.
 *
 * The direction the existing app never built. Its highlighting is driven only
 * from the scene — every caller of its `setHighlightRange` is scene-side and
 * there is no editor mousemove handler anywhere in it — so pointing at a line
 * and watching the geometry it produced light up is new.
 *
 * Both halves are here because they are two ends of one gesture, not two
 * features: a `mousemove` says what is under the pointer, and a decoration draws
 * whatever the answer turns out to be, whichever surface the pointer was over.
 * Neither knows about the other; both go through the one signal.
 *
 * Only the executing buffer, for the reason `selectionReveal` gives: the
 * artifact graph describes one program, and pointing a different buffer at an
 * offset from this one would be a confident guess at the wrong file.
 */
export function createProvenanceHighlightCapability(dependencies: {
  pointing: () => PointingService | undefined
}): EditorCapability {
  /*
   * Built once. The extension must not depend on the buffer's context — a
   * capability whose extension differs between calls asks every buffer to
   * reconfigure, and there is a test asserting typing never does that.
   */
  const extension: Extension = [
    marksField,
    provenanceTheme,
    EditorView.domEventHandlers({
      mousemove(event, view) {
        const service = dependencies.pointing()
        if (!service) return

        const offset = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (offset === null) {
          service.clear('code')
          return
        }

        /*
         * Deduplicated inside the service, so this fires as often as the mouse
         * moves and costs a comparison. Doing it here instead would mean every
         * surface that can point had to remember to.
         */
        service.point({ at: { kind: 'offset', offset }, from: 'code' })
      },

      /*
       * Scoped to `code`: the pointer leaving the editor says nothing about a
       * hover the scene is still showing.
       */
      mouseleave() {
        dependencies.pointing()?.clear('code')
      },
    }),
  ]

  return {
    id: 'editor.provenanceHighlight',
    order: 31,
    appliesTo: (context) => context.executing,

    extension: () => extension,

    bind: (buffer) =>
      effect(() => {
        const service = dependencies.pointing()
        // A build with no pointing feature dispatches nothing at all, rather
        // than an empty decoration set on every buffer that opens.
        if (!service) return

        const found = service.provenance.value

        buffer.dispatch({
          effects: setMarks.of(found?.ranges ?? []),
          /*
           * Not an edit. No text changes, so persistence ignores it and the
           * history never sees it — a hover must not be undoable.
           */
          annotations: bufferOrigin.of('semantic'),
        })
      }),
  }
}

export { marksField }
