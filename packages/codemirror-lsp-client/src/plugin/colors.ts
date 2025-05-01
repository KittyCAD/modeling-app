import {
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
  type ViewUpdate,
} from '@codemirror/view'

import type { LanguageServerPlugin } from './lsp'
import { lspColorUpdateEvent } from './annotation'
import { isArray } from '../lib/utils'
import { offsetToPos, posToOffset, posToOffsetOrZero } from './util'
import type * as LSP from 'vscode-languageserver-protocol'

/* ------------------------------------------------------------------ */
/* ----------  original helpers / widget / color utilities  ---------- */
/* ------------------------------------------------------------------ */

interface PickerState {
  from: number
  to: number
  red: number
  green: number
  blue: number
  alpha: number
}

export interface WidgetOptions extends PickerState {
  color: string
}

export type ColorData = Omit<WidgetOptions, 'from' | 'to'>

const pickerState = new WeakMap<HTMLInputElement, PickerState>()

function rgbaToHex(color: LSP.Color): string {
  return (
    '#' +
    [color.red, color.green, color.blue]
      .map((c) =>
        Math.round(c * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}

function hexToRGBComponents(hex: string): number[] {
  const r = hex.slice(1, 3)
  const g = hex.slice(3, 5)
  const b = hex.slice(5, 7)
  return [parseInt(r, 16) / 255, parseInt(g, 16) / 255, parseInt(b, 16) / 255]
}

async function discoverColorsViaLsp(
  view: EditorView,
  plugin: LanguageServerPlugin
): Promise<WidgetOptions | Array<WidgetOptions> | null> {
  const responses = await plugin.requestDocumentColors()
  if (!responses) return null

  const colors: Array<WidgetOptions> = []
  for (const color of responses) {
    if (!color.range || !color.color) continue

    const { start, end } = color.range
    const from = posToOffset(view.state.doc, start)
    const to = posToOffset(view.state.doc, end)
    if (from == null || to == null) continue

    colors.push({
      color: rgbaToHex(color.color),
      ...color.color,
      from,
      to,
    })
  }
  return colors
}

async function colorPickersDecorations(
  view: EditorView,
  plugin: LanguageServerPlugin
): Promise<DecorationSet> {
  const widgets: Array<Range<Decoration>> = []
  const maybe = await discoverColorsViaLsp(view, plugin)
  if (!maybe) return Decoration.none

  const optionsList = isArray(maybe) ? maybe : [maybe]
  for (const wo of optionsList) {
    widgets.push(
      Decoration.widget({
        widget: new ColorPickerWidget(wo),
        side: 1,
      }).range(wo.from)
    )
  }
  return Decoration.set(widgets)
}

export const wrapperClassName = 'cm-css-color-picker-wrapper'

class ColorPickerWidget extends WidgetType {
  private readonly state: PickerState
  private readonly color: string

  constructor({ color, ...state }: WidgetOptions) {
    super()
    this.state = state
    this.color = color
  }

  eq(other: ColorPickerWidget) {
    return (
      other.color === this.color &&
      other.state.from === this.state.from &&
      other.state.to === this.state.to &&
      other.state.alpha === this.state.alpha
    )
  }

  toDOM() {
    const picker = document.createElement('input')
    pickerState.set(picker, this.state)
    picker.type = 'color'
    picker.value = this.color

    const wrapper = document.createElement('span')
    wrapper.appendChild(picker)
    wrapper.className = wrapperClassName
    return wrapper
  }

  ignoreEvent() {
    return false
  }
}

export const colorPickerTheme = EditorView.baseTheme({
  [`.${wrapperClassName}`]: {
    display: 'inline-block',
    outline: '1px solid #eee',
    marginRight: '0.6ch',
    height: '1em',
    width: '1em',
    transform: 'translateY(1px)',
  },
  [`.${wrapperClassName} input[type="color"]`]: {
    cursor: 'pointer',
    height: '100%',
    width: '100%',
    padding: 0,
    border: 'none',
    '&::-webkit-color-swatch-wrapper': { padding: 0 },
    '&::-webkit-color-swatch': { border: 'none' },
    '&::-moz-color-swatch': { border: 'none' },
  },
})

/* ------------------------------------------------------------------ */
/* -------------------  ✅  new state machinery  -------------------- */
/* ------------------------------------------------------------------ */

// Effect that carries a fresh DecorationSet
const setColorDecorations = StateEffect.define<DecorationSet>()

// Field that stores the current DecorationSet
const colorDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const e of tr.effects) if (e.is(setColorDecorations)) value = e.value
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})

/* ------------------------------------------------------------------ */
/* ------------------  original ViewPlugin, patched  ---------------- */
/* ------------------------------------------------------------------ */

export const makeColorPicker = (plugin: ViewPlugin<LanguageServerPlugin>) =>
  ViewPlugin.fromClass(
    class ColorPickerViewPlugin {
      plugin: LanguageServerPlugin | null

      constructor(view: EditorView) {
        this.plugin = view.plugin(plugin)
        if (!this.plugin) return

        // initial async load → dispatch decorations
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        colorPickersDecorations(view, this.plugin).then((deco) => {
          view.dispatch({ effects: setColorDecorations.of(deco) })
        })
      }

      async update(update: ViewUpdate) {
        if (!this.plugin) return
        if (!(update.docChanged || update.viewportChanged)) return

        const deco = await colorPickersDecorations(update.view, this.plugin)
        update.view.dispatch({ effects: setColorDecorations.of(deco) })
      }
    },
    {
      eventHandlers: {
        change: (e: Event, view: EditorView) => {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          colorPickerChange(e, view, plugin)
        },
      },
    }
  )

/* ------------------------------------------------------------------ */
/* --------------------  unchanged event handler  ------------------- */
/* ------------------------------------------------------------------ */

async function colorPickerChange(
  e: Event,
  view: EditorView,
  plugin: ViewPlugin<LanguageServerPlugin>
): Promise<boolean> {
  const value = view.plugin(plugin)
  if (!value) return false

  const target = e.target as HTMLInputElement
  if (
    target.nodeName !== 'INPUT' ||
    !target.parentElement?.classList.contains(wrapperClassName)
  )
    return false

  const data = pickerState.get(target)!
  const converted = target.value + data.alpha
  const [red, green, blue] = hexToRGBComponents(converted)

  const responses = await value.requestColorPresentation(
    { red, green, blue, alpha: data.alpha },
    {
      start: offsetToPos(view.state.doc, data.from),
      end: offsetToPos(view.state.doc, data.to),
    }
  )
  if (!responses?.length) return false

  for (const resp of responses) {
    const changes = resp.textEdit
      ? {
          from: posToOffsetOrZero(view.state.doc, resp.textEdit.range.start),
          to: posToOffsetOrZero(view.state.doc, resp.textEdit.range.end),
          insert: resp.textEdit.newText,
        }
      : { from: data.from, to: data.to, insert: resp.label }

    view.dispatch({ changes, annotations: [lspColorUpdateEvent] })
  }
  return true
}

/* ------------------------------------------------------------------ */
/* -------------------------  public API  --------------------------- */
/* ------------------------------------------------------------------ */

export default function lspColorsExt(
  plugin: ViewPlugin<LanguageServerPlugin>
): Extension {
  return [colorDecorationsField, makeColorPicker(plugin), colorPickerTheme]
}
