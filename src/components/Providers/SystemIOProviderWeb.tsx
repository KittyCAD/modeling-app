import { useEffect } from 'react'
import { commandBarActor } from '@src/machines/commandBarMachine'
import { importFileFromURL } from '@src/lib/commandBarConfigs/projectsCommandConfig'
export function SystemIOMachineLogicListenerWeb() {
  const useAddProjectCommandsToCommandBar = () => {
    const commands = [importFileFromURL]
    useEffect(() => {
      commandBarActor.send({
        type: 'Add commands',
        data: {
          commands: commands,
        },
      })
      return () => {
        commandBarActor.send({
          type: 'Remove commands',
          data: {
            commands: commands,
          },
        })
      }
    }, [])
  }

  useAddProjectCommandsToCommandBar()
  return null
}
