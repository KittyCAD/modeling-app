import { signal } from '@preact/signals-core'
import {
  type CapabilityOf,
  contract,
  contribute,
  Facet,
  type InputOf,
  provide,
  type Scope,
  type Source,
  type Subtree,
  service,
  slot,
} from '../algebra'
import { Reconciler } from '../reconciler'

/** View templates and CodeMirror extensions can replace strings in this example. */
export const editor = contract({
  panels: new Facet('editor.panels', (panels: readonly string[]) => panels),
  title: new Facet('editor.title', (titles: readonly string[]) =>
    titles.length ? titles[0] : 'Untitled'
  ),
  document: service<{
    readonly text: Source<string>
    replace(text: string): void
  }>('editor.document'),
})

export type Document = CapabilityOf<typeof editor.document>
export type Panel = InputOf<typeof editor.panels>

/** Each mounted instance owns its state; the interpreter supplies provenance. */
export const documentSubtree = {
  create: () => {
    const text = signal('Hello')
    const document: Document = {
      text: () => text.value,
      replace: (next) => {
        text.value = next
      },
    }
    return { items: [provide(editor.document, document)] }
  },
} satisfies Subtree

export const titleSubtree = {
  dependencies: [documentSubtree],
  create: (scope) => ({
    items: [
      contribute(editor.title, () => scope.required(editor.document).text()),
    ],
  }),
} satisfies Subtree

export const panels = slot([
  contribute(editor.panels, () => 'outline'),
  contribute(editor.panels, () => 'properties'),
])

/** External reconfiguration replaces panels while retaining the document owner. */
export const workspace = {
  dependencies: [documentSubtree],
  create: () => ({ items: [titleSubtree, panels] }),
} satisfies Subtree

export function showSearchPanel(scope: Scope): Promise<void> {
  return scope.replace(panels, [contribute(editor.panels, () => 'search')])
}

export async function mountWorkspace(): Promise<Reconciler> {
  const reconciler = new Reconciler()
  await reconciler.configure([workspace])
  return reconciler
}
