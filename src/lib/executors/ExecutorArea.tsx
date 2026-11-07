import { useApp } from '@src/lib/boot'
import { OPEN_EXECUTOR_COMMAND } from '@src/lib/executors/commands'
import { ExecutorView } from '@src/lib/executors/ExecutorView'
import {
  executorCapabilityValueSpec,
  executorsService,
  executorViewValueSpec,
} from '@src/lib/executors/registry/contract'

/** Bind the standalone layout area to registry services without legacy modeling providers. */
export function ExecutorArea() {
  const { registry, commands } = useApp()
  return (
    <ExecutorView
      executors={registry.get(executorsService)}
      capabilities={registry.signal(executorCapabilityValueSpec)}
      views={registry.signal(executorViewValueSpec)}
      onOpenExecutor={() =>
        commands.send({
          type: 'Find and select command',
          data: {
            name: OPEN_EXECUTOR_COMMAND.name,
            groupId: OPEN_EXECUTOR_COMMAND.groupId,
          },
        })
      }
    />
  )
}
