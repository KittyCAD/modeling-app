import { useContext } from 'react'

import { ModelingMachineContext } from '@src/machines/modelingMachineContext'

export const useModelingContext = () => {
  return useContext(ModelingMachineContext)
}
