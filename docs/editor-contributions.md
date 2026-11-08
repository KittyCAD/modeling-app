# Editor classification and mode ownership

An editor owns a text buffer. Its `src` is optional and describes its storage location;
its `classification` describes a language and, where known, a media type. A filename
extension is a matching shorthand, not a language identity or a MIME type.

## Classify before installing behavior

Contribute descriptors through `editorLanguageValueSpec`. These match only source
snapshots (`src` and `contents`), so classification never depends on the CodeMirror
extensions that matching installs. For example:

```ts
provide(editorLanguageValueSpec, {
  id: 'markdown',
  matches: '.md',
  mediaType: 'text/markdown',
})
```

The highest `priority` wins; ties follow registration order. Missing classifications
remain `undefined`. KCL has the language ID `kcl` without an invented media type.
Descriptors can use pure, inexpensive path/content predicates to recognize formats
without a conventional filename.

Editor capabilities and views receive `languageId` and `mediaType` alongside `src`
and `contents`. Match a language when behavior should also work on unnamed buffers:

```ts
matches: ({ languageId }) => languageId === 'markdown'
```

`'.md'` continues to mean the source's case-insensitive filename extension, even if
the user explicitly selects another language. `'*'` matches every buffer.

## Explicit language choice

```ts
const editor = editors.createEditor('# Draft')
editors.setLanguage(editor.id, 'markdown')
// Later, resume inference from the current source and contents:
editors.setLanguage(editor.id, undefined)
```

The language must be registered; an unknown ID returns an `Error` without changing
the choice. The choice survives renames. If its descriptor is withdrawn, inference
resumes until that descriptor returns or the choice is cleared. Reclassification
updates matching behavior and modes without replacing the buffer, selection, or
undo history. No file is created by choosing a language.

## Context providers own resources, not other buffers

Mode providers receive the bound editor and `onDispose`. Acquire watchers, executor
leases, and similar resources there; release them with `onDispose`. Opening or closing
buffers, renaming them, and changing language/mode choices belong in commands or
explicit UI actions.

The editors service rejects these operations synchronously during provider setup
and registered cleanup. Setup failures appear as mode errors; cleanup failures are
reported while remaining callbacks continue. Project/service shutdown still releases
all owned resources. This prevents recursive opens and cleanup that discards another
buffer through this service.

This is a lifecycle boundary, not a sandbox. An extension can capture other services,
schedule later work, or mutate the CodeMirror document. Keep user-visible buffer
management out of those callbacks as well. Disposal is idempotent, runs in reverse
registration order, and removes callback references from the owner before invocation.

## Appearance

The common editing capability installs `editorAppearance()` from
`src/editor/plugins/theme/appearance.ts`. Each CodeMirror view follows the app's
light/dark theme even while its React component is unmounted; destroying the
view releases its theme observer. The KCL and Markdown contributions select syntax
palettes for that theme. `src/index.css` shares editor styles between the legacy
`#code-mirror-override` wrapper and the new `.code-mirror-override` instances.
