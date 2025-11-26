import { createContext, useContext, useEffect, useState } from 'react'
import { kclManager } from '@src/lib/singletons'

const KclContext = createContext({
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
  const [wasmInitFailed, setWasmInitFailed] = useState(false)

  useEffect(() => {
    kclManager.registerCallBacks({
      setWasmInitFailed,
    })
  }, [])

  return (
    <KclContext.Provider
      value={{
        wasmInitFailed,
      }}
    >
      {children}
    </KclContext.Provider>
  )
}
