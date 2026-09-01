import type { PropsWithChildren } from 'react'
import { createContext, useContext } from 'react'

type FileExplorerPreviewContextValue = {
  previewUrls: ReadonlyMap<string, string>
  showPreviews: boolean
}

const defaultContextValue: FileExplorerPreviewContextValue = {
  previewUrls: new Map(),
  showPreviews: false,
}

const FileExplorerPreviewContext =
  createContext<FileExplorerPreviewContextValue>(defaultContextValue)

export function FileExplorerPreviewProvider({
  children,
  previewUrls,
  showPreviews,
}: PropsWithChildren<FileExplorerPreviewContextValue>) {
  return (
    <FileExplorerPreviewContext.Provider value={{ previewUrls, showPreviews }}>
      {children}
    </FileExplorerPreviewContext.Provider>
  )
}

export const useFileExplorerPreviews = () =>
  useContext(FileExplorerPreviewContext)
