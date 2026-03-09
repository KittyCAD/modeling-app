import type { Signal } from '@preact/signals-core'
import type { KclManager, ZDSProject } from '@src/lang/KclManager'
import { useSignals } from '@preact/signals-react/runtime'
import { useApp } from '@src/lib/boot'
import React from 'react'

const ProjectContext = React.createContext({} as ZDSProject)

/**
 * Context provider to get a guaranteed project within.
 */
export function ProjectProvider(props: React.PropsWithChildren) {
  const app = useApp()

  return app.project ? (
    <ProjectContext.Provider value={app.project} {...props} />
  ) : null
}

/**
 * Get a guaranteed project reference, if used below ProjectProvider
 */
export function useProject() {
  return React.useContext(ProjectContext)
}

const FileContext = React.createContext(
  {} as {
    path: Signal<string>
    editor: KclManager
  }
)

/**
 * Context provider to get a guaranteed executing editor within.
 */
export function ExecutingEditorProvider(props: React.PropsWithChildren) {
  useSignals()
  const project = useProject()

  return project.executingEditor.value && project.executingPathSignal.value ? (
    <FileContext.Provider
      value={{
        path: project.executingPathSignal.value,
        editor: project.executingEditor.value,
      }}
      {...props}
    />
  ) : null
}

/**
 * Get a guaranteed reference to an executing editor, if below ExecutingEditorProvider.
 */
export function useExecutingEditor() {
  return React.useContext(FileContext)
}
