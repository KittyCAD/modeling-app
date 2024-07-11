import {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
} from 'react'

/*

This is for a very small handful of global state we need that doesn't fit into
any of the Xstate machines.
Please do not fill this up with junk.

*/

interface AppState {
  isStreamReady: boolean
  setAppState: (newAppState: Partial<AppState>) => void

  mediaStream?: MediaStream
  buttonDownInStream: number | undefined
  didDragInStream: boolean
  streamDimensions: { streamWidth: number; streamHeight: number }
  // openPanes: SidebarType[]
}

const AppStateContext = createContext<AppState>({
  isStreamReady: false,
  setAppState: () => {},

  buttonDownInStream: undefined,
  didDragInStream: false,
  streamDimensions: { streamWidth: 1280, streamHeight: 720 },
  mediaStream: undefined,
  // openPanes: persistedContext.openPanes || ['code'],
})

export const useAppState = () => useContext(AppStateContext)

export const AppStateProvider = ({ children }: { children: ReactNode }) => {
  const [appState, _setAppState] = useState<AppState>({
    isStreamReady: false,
    setAppState: () => {},

    buttonDownInStream: undefined,
    didDragInStream: false,
    streamDimensions: { streamWidth: 1280, streamHeight: 720 },
    mediaStream: undefined,
    // openPanes: persistedContext.openPanes || ['code'],
  })
  useEffect(() => {
    // console.log('appState change', appState)
  }, [appState])
  const setAppState = (newAppState: Partial<AppState>) => {
    // console.log('appstate', newAppState)
    _setAppState({
      ...appState,
      ...newAppState,
      mediaStream: newAppState.mediaStream || appState.mediaStream,
    })
  }

  return (
    <AppStateContext.Provider
      value={{
        isStreamReady: appState.isStreamReady,
        setAppState,

        mediaStream: appState.mediaStream,
        buttonDownInStream: appState.buttonDownInStream,
        didDragInStream: appState.didDragInStream,
        streamDimensions: appState.streamDimensions,
      }}
    >
      {children}
    </AppStateContext.Provider>
  )
}
