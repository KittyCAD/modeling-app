import { createContext, useContext, useEffect, useState } from 'react'
import { type IndexLoaderData } from 'lib/types'
import { useLoaderData } from 'react-router-dom'
import { codeManager, kclManager } from 'lib/singletons'
import { Diagnostic } from '@codemirror/lint'
import { KCLError } from './errors'

const KclContext = createContext({
  code: codeManager?.code || '',
  variables: kclManager?.variables,
  ast: kclManager?.ast,
  isExecuting: kclManager?.isExecuting,
  diagnostics: kclManager?.diagnostics,
  logs: kclManager?.logs,
  errors: kclManager?.errors,
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

  const [variables, setVariables] = useState(kclManager.variables)
  const [ast, setAst] = useState(kclManager.ast)
  const [isExecuting, setIsExecuting] = useState(false)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [errors, setErrors] = useState<KCLError[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [wasmInitFailed, setWasmInitFailed] = useState(false)

  useEffect(() => {
    codeManager.registerCallBacks({
      setCode,
    })
    kclManager.registerCallBacks({
      setVariables,
      setAst,
      setLogs,
      setErrors,
      setDiagnostics,
      setIsExecuting,
      setWasmInitFailed,
    })
  }, [])

  return (
    <KclContext.Provider
      value={{
        code,
        variables,
        ast,
        isExecuting,
        diagnostics,
        logs,
        errors,
        wasmInitFailed,
      }}
    >
      {children}
    </KclContext.Provider>
  )
}
