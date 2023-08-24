// This file was automatically generated. Edits will be overwritten

export interface Typegen0 {
  '@@xstate/typegen': true
  internalEvents: {
    'done.invoke.create-project': {
      type: 'done.invoke.create-project'
      data: unknown
      __tip: 'See the XState TS docs to learn how to strongly type this.'
    }
    'done.invoke.delete-project': {
      type: 'done.invoke.delete-project'
      data: unknown
      __tip: 'See the XState TS docs to learn how to strongly type this.'
    }
    'done.invoke.read-projects': {
      type: 'done.invoke.read-projects'
      data: unknown
      __tip: 'See the XState TS docs to learn how to strongly type this.'
    }
    'done.invoke.rename-project': {
      type: 'done.invoke.rename-project'
      data: unknown
      __tip: 'See the XState TS docs to learn how to strongly type this.'
    }
    'error.platform.create-project': {
      type: 'error.platform.create-project'
      data: unknown
    }
    'error.platform.delete-project': {
      type: 'error.platform.delete-project'
      data: unknown
    }
    'error.platform.read-projects': {
      type: 'error.platform.read-projects'
      data: unknown
    }
    'error.platform.rename-project': {
      type: 'error.platform.rename-project'
      data: unknown
    }
    'xstate.init': { type: 'xstate.init' }
  }
  invokeSrcNameMap: {
    createProject: 'done.invoke.create-project'
    deleteProject: 'done.invoke.delete-project'
    readProjects: 'done.invoke.read-projects'
    renameProject: 'done.invoke.rename-project'
  }
  missingImplementations: {
    actions: 'navigateToProject' | 'toastError' | 'toastSuccess'
    delays: never
    guards: 'Has at least 1 project'
    services:
      | 'createProject'
      | 'deleteProject'
      | 'readProjects'
      | 'renameProject'
  }
  eventsCausingActions: {
    navigateToProject: 'Open project'
    setProjects: 'done.invoke.read-projects'
    toastError:
      | 'error.platform.create-project'
      | 'error.platform.delete-project'
      | 'error.platform.read-projects'
      | 'error.platform.rename-project'
    toastSuccess:
      | 'done.invoke.create-project'
      | 'done.invoke.delete-project'
      | 'done.invoke.rename-project'
  }
  eventsCausingDelays: {}
  eventsCausingGuards: {
    'Has at least 1 project': 'done.invoke.read-projects'
  }
  eventsCausingServices: {
    createProject: 'Create project'
    deleteProject: 'Delete project'
    readProjects:
      | 'done.invoke.create-project'
      | 'done.invoke.delete-project'
      | 'done.invoke.rename-project'
      | 'error.platform.create-project'
      | 'error.platform.rename-project'
      | 'xstate.init'
    renameProject: 'Rename project'
  }
  matchesStates:
    | 'Creating project'
    | 'Deleting project'
    | 'Has no projects'
    | 'Has projects'
    | 'Opening project'
    | 'Reading projects'
    | 'Renaming project'
  tags: never
}
