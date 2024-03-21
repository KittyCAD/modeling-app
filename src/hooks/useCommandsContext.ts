import { CommandsContext } from 'components/CommandBar/CommandBarProvider'
import { useContext } from 'react'

export const useCommandsContext = () => {
  return useContext(CommandsContext)
}
