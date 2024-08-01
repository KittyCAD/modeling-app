import { InteractionMapMachineContext } from 'components/InteractionMapMachineProvider'
import { useContext } from 'react'

export const useInteractionMapContext = () => {
  return useContext(InteractionMapMachineContext)
}
