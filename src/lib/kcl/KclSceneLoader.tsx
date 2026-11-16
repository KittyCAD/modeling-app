import { lazy, Suspense } from 'react'
import type { ModelingViewRuntime } from '@src/lib/kcl/registry/contract'

const Scene = lazy(() =>
  import('@src/lib/kcl/KclScene').then(({ KclScene }) => ({
    default: KclScene,
  }))
)

/** Registry discovery must not initialize the legacy renderer/tool graph before App is constructed. */
export function KclSceneLoader(props: { context: ModelingViewRuntime }) {
  return (
    <Suspense fallback={null}>
      <Scene {...props} />
    </Suspense>
  )
}
