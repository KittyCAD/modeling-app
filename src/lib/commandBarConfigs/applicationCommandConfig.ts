import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import type { ActorRefFrom } from 'xstate'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { isDesktop } from '@src/lib/isDesktop'

export function createApplicationCommands({
  systemIOActor,
}: { systemIOActor: ActorRefFrom<typeof systemIOMachine> }) {
  const textToCADCommand: Command = {
    name: 'Text-to-CAD',
    description: 'Use the Zoo Text-to-CAD API to generate part starters.',
    displayName: `Text to CAD`,
    groupId: 'application',
    needsReview: false,
    icon: 'sparkles',
    onSubmit: (record) => {
      if (record) {
        const requestedProjectName = record.newProjectName || record.projectName
        const requestedPrompt = record.prompt
        const isProjectNew = !!record.newProjectName
        systemIOActor.send({
          type: SystemIOMachineEvents.generateTextToCAD,
          data: { requestedPrompt, requestedProjectName, isProjectNew },
        })
      }
    },
    args: {
      method: {
        inputType: 'options',
        required: true,
        skip: true,
        options: isDesktop()
          ? [
              { name: 'New project', value: 'newProject' },
              { name: 'Existing project', value: 'existingProject' },
            ]
          : [{ name: 'Overwrite', value: 'existingProject' }],
        valueSummary(value) {
          return isDesktop()
            ? value === 'newProject'
              ? 'New project'
              : 'Existing project'
            : 'Overwrite'
        },
      },
      projectName: {
        inputType: 'options',
        required: (commandsContext) =>
          isDesktop() &&
          commandsContext.argumentsToSubmit.method === 'existingProject',
        skip: true,
        options: (_, context) => {
          const { folders } = systemIOActor.getSnapshot().context
          const options: CommandArgumentOption<string>[] = []
          folders.forEach((folder) => {
            options.push({
              name: folder.name,
              value: folder.name,
              isCurrent: false,
            })
          })
          return options
        },
      },
      newProjectName: {
        inputType: 'text',
        required: (commandsContext) =>
          isDesktop() &&
          commandsContext.argumentsToSubmit.method === 'newProject',
        skip: true,
      },
      prompt: {
        inputType: 'text',
        required: true,
      },
    },
  }

  return isDesktop() ? [textToCADCommand]: []
}
