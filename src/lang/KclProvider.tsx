import { KCLError } from './errors'
import { createContext, useContext, useEffect, useState } from 'react'
import { type IndexLoaderData } from 'lib/types'
import { useLoaderData } from 'react-router-dom'
import { useParams } from 'react-router-dom'
import { kclManager } from 'lib/singletons'

const KclContext = createContext({
  code: kclManager.code,
  programMemory: kclManager.programMemory,
  ast: kclManager.ast,
  isExecuting: kclManager.isExecuting,
  errors: kclManager.kclErrors,
  logs: kclManager.logs,
  wasmInitFailed: kclManager.wasmInitFailed,
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
  const [code, setCode] = useState(loadedCode || kclManager.code)
  const [programMemory, setProgramMemory] = useState(kclManager.programMemory)
  const [ast, setAst] = useState(kclManager.ast)
  const [isExecuting, setIsExecuting] = useState(false)
  const [errors, setErrors] = useState<KCLError[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [wasmInitFailed, setWasmInitFailed] = useState(false)

  useEffect(() => {
    kclManager.registerCallBacks({
      setCode,
      setProgramMemory,
      setAst,
      setLogs,
      setKclErrors: setErrors,
      setIsExecuting,
      setWasmInitFailed,
    })
  }, [])

  const params = useParams()
  useEffect(() => {
    kclManager.setParams(params)
  }, [params])
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
