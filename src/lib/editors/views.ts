import { createElement, type ComponentType } from 'react'
import type {
  EditorViewContribution,
  EditorViewHost,
  EditorViewProps,
  EditorSurfaceProps,
  EditorViewMetadata,
} from '@src/lib/editors/registry/contract'

type PlainMode = EditorViewMetadata & {
  Component: ComponentType<EditorSurfaceProps>
}
type ContextualMode<C> = EditorViewMetadata & {
  Component: ComponentType<EditorViewProps<C>>
}

/** Capture the provider's context type before inferring component props, then package both together. */
export function defineEditorView<C>(
  provider: (host: EditorViewHost) => C
): (definition: ContextualMode<C>) => EditorViewContribution
export function defineEditorView(definition: PlainMode): EditorViewContribution
export function defineEditorView<C>(
  input: PlainMode | ((host: EditorViewHost) => C)
):
  | EditorViewContribution
  | ((definition: ContextualMode<C>) => EditorViewContribution) {
  if (typeof input === 'function') {
    return ({ Component, ...metadata }) => ({
      ...metadata,
      bind: (host) => {
        const context = input(host)
        return function BoundEditorMode(props) {
          return createElement(Component, { ...props, context })
        }
      },
    })
  }
  const { Component, ...metadata } = input
  return { ...metadata, bind: () => Component }
}
