import { signal } from '@preact/signals-core'
import {
  type CapabilityOf,
  contract,
  contribute,
  Facet,
  type InputOf,
  provide,
  type Signal,
  extension,
  service,
  slot,
} from '../algebra'
import { createPlugin, plugins } from '../plugins'
import { Registry } from '../nextRegistry'

/** A view can render these descriptions; the document model owns editing. */
export interface Panel {
  readonly id: string
  readonly title: string
  readonly content: string
}

/** Providers and views share these tokens, including across separate registries. */
export const editor = contract({
  panels: new Facet('editor.panels', (panels: readonly Panel[]) => panels),
  title: new Facet('editor.title', (titles: readonly string[]) =>
    titles.length ? titles[0] : 'Untitled'
  ),
  document: service<{
    readonly text: Signal<string>
    replace(text: string): void
  }>('editor.document'),
})

export type DocumentModel = CapabilityOf<typeof editor.document>
export type PanelContribution = InputOf<typeof editor.panels>

/** Each registry acquires its own document; replacing panels retains this state. */
const documentOwner = extension({
  create: () => {
    const text = signal('# Welcome\nStart writing.')
    const document: DocumentModel = {
      text,
      replace: (next) => {
        text.value = next
      },
    }
    return {
      exports: { document },
      items: [provide(editor.document, document)],
    }
  },
})

const documentTitle = extension({
  dependencies: { state: documentOwner },
  create: ({ state: { document } }) => ({
    // `contribute` registers this read; the registry evaluates it after acquisition.
    items: [
      contribute(
        editor.title,
        () =>
          document.text.value.split('\n')[0].replace(/^# /, '') || 'Untitled'
      ),
    ],
  }),
})

/** `Registry.replace(sidebar, items)` swaps panels without replacing the document. */
export const sidebar = slot([
  contribute(editor.panels, () => ({
    id: 'help',
    title: 'Help',
    content: 'Use # headings to give the document an outline.',
  })),
])

export const workspace = extension({
  dependencies: { state: documentOwner },
  create: () => ({ items: [documentTitle, sidebar] }),
})

/** Disabling the plugin removes its panel; `documentOwner` remains in `workspace`. */
export const outlinePlugin = createPlugin({
  id: 'outline',
  title: 'Document outline',
  description: 'Lists level-one headings from the current document.',
  items: [
    extension({
      // The title and outline share one document, despite declaring it separately.
      dependencies: { state: documentOwner },
      create: ({ state: { document } }) => ({
        items: [
          contribute(editor.panels, () => ({
            id: 'outline',
            title: 'Outline',
            // Reading `text.value` makes the panel update when the document changes.
            content: document.text.value
              .split('\n')
              .filter((line) => line.startsWith('# '))
              .map((line) => line.slice(2))
              .join('\n'),
          })),
        ],
      }),
    }),
  ],
})

/** The caller owns the registry and awaits `dispose()` when the workspace closes. */
export async function openWorkspace(): Promise<Registry> {
  const registry = new Registry()
  await registry.configure([workspace, outlinePlugin])
  return registry
}

/** Run without a UI; a view could read `title.value` and `panels.value` instead. */
export async function runWorkspaceExample(): Promise<void> {
  const registry = await openWorkspace()
  try {
    const document = registry.required(editor.document)
    const title = registry.observe(editor.title)
    const panels = registry.observe(editor.panels)
    document.replace('# Scene\nDraw something.')
    console.log(title.value, panels.value)

    // `outlinePlugin` is the only plugin installed by `openWorkspace`.
    const [outline] = registry.get(plugins)
    const controller = registry.required(outline.service)
    await controller.disable()
    await registry.replace(sidebar, [
      contribute(editor.panels, () => ({
        id: 'search',
        title: 'Search',
        content: 'Find constraints',
      })),
    ])

    // The original `document` still accepts edits while its panels are absent.
    // Enabling the outline reads those edits rather than recreating the document.
    document.replace('# Scene\n# Constraints\nKeep drawing.')
    await controller.enable()
    console.log(title.value, panels.value)
  } finally {
    await registry.dispose()
  }
}
