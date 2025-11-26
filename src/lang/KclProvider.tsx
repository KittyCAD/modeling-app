import { createContext, useContext, useEffect, useState } from 'react'
import { kclManager } from '@src/lib/singletons'
import type { KCLError } from '@src/lang/errors'

const KclContext = createContext({
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
  const [errors, setErrors] = useState<KCLError[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [wasmInitFailed, setWasmInitFailed] = useState(false)

  useEffect(() => {
    kclManager.registerCallBacks({
      setLogs,
      setErrors,
      setWasmInitFailed,
    })
  }, [])

  return (
    <KclContext.Provider
      value={{
        logs,
        errors,
        wasmInitFailed,
      }}
    >
      {children}
    </KclContext.Provider>
  )
}
