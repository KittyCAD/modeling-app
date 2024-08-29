import { createContext, useContext, useState, ReactNode } from 'react'

/*

This is for a very small handful of global state we need that doesn't fit into
any of the Xstate machines.
Please do not fill this up with junk.

*/

interface AppState {
  isStreamReady: boolean
  setAppState: (newAppState: Partial<AppState>) => void
}

const AppStateContext = createContext<AppState>({
  isStreamReady: false,
  setAppState: () => {},
})

export const useAppState = () => useContext(AppStateContext)

export const AppStateProvider = ({ children }: { children: ReactNode }) => {
  const [appState, _setAppState] = useState<AppState>({
    isStreamReady: false,
    setAppState: () => {},
  })
  const setAppState = (newAppState: Partial<AppState>) =>
    _setAppState({ ...appState, ...newAppState })

  return (
    <AppStateContext.Provider
      value={{
        isStreamReady: appState.isStreamReady,
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

export const useAppStream = () => useContext(AppStreamContext)

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
