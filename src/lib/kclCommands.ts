import { CommandBarOverwriteWarning } from 'components/CommandBarOverwriteWarning'
import { Command, CommandArgumentOption } from './commandTypes'
import { kclManager } from './singletons'
import { isDesktop } from './isDesktop'
import { FILE_EXT } from './constants'

interface OnSubmitProps {
  sampleName: string
  code: string
  method: 'overwrite' | 'newFile'
}

export function kclCommands(
  onSubmit: (p: OnSubmitProps) => Promise<void>,
  providedOptions: CommandArgumentOption<string>[]
): Command[] {
  return [
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
      icon: 'code',
      reviewMessage: ({ argumentsToSubmit }) =>
        argumentsToSubmit.method === 'newFile'
          ? 'Create a new file with the example code?'
          : CommandBarOverwriteWarning({}),
      groupId: 'code',
      onSubmit(data) {
        if (!data?.sample) {
          return
        }
        const sampleCodeUrl = `https://raw.githubusercontent.com/KittyCAD/kcl-samples/main/${encodeURIComponent(
          data.sample.replace(FILE_EXT, '')
        )}/${encodeURIComponent(data.sample)}`
        fetch(sampleCodeUrl)
          .then(async (response) => {
            if (!response.ok) {
              console.error('Failed to fetch sample code:', response.statusText)
              return
            }
            const code = await response.text()

            return {
              sampleName: data.sample,
              code,
              method: data.method,
            }
          })
          .then((props) => {
            if (props?.code) {
              onSubmit(props).catch(reportError)
            }
          })
          .catch(reportError)
      },
      args: {
        method: {
          inputType: 'options',
          required: true,
          skip: true,
          defaultValue: isDesktop() ? 'newFile' : 'overwrite',
          options() {
            return [
              {
                value: 'overwrite',
                name: 'Overwrite current code',
                isCurrent: !isDesktop(),
              },
              ...(isDesktop()
                ? [
                    {
                      value: 'newFile',
                      name: 'Create a new file',
                      isCurrent: true,
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
          options: providedOptions,
        },
      },
    },
  ]
}
