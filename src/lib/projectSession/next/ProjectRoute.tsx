import { useSignals } from '@preact/signals-react/runtime'
import { useApp } from '@src/lib/boot'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { ProjectView } from '@src/lib/projectSession/next/ProjectView'

/** Connect the experimental route to its selected project session. */
export function ProjectRoute() {
  useSignals()
  const app = useApp()
  const session = app.registry.get(projectSessionService).currentSession.value
  return session ? <ProjectView session={session} /> : null
}
