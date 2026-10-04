import { useSignals } from '@preact/signals-react/runtime'
import Loading from '@src/components/Loading'
import { useApp } from '@src/lib/boot'
import { projectSession } from '@src/registry/contracts/projectSession'
import { appNavigationService } from '@src/registry/contracts/appNavigation'
import { showHomeIntent } from '@src/registry/contracts/homeProjects'
import { reportRejection } from '@src/lib/trap'
import type { PropsWithChildren } from 'react'
import { useParams } from 'react-router-dom'

/** Presentation only: the project navigation intent owns loading and access. */
export function CloudProjectPage({ children }: PropsWithChildren) {
  useSignals()
  const app = useApp()
  const { id } = useParams()
  const session = app.registry.get(projectSession)
  const error = session.cloudOpenError.value
  if (error && error.projectId === id) {
    return (
      <main className="h-screen grid place-content-center gap-4 p-8">
        <h1>Unable to open project</h1>
        <p role="alert">{error.message}</p>
        <button
          type="button"
          onClick={() => {
            void app.registry
              .get(appNavigationService)
              .dispatch(showHomeIntent, {})
              .catch(reportRejection)
          }}
        >
          Back to projects
        </button>
      </main>
    )
  }
  if (app.project?.projectIORefSignal.value.cloudSource?.id !== id) {
    return <Loading className="h-screen">Opening project...</Loading>
  }
  return children
}
