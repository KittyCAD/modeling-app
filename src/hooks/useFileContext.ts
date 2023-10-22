import { FileContext } from 'components/FileMachineProvider'
import { useContext } from 'react'

export const useFileContext = () => {
  return useContext(FileContext)
}
