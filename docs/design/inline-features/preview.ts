import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import {
  inlineFeaturesField,
  inlineFeaturesTheme,
  revealInlineFeature,
  setInlineFeatures,
} from '../../../src/editor/plugins/inlineFeatures'

// This fixture exercises the production CodeMirror extension without WASM,
// engine credentials, or an active modeling session. Controls are illustrative.
const source = `@settings(defaultLengthUnit = mm, kclVersion = 3.0)

thickness = 8

// Plate profile
profile = sketch(on = XY) {
  circle1 = circle(center = [0, 0], radius = 40)
}
plate = extrude(profile, length = thickness)

// These values stay visible and editable
holeDiameter = 6
edgeRadius = 2

// Finishing operations
holes = sketch(on = XY) {
  circle2 = circle(center = [20, 0], radius = holeDiameter / 2)
}
cut = extrude(holes, length = -thickness)
`
const definitions = [
  {
    name: 'profile',
    label: 'Sketch',
    icon: '◇',
    start: 'profile =',
    end: '\nplate =',
  },
  {
    name: 'plate',
    label: 'Extrude',
    icon: '⬡',
    start: 'plate =',
    end: '\n\n// These',
  },
  {
    name: 'holes',
    label: 'Sketch',
    icon: '◇',
    start: 'holes =',
    end: '\ncut =',
  },
  { name: 'cut', label: 'Extrude', icon: '⬡', start: 'cut =', end: '\n' },
]
const theme = new Compartment()
const view = new EditorView({
  parent: document.querySelector('#editor')!,
  state: EditorState.create({
    doc: source,
    extensions: [
      lineNumbers(),
      history(),
      theme.of(EditorView.theme({})),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      inlineFeaturesField,
      inlineFeaturesTheme,
      EditorView.updateListener.of((update) => {
        const state = update.state.field(inlineFeaturesField)
        for (const feature of state.features) {
          const button = feature.host.querySelector<HTMLButtonElement>(
            '.cm-inline-feature-code-toggle'
          )!
          button.textContent = state.expanded.has(feature.id)
            ? '⌃ Hide code'
            : '‹ › Show code'
          button.setAttribute(
            'aria-expanded',
            String(state.expanded.has(feature.id))
          )
        }
        if (update.docChanged)
          document.querySelector('#status')!.textContent =
            'Code changed · feature ranges cleared until the next execution'
      }),
    ],
  }),
})
const features = definitions.map((definition) => {
  const from = source.indexOf(definition.start)
  const to = source.indexOf(definition.end, from)
  const id = definition.name
  const host = document.createElement('div')
  host.className = 'cm-inline-feature'
  host.dataset.featureId = id
  const row = document.createElement('button')
  row.type = 'button'
  row.className = 'feature-row'
  row.innerHTML = `<span class="feature-icon">${definition.icon}</span><span class="feature-name">${definition.name}</span><span class="feature-type">${definition.label}</span><span class="feature-more">···</span>`
  row.onclick = () =>
    view.dispatch({ effects: revealInlineFeature.of({ id, expanded: true }) })
  row.ondblclick = () => {
    document.querySelector('#edit-title')!.textContent =
      `Edit ${definition.name}`
    document.querySelector<HTMLDialogElement>('#edit')!.showModal()
  }
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'cm-inline-feature-code-toggle'
  toggle.textContent = '‹ › Show code'
  toggle.onclick = () =>
    view.dispatch({
      effects: revealInlineFeature.of({
        id,
        expanded: !view.state.field(inlineFeaturesField).expanded.has(id),
      }),
    })
  host.append(row, toggle)
  return { id, from, to, operations: [], host }
})
view.dispatch({ effects: setInlineFeatures.of(features) })
document.querySelector<HTMLInputElement>('#separate')!.onchange = (event) => {
  const separate = (event.target as HTMLInputElement).checked
  view.dispatch({
    effects: setInlineFeatures.of(
      separate ? [] : view.state.doc.toString() === source ? features : []
    ),
  })
  const tree = document.querySelector<HTMLElement>('#tree')!
  tree.replaceChildren()
  if (separate)
    for (const feature of features) {
      const clone = feature.host.cloneNode(true) as HTMLElement
      clone.querySelector('.cm-inline-feature-code-toggle')?.remove()
      tree.append(clone)
    }
  tree.style.display = separate ? 'block' : 'none'
  document.querySelector('#title')!.textContent = separate
    ? 'Feature Tree / Code Editor'
    : 'Features & Code'
}
document.querySelector<HTMLButtonElement>('#theme')!.onclick = (event) => {
  const dark = document.body.classList.toggle('dark')
  view.dispatch({ effects: theme.reconfigure(EditorView.theme({}, { dark })) })
  ;(event.target as HTMLButtonElement).textContent = dark
    ? 'Light theme'
    : 'Dark theme'
}
