import { useSignals } from '@preact/signals-react/runtime'
import { AppHeaderFrame } from '@src/components/AppHeaderFrame'
import { Spinner } from '@src/components/Spinner'
import { useApp } from '@src/lib/boot'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { ProjectView } from '@src/lib/projectSession/next/ProjectView'

/** Connect the experimental route to its selected project session. */
export function ProjectRoute() {
  useSignals()
  const app = useApp()
  const session = app.registry.optional(projectSessionService)?.currentSession
    .value
  if (session) return <ProjectView session={session} />

  // Home's loader closes the session before the router commits its destination.
  // Keep chrome visible during that gap without rendering disposed project views.
  return (
    <div className="flex h-screen flex-col bg-default text-default">
      <AppHeaderFrame context={{ type: 'home' }} />
      <div
        role="status"
        className="flex flex-1 items-center justify-center gap-2"
      >
        <Spinner aria-hidden="true" className="h-5 w-5" />
        <span>Loading Design Studio...</span>
      </div>
    </div>
  )
}
