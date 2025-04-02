import { useContext } from 'react'

import { ModelingMachineContext } from '@src/components/ModelingMachineProvider'

export const useModelingContext = () => {
  return useContext(ModelingMachineContext)
}
