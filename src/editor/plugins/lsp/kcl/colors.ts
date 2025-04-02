import { language, syntaxTree } from '@codemirror/language'
import type { Extension, Range, Text } from '@codemirror/state'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view'
import type { Tree } from '@lezer/common'
import { NodeProp } from '@lezer/common'
import { isArray } from '@src/lib/utils'

interface PickerState {
  from: number
  to: number
  alpha: string
  colorType: ColorType
}

export interface WidgetOptions extends PickerState {
  color: string
}

export type ColorData = Omit<WidgetOptions, 'from' | 'to'>

const pickerState = new WeakMap<HTMLInputElement, PickerState>()

export enum ColorType {
  hex = 'HEX',
}

const hexRegex = /(^|\b)(#[0-9a-f]{3,9})(\b|$)/i

function discoverColorsInKCL(
  syntaxTree: Tree,
  from: number,
  to: number,
  typeName: string,
  doc: Text,
  language?: string
): WidgetOptions | Array<WidgetOptions> | null {
  switch (typeName) {
    case 'Program':
    case 'VariableDeclaration':
    case 'CallExpression':
    case 'ObjectExpression':
    case 'ObjectProperty':
    case 'ArgumentList':
    case 'PipeExpression': {
      let innerTree = syntaxTree.resolveInner(from, 0).tree

      if (!innerTree) {
        innerTree = syntaxTree.resolveInner(from, 1).tree
        if (!innerTree) {
          return null
        }
      }

      const overlayTree = innerTree.prop(NodeProp.mounted)?.tree

      if (overlayTree?.type.name !== 'Styles') {
        return null
      }

      const ret: Array<WidgetOptions> = []
      overlayTree.iterate({
        from: 0,
        to: overlayTree.length,
        enter: ({ type, from: overlayFrom, to: overlayTo }) => {
          const maybeWidgetOptions = discoverColorsInKCL(
            syntaxTree,
            // We add one because the tree doesn't include the
            // quotation mark from the style tag
            from + 1 + overlayFrom,
            from + 1 + overlayTo,
            type.name,
            doc,
            language
          )

          if (maybeWidgetOptions) {
            if (isArray(maybeWidgetOptions)) {
              console.error('Unexpected nested overlays')
              ret.push(...maybeWidgetOptions)
            } else {
              ret.push(maybeWidgetOptions)
            }
          }
        },
      })

      return ret
    }

    case 'String': {
      const result = parseColorLiteral(doc.sliceString(from, to))
      if (!result) {
        return null
      }
      return {
        ...result,
        from,
        to,
      }
    }

    default:
      return null
  }
}

export function parseColorLiteral(colorLiteral: string): ColorData | null {
  const literal = colorLiteral.replace(/"/g, '')
  const match = hexRegex.exec(literal)
  if (!match) {
    return null
  }
  const [color, alpha] = toFullHex(literal)

  return {
    colorType: ColorType.hex,
    color,
    alpha,
  }
}

function colorPickersDecorations(
  view: EditorView,
  discoverColors: typeof discoverColorsInKCL
) {
  const widgets: Array<Range<Decoration>> = []

  const st = syntaxTree(view.state)

  for (const range of view.visibleRanges) {
    st.iterate({
      from: range.from,
      to: range.to,
      enter: ({ type, from, to }) => {
        const maybeWidgetOptions = discoverColors(
          st,
          from,
          to,
          type.name,
          view.state.doc,
          view.state.facet(language)?.name
        )

        if (!maybeWidgetOptions) {
          return
        }

        if (!isArray(maybeWidgetOptions)) {
          widgets.push(
            Decoration.widget({
              widget: new ColorPickerWidget(maybeWidgetOptions),
              side: 1,
            }).range(maybeWidgetOptions.from)
          )

          return
        }

        for (const wo of maybeWidgetOptions) {
          widgets.push(
            Decoration.widget({
              widget: new ColorPickerWidget(wo),
              side: 1,
            }).range(wo.from)
          )
        }
      },
    })
  }

  return Decoration.set(widgets)
}

function toFullHex(color: string): string[] {
  if (color.length === 4) {
    // 3-char hex
    return [
      `#${color[1].repeat(2)}${color[2].repeat(2)}${color[3].repeat(2)}`,
      '',
    ]
  }

  if (color.length === 5) {
    // 4-char hex (alpha)
    return [
      `#${color[1].repeat(2)}${color[2].repeat(2)}${color[3].repeat(2)}`,
      color[4].repeat(2),
    ]
  }

  if (color.length === 9) {
    // 8-char hex (alpha)
    return [`#${color.slice(1, -2)}`, color.slice(-2)]
  }

  return [color, '']
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
      other.state.colorType === this.state.colorType &&
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
    '&::-webkit-color-swatch-wrapper': {
      padding: 0,
    },
    '&::-webkit-color-swatch': {
      border: 'none',
    },
    '&::-moz-color-swatch': {
      border: 'none',
    },
  },
})

interface IFactoryOptions {
  discoverColors: typeof discoverColorsInKCL
}

export const makeColorPicker = (options: IFactoryOptions) =>
  ViewPlugin.fromClass(
    class ColorPickerViewPlugin {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = colorPickersDecorations(view, options.discoverColors)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = colorPickersDecorations(
            update.view,
            options.discoverColors
          )
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        change: (e, view) => {
          const target = e.target as HTMLInputElement
          if (
            target.nodeName !== 'INPUT' ||
            !target.parentElement ||
            !target.parentElement.classList.contains(wrapperClassName)
          ) {
            return false
          }

          const data = pickerState.get(target)!

          let converted = '"' + target.value + data.alpha + '"'

          view.dispatch({
            changes: {
              from: data.from,
              to: data.to,
              insert: converted,
            },
          })

          return true
        },
      },
    }
  )

export const colorPicker: Extension = [
  makeColorPicker({ discoverColors: discoverColorsInKCL }),
  colorPickerTheme,
]
