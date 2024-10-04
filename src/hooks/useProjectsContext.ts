import { ProjectsMachineContext } from 'components/ProjectsContextProvider'
import { useContext } from 'react'

export const useProjectsContext = () => {
  return useContext(ProjectsMachineContext)
}
