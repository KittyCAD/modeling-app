import { reportRejection } from '@src/lib/trap'

type HomeLoaderApp = {
  fileWorkflows: { readFoldersFromProjectDirectory: () => Promise<unknown> }
  closeProject: () => void
  settings: {
    actor: {
      send: (event: { type: 'clear.project' }) => void
    }
  }
}

export function loadHomeProjects(app: HomeLoaderApp) {
  app.fileWorkflows.readFoldersFromProjectDirectory().catch(reportRejection)
  app.closeProject()
  app.settings.actor.send({
    type: 'clear.project',
  })
  return {}
}
