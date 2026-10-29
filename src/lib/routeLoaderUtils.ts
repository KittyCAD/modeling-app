import { reportRejection } from '@src/lib/trap'

type HomeLoaderApp = {
  refreshProjects: () => Promise<unknown>
  closeProject: () => void
  settings: {
    actor: {
      send: (event: { type: 'clear.project' }) => void
    }
  }
}

export function loadHomeProjects(app: HomeLoaderApp) {
  app.closeProject()
  app.refreshProjects().catch(reportRejection)
  app.settings.actor.send({
    type: 'clear.project',
  })
  return {}
}
