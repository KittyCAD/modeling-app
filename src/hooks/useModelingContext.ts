import { ModelingMachineContext } from 'components/ModelingMachineProvider'
import { useContext } from 'react'

export const useModelingContext = () => {
  return useContext(ModelingMachineContext)
}
