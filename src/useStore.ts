import { create } from 'zustand'

export interface StoreState {
  isStreamReady: boolean
  setIsStreamReady: (isStreamReady: boolean) => void
  setHtmlRef: (ref: React.RefObject<HTMLDivElement>) => void
  htmlRef: React.RefObject<HTMLDivElement> | null
}

export const useStore = create<StoreState>()((set, get) => {
  return {
    setIsStreamReady: (isStreamReady) => set({ isStreamReady }),
    setHtmlRef: (htmlRef) => {
      set({ htmlRef })
    },
    htmlRef: null,
    isStreamReady: false,
  }
})
