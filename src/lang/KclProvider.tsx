import { KCLError } from './errors'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { type IndexLoaderData } from 'lib/types'
import { useLoaderData } from 'react-router-dom'
import { codeManager, kclManager } from 'lib/singletons'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { Command } from 'lib/commandTypes'
import { isDesktop } from 'lib/isDesktop'
import kclSampleNames from 'lib/kclSamplesArray.json'

const KclContext = createContext({
  code: codeManager?.code || '',
  programMemory: kclManager?.programMemory,
  ast: kclManager?.ast,
  isExecuting: kclManager?.isExecuting,
  errors: kclManager?.kclErrors,
  logs: kclManager?.logs,
  wasmInitFailed: kclManager?.wasmInitFailed,
})

export function useKclContext() {
  return useContext(KclContext)
}

export function KclContextProvider({
  children,
}: {
  children: React.ReactNode
}) {
  // If we try to use this component anywhere but under the paths.FILE route it will fail
  // Because useLoaderData assumes we are on within it's context.
  const { code: loadedCode } = useLoaderData() as IndexLoaderData
  // Both the code state and the editor state start off with the same code.
  const [code, setCode] = useState(loadedCode || codeManager.code)

  const [programMemory, setProgramMemory] = useState(kclManager.programMemory)
  const [ast, setAst] = useState(kclManager.ast)
  const [isExecuting, setIsExecuting] = useState(false)
  const [errors, setErrors] = useState<KCLError[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [wasmInitFailed, setWasmInitFailed] = useState(false)
  const { commandBarSend } = useCommandsContext()

  const kclCommands = useMemo<Command[]>(
    () => [
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
          argumentsToSubmit.method === 'newFile' ? (
            'Create a new file with the example code?'
          ) : (
            <>
              <p className="font-bold text-destroy-60">
                Overwrite current file?
              </p>
              <p>
                This will permanently replace the current code in the editor.
              </p>
            </>
          ),
        groupId: 'code',
        icon: 'code',
        onSubmit(data) {
          if (!data?.sample) {
            return
          }
          const sampleCodeUrl = `https://raw.githubusercontent.com/KittyCAD/kcl-samples/main/${data.sample}/${data.sample}.kcl`
          fetch(sampleCodeUrl)
            .then(async (response) => {
              if (!response.ok) {
                console.error(
                  'Failed to fetch sample code:',
                  response.statusText
                )
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
    ],
    []
  )

  useEffect(() => {
    codeManager.registerCallBacks({
      setCode,
    })
    kclManager.registerCallBacks({
      setProgramMemory,
      setAst,
      setLogs,
      setKclErrors: setErrors,
      setIsExecuting,
      setWasmInitFailed,
    })
  }, [])

  // Add format code to command palette.
  useEffect(() => {
    commandBarSend({ type: 'Add commands', data: { commands: kclCommands } })

    return () => {
      commandBarSend({
        type: 'Remove commands',
        data: { commands: kclCommands },
      })
    }
  }, [kclManager, commandBarSend])

  return (
    <KclContext.Provider
      value={{
        code,
        programMemory,
        ast,
        isExecuting,
        errors,
        logs,
        wasmInitFailed,
      }}
    >
      {children}
    </KclContext.Provider>
  )
}
