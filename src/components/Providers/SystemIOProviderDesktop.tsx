import { PATHS } from '@src/lib/paths'
import { systemIOActor } from '@src/machines/appMachine'
import { useSelector } from '@xstate/react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  NO_PROJECT_DIRECTORY,
} from '@src/machines/systemIO/utils'
export const useAuthState = () => useSelector(systemIOActor, (state) => state)


export function SystemIOMachineLogicListener() {
  const state = useAuthState()
  useEffect(() => {
    /* const requestedPath = `${PATHS.FILE}/${encodeURIComponent(
     *  requestedProjectName
       )}`
     *       navigate(requestedPath) */
    console.log(state)
  }, [state])
  return null
}
