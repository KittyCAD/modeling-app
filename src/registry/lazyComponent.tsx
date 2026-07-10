import type { ComponentType, ReactNode } from 'react'
import { Suspense, createElement, lazy, useMemo } from 'react'

export type RegistryComponentLoader<Props extends object> = () => Promise<
  ComponentType<Props>
>

/**
 * Current registry UI contributions use the React-component adapter below
 * because ZDS itself renders with React. This should not become a permanent
 * requirement for user-authored extension UI.
 *
 * The longer-term contract should be a framework-neutral "renderable" union
 * where React is one adapter, not the semantic boundary:
 *
 * ```ts
 * type RegistryRenderable<Props> =
 *   | {
 *       kind: 'react-component'
 *       loadComponent: () => Promise<ComponentType<Props>>
 *     }
 *   | {
 *       kind: 'dom'
 *       mount: (
 *         container: HTMLElement,
 *         props: ReadonlySignal<Props>
 *       ) => void | (() => void)
 *     }
 * ```
 *
 * The `dom` arm is not just an escape hatch. It is the shape that would let a
 * Vue, Svelte, or plain-DOM extension own its rendering and cleanup while the
 * host owns placement and passes signal-backed reactive state across the
 * boundary. When adding new extension UI surfaces, prefer renderer-owned
 * adapters like this over requiring every extension to export React components.
 */
export type LazyRegistryComponentSpec<Props extends object> = {
  loadComponent: RegistryComponentLoader<Props>
  componentProps?: Props
  fallback?: ReactNode
}

export type ErasedLazyRegistryComponentSpec = LazyRegistryComponentSpec<object>

export function defineLazyRegistryComponent<Props extends object>(
  spec: LazyRegistryComponentSpec<Props>
): ErasedLazyRegistryComponentSpec {
  return spec as unknown as ErasedLazyRegistryComponentSpec
}

export function LazyRegistryComponent<Props extends object>({
  loadComponent,
  componentProps,
  fallback = null,
}: LazyRegistryComponentSpec<Props>) {
  const Component = useMemo(
    () =>
      lazy(async () => ({
        default: await loadComponent(),
      })),
    [loadComponent]
  )

  return createElement(
    Suspense,
    { fallback },
    createElement(Component, componentProps ?? ({} as Props))
  )
}
