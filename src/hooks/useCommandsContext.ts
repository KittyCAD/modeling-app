import { CommandsContext } from 'components/CommandBar/CommandBar'
import { useContext } from 'react'

export const useCommandsContext = () => {
  return useContext(CommandsContext)
}
