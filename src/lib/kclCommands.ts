import { CommandBarOverwriteWarning } from 'components/CommandBarOverwriteWarning'
import { Command } from './commandTypes'
import { codeManager, kclManager } from './singletons'
import { isDesktop } from './isDesktop'
import kclSampleNames from 'lib/kclSamplesArray.json'

export const kclCommands: Command[] = [
  {
    name: 'format-code',
    displayName: 'Format Code',
    description: 'Nicely formats the KCL code in the editor.',
    needsReview: false,
    groupId: 'code',
    icon: 'code',
    onSubmit: () => {
      kclManager.format()
    },
  },
  {
    name: 'open-kcl-example',
    displayName: 'Open sample',
    description: 'Imports an example KCL program into the editor.',
    needsReview: true,
    reviewMessage: ({ argumentsToSubmit }) =>
      argumentsToSubmit.method === 'newFile'
        ? 'Create a new file with the example code?'
        : CommandBarOverwriteWarning({}),
    groupId: 'code',
    onSubmit(data) {
      if (!data?.sample) {
        return
      }
      const sampleCodeUrl = `https://raw.githubusercontent.com/KittyCAD/kcl-samples/main/${data.sample}/${data.sample}.kcl`
      fetch(sampleCodeUrl)
        .then(async (response) => {
          if (!response.ok) {
            console.error('Failed to fetch sample code:', response.statusText)
            return
          }
          const code = await response.text()

          if (data.method === 'overwrite') {
            codeManager.updateCodeStateEditor(code)
            await kclManager.executeCode(true)
            await codeManager.writeToFile()
          } else if (data.method === 'newFile' && isDesktop()) {
            // TODO: The issue is that FileMachineProvider is nested further down
            // than this component, so we can't access the fileMachineSend function
          }
        })
        .catch(reportError)
    },
    args: {
      method: {
        inputType: 'options',
        required: true,
        skip: true,
        defaultValue() {
          return isDesktop() ? 'newFile' : 'overwrite'
        },
        options() {
          return [
            {
              value: 'overwrite',
              name: 'Overwrite current code',
            },
            ...(isDesktop()
              ? [
                  {
                    value: 'newFile',
                    name: 'Create a new file',
                  },
                ]
              : []),
          ]
        },
      },
      sample: {
        inputType: 'options',
        required: true,
        valueSummary(value) {
          const MAX_LENGTH = 12
          if (typeof value === 'string') {
            return value.length > MAX_LENGTH
              ? value.substring(0, MAX_LENGTH) + '...'
              : value
          }
          return value
        },
        options() {
          return kclSampleNames.map((sampleName) => ({
            value: sampleName,
            name: sampleName,
          }))
        },
      },
    },
  },
]
