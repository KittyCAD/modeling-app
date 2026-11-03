import { defaultKeymap } from '@codemirror/commands'
import { syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { classHighlighter } from '@lezer/highlight'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { kcl } from '../../../packages/codemirror-lang-kcl/src/index'
import type { CustomIconName } from '../../../src/components/CustomIcon'
import {
  inlineFeaturesField,
  inlineFeaturesTheme,
  inlinePlanesField,
  revealInlineFeature,
  setInlineFeatures,
  setInlinePlanes,
} from '../../../src/editor/plugins/inlineFeatures'
import { InlineOperationRow } from '../../../src/lib/featureTree/InlineOperationRow'
import '../../../src/index.css'
import '../../../src/lib/featureTree/inlineFeatureEditor.css'

const source = `@settings(defaultLengthUnit = mm, kclVersion = 3.0)

thickness = 8

// Plate profile
profile = sketch(on = XY) {
  circle1 = circle(start = [var 40, var 0], center = [var 0, var 0])
}
plate = extrude(profile, length = thickness)

// These values remain editable
holeDiameter = 6
edgeRadius = 2
boltCount = 4
boltCircle = 60
clearance = 0.25
plateWidth = 100
plateLength = 140
mountOffset = 20
`
const renderers = new Map<string, () => void>()
const view = new EditorView({
  parent: document.querySelector('#code-mirror-override')!,
  state: EditorState.create({
    doc: source,
    extensions: [
      lineNumbers(),
      kcl(),
      syntaxHighlighting(classHighlighter),
      EditorView.lineWrapping,
      keymap.of(defaultKeymap),
      inlineFeaturesField,
      inlinePlanesField,
      inlineFeaturesTheme,
      EditorView.editorAttributes.of({ 'data-inline-features': 'true' }),
      EditorView.updateListener.of(() => {
        for (const render of renderers.values()) render()
      }),
    ],
  }),
})
const features = [
  {
    id: 'profile',
    start: 'profile =',
    end: '\nplate =',
    icon: 'sketch' as CustomIconName,
    detail: 'Sketch',
  },
  {
    id: 'plate',
    start: 'plate =',
    end: '\n\n// These',
    icon: 'extrude' as CustomIconName,
    detail: 'Extrude',
  },
].map((definition) => {
  const from = source.indexOf(definition.start)
  const to = source.indexOf(definition.end, from)
  const host = document.createElement('div')
  host.className = 'cm-inline-feature'
  const root = createRoot(host)
  renderers.set(definition.id, () => {
    const expanded = view.state
      .field(inlineFeaturesField)
      .expanded.has(definition.id)
    root.render(
      createElement(InlineOperationRow, {
        icon: definition.icon,
        label: definition.id,
        detail: definition.detail,
        onClick: () =>
          view.dispatch({
            effects: revealInlineFeature.of({
              id: definition.id,
              expanded: true,
            }),
          }),
        disclosure: {
          expanded,
          onToggle: () =>
            view.dispatch({
              effects: revealInlineFeature.of({
                id: definition.id,
                expanded: !expanded,
              }),
            }),
        },
      })
    )
  })
  return { id: definition.id, from, to, host, operations: [] }
})
const planes = document.createElement('div')
planes.className = 'cm-inline-planes'
const planesRoot = createRoot(planes)
planesRoot.render(
  createElement(
    'div',
    {},
    ...['Front plane|XZ', 'Top plane|XY', 'Side plane|YZ'].map((value) => {
      const [label, detail] = value.split('|')
      return createElement(InlineOperationRow, {
        key: detail,
        icon: 'plane',
        label,
        detail,
      })
    })
  )
)
view.dispatch({
  effects: [setInlineFeatures.of(features), setInlinePlanes.of(planes)],
})
document.querySelector<HTMLInputElement>('#theme')!.onchange = (event) => {
  document.body.classList.toggle(
    'dark',
    (event.target as HTMLInputElement).checked
  )
}
