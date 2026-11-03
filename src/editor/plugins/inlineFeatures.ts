import {
  Compartment,
  type Range,
  StateEffect,
  StateField,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'

export interface InlineFeature {
  id: string
  from: number
  to: number
  operations: Operation[]
}

/** Only complete top-level statements may be replaced. Parameters and comments
 * remain code, and a pipeline keeps all of its feature buttons together. Ranges
 * are UTF-16 editor offsets; the caller converts the AST's UTF-8 byte offsets. */
export function collectInlineFeatures(
  code: string,
  statements: { start: number; end: number }[],
  operations: Operation[],
  offset: (byte: number) => number
): InlineFeature[] {
  const features: InlineFeature[] = []
  for (const statement of statements) {
    const start = offset(statement.start)
    const end = offset(statement.end)
    if (start < 0 || end <= start || end > code.length) {
      continue
    }
    const from = code.lastIndexOf('\n', start - 1) + 1
    const newline = code.indexOf('\n', end)
    const to = newline < 0 ? code.length : newline
    // Never hide a neighbouring statement or trailing comment.
    if (code.slice(from, start).trim() || code.slice(end, to).trim()) {
      continue
    }
    let depth = 0
    const items = operations.filter((operation) => {
      if (operation.type === 'GroupEnd') {
        depth = Math.max(0, depth - 1)
        return false
      }
      const nested = depth > 0
      if (operation.type === 'GroupBegin') {
        depth++
      }
      if (
        nested ||
        operation.type === 'VariableDeclaration' ||
        operation.type === 'ModuleInstance'
      ) {
        return false
      }
      if (
        operation.type === 'GroupBegin' &&
        operation.group.type !== 'SketchBlock'
      ) {
        return false
      }
      return (
        operation.sourceRange[0] >= statement.start &&
        operation.sourceRange[1] <= statement.end
      )
    })
    if (items.length) {
      features.push({ id: `${from}:${to}`, from, to, operations: items })
    }
  }
  // Source positions are the ordering contract for a future reorder interaction.
  return features
    .sort((a, b) => a.from - b.from)
    .filter((feature, i, sorted) => i === 0 || feature.from >= sorted[i - 1].to)
}

export const inlineFeaturesCompartment = new Compartment()
export const setInlineFeatures =
  StateEffect.define<(InlineFeature & { host: HTMLElement })[]>()
export const revealInlineFeature = StateEffect.define<{
  id: string
  expanded: boolean
}>()

class FeatureWidget extends WidgetType {
  constructor(readonly host: HTMLElement) {
    super()
  }
  eq(other: FeatureWidget) {
    return this.host === other.host
  }
  toDOM() {
    return this.host
  }
  ignoreEvent() {
    return true
  }
}

/** Planes are UI at the top of the same scroller, never source text. */
export const setInlinePlanes = StateEffect.define<HTMLElement>()
export const inlinePlanesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setInlinePlanes)) {
        return Decoration.set([
          Decoration.widget({
            widget: new FeatureWidget(effect.value),
            block: true,
            side: -2,
          }).range(0),
        ])
      }
    }
    return value
  },
  provide: (field) => EditorView.decorations.from(field),
})

interface InlineState {
  features: (InlineFeature & { host: HTMLElement })[]
  expanded: ReadonlySet<string>
  decorations: DecorationSet
}

export const inlineFeaturesField = StateField.define<InlineState>({
  create: () => ({
    features: [],
    expanded: new Set(),
    decorations: Decoration.none,
  }),
  update(value, transaction) {
    // A document edit invalidates execution ranges immediately, before React or
    // the next execution catches up. Never map old features over new source.
    if (transaction.docChanged) {
      return { features: [], expanded: new Set(), decorations: Decoration.none }
    }
    let features = value.features
    const expanded = new Set(value.expanded)
    let changed = false
    for (const effect of transaction.effects) {
      if (effect.is(setInlineFeatures)) {
        features = effect.value
        changed = true
      }
      if (effect.is(revealInlineFeature)) {
        if (effect.value.expanded) {
          expanded.add(effect.value.id)
        } else {
          expanded.delete(effect.value.id)
        }
        changed = true
      }
    }
    // Search, go-to-error, and viewport selection must expose their target code.
    if (transaction.selection) {
      for (const feature of features) {
        if (
          transaction.state.selection.ranges.some(
            ({ from, to }) => to > feature.from && from < feature.to
          )
        ) {
          expanded.add(feature.id)
          changed = true
        }
      }
    }
    if (!changed) {
      return value
    }
    const ranges: Range<Decoration>[] = []
    for (const feature of features) {
      const widget = new FeatureWidget(feature.host)
      ranges.push(
        expanded.has(feature.id)
          ? Decoration.widget({ widget, block: true, side: -1 }).range(
              feature.from
            )
          : Decoration.replace({ widget, block: true }).range(
              feature.from,
              feature.to
            )
      )
    }
    return { features, expanded, decorations: Decoration.set(ranges, true) }
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
})

export const inlineFeaturesTheme = EditorView.baseTheme({
  '.cm-inline-feature': {
    margin: '0 8px 0 0',
    display: 'block',
    background: 'transparent',
  },
  '.cm-inline-feature-operations': { minWidth: '0' },
  '.cm-inline-planes': { margin: '0 8px 12px 0' },
})
