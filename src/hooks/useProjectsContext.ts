import { useContext } from 'react'

import { ProjectsMachineContext } from '@src/components/ProjectsContextProvider'

export const useProjectsContext = () => {
  return useContext(ProjectsMachineContext)
}
