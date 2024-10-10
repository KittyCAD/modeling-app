import { createActorContext } from '@xstate/react'
import { editorManager } from 'lib/singletons'
import { commandBarMachine } from 'machines/commandBarMachine'
import { useEffect } from 'react'
import { createRouteCommands } from 'lib/commandBarConfigs/routeCommandConfig'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAbsoluteFilePath } from 'hooks/useAbsoluteFilePath'
import { PATHS } from 'lib/paths'

export const CommandsContext = createActorContext(
  commandBarMachine.provide({
    guards: {
      'Command has no arguments': ({ context }) => {
        return (
          !context.selectedCommand?.args ||
          Object.keys(context.selectedCommand?.args).length === 0
        )
      },
      'All arguments are skippable': ({ context }) => {
        return Object.values(context.selectedCommand!.args!).every(
          (argConfig) => argConfig.skip
        )
      },
    },
  })
)

export const CommandBarProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  return (
    <CommandsContext.Provider>
      <CommandBarProviderInner>{children}</CommandBarProviderInner>
    </CommandsContext.Provider>
  )
}
function CommandBarProviderInner({ children }: { children: React.ReactNode }) {
  const commandBarActor = CommandsContext.useActorRef()
  const location = useLocation()
  const filePath = useAbsoluteFilePath()
  const navigate = useNavigate()

  useEffect(() => {
    const { RouteTelemetryCommand, RouteHomeCommand, RouteSettingsCommand } =
      createRouteCommands(navigate, location, filePath)
    commandBarActor.send({
      type: 'Remove commands',
      data: {
        commands: [
          RouteTelemetryCommand,
          RouteHomeCommand,
          RouteSettingsCommand,
        ],
      },
    })
    if (location.pathname === PATHS.HOME) {
      commandBarActor.send({
        type: 'Add commands',
        data: { commands: [RouteTelemetryCommand, RouteSettingsCommand] },
      })
    } else if (location.pathname.includes(PATHS.FILE)) {
      commandBarActor.send({
        type: 'Add commands',
        data: {
          commands: [
            RouteTelemetryCommand,
            RouteSettingsCommand,
            RouteHomeCommand,
          ],
        },
      })
    }
  }, [location])

  useEffect(() => {
    editorManager.setCommandBarSend(commandBarActor.send)
  })

  return children
}
