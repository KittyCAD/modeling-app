import { SystemIOMachineEvents } from '@src/machines/systemIO/events'

type HomeLoaderApp = {
  systemIOActor: {
    send: (event: {
      type: SystemIOMachineEvents.readFoldersFromProjectDirectory
    }) => void
  }
  closeProject: () => void
  settings: {
    actor: {
      send: (event: { type: 'clear.project' }) => void
    }
  }
}

export function loadHomeProjects(app: HomeLoaderApp) {
  app.systemIOActor.send({
    type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
  })
  app.closeProject()
  app.settings.actor.send({
    type: 'clear.project',
  })
  return {}
}
