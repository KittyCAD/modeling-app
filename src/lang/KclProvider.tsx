import type { Diagnostic } from '@codemirror/lint'
import { createContext, useContext, useEffect, useState } from 'react'
import { kclManager } from '@src/lib/singletons'
import type { KCLError } from '@src/lang/errors'

const KclContext = createContext({
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
  // Both the code state and the editor state start off with the same code.
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [errors, setErrors] = useState<KCLError[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [wasmInitFailed, setWasmInitFailed] = useState(false)

  useEffect(() => {
    kclManager.registerCallBacks({
      setLogs,
      setErrors,
      setDiagnostics,
      setWasmInitFailed,
    })
  }, [])

  return (
    <KclContext.Provider
      value={{
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
