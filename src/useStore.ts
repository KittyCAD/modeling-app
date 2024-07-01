import { create } from 'zustand'

export interface StoreState {
  isStreamReady: boolean
  setIsStreamReady: (isStreamReady: boolean) => void
  isKclLspServerReady: boolean
  isCopilotLspServerReady: boolean
  setIsKclLspServerReady: (isKclLspServerReady: boolean) => void
  setIsCopilotLspServerReady: (isCopilotLspServerReady: boolean) => void
  setHtmlRef: (ref: React.RefObject<HTMLDivElement>) => void
  htmlRef: React.RefObject<HTMLDivElement> | null
}

export const useStore = create<StoreState>()((set, get) => {
  return {
    setIsStreamReady: (isStreamReady) => set({ isStreamReady }),
    setIsKclLspServerReady: (isKclLspServerReady) =>
      set({ isKclLspServerReady }),
    setIsCopilotLspServerReady: (isCopilotLspServerReady) =>
      set({ isCopilotLspServerReady }),
    setHtmlRef: (htmlRef) => {
      set({ htmlRef })
    },
    htmlRef: null,
    isStreamReady: false,
    isKclLspServerReady: false,
    isCopilotLspServerReady: false,
  }
})
