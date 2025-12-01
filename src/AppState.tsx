import type { ReactNode } from 'react'
import { createContext, useContext, useRef, useState } from 'react'

/*

This is for a very small handful of global state we need that doesn't fit into
any of the Xstate machines.
Please do not fill this up with junk.

*/

interface AppState {
  isStreamReady: boolean
  isStreamAcceptingInput: boolean
  setAppState: (newAppState: Partial<AppState>) => void
}

const AppStateContext = createContext<AppState>({
  isStreamReady: false,
  isStreamAcceptingInput: false,
  setAppState: () => {},
})

export const useAppState = () => useContext(AppStateContext)

export const AppStateProvider = ({ children }: { children: ReactNode }) => {
  const [appState, _setAppState] = useState<AppState>({
    isStreamReady: false,
    isStreamAcceptingInput: false,
    setAppState: () => {},
  })
  const appStateRef = useRef(appState)
  const setAppState = (newAppState: Partial<AppState>) => {
    // Gotcha: closure issue since this is a callback function
    const result = { ...appStateRef.current, ...newAppState }
    _setAppState(result)
    appStateRef.current = result
  }

  return (
    <AppStateContext.Provider
      value={{
        isStreamReady: appState.isStreamReady,
        isStreamAcceptingInput: appState.isStreamAcceptingInput,
        setAppState,
      }}
    >
      {children}
    </AppStateContext.Provider>
  )
}

interface AppStream {
  mediaStream: MediaStream
  setMediaStream: (mediaStream: MediaStream) => void
}

const AppStreamContext = createContext<AppStream>({
  mediaStream: undefined as unknown as MediaStream,
  setMediaStream: () => {},
})

export const AppStreamProvider = ({ children }: { children: ReactNode }) => {
  const [mediaStream, setMediaStream] = useState<MediaStream>(
    undefined as unknown as MediaStream
  )

  return (
    <AppStreamContext.Provider
      value={{
        mediaStream,
        setMediaStream,
      }}
    >
      {children}
    </AppStreamContext.Provider>
  )
}
