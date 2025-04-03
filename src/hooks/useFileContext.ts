import { useContext } from 'react'

import { FileContext } from '@src/components/FileMachineProvider'

export const useFileContext = () => {
  return useContext(FileContext)
}
