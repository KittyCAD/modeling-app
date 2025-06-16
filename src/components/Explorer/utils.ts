import type { ReactNode } from 'react'
import type { FileEntry } from '@src/lib/project'
import type { CustomIconName } from '@src/components/CustomIcon'

export interface FileExplorerEntry extends FileEntry {
  parentPath: string
  level: number
  index: number
}

export interface FileExplorerRow extends FileExplorerEntry {
  icon: CustomIconName
  name: string
  isFolder: boolean
  status?: ReactNode
  isOpen: boolean
  rowClicked: (domIndex: number) => void
  /**
   * Fake file or folder rows are the placeholders for users to input a value
   * and write that to disk to be read as a real one.
   * they are placed in the DOM as if they are real but not from the source of truth
   */
  isFake: boolean
  activeIndex: number
}

export interface FileExplorerRender extends FileExplorerRow {
  domIndex: number
  domLength: number
}
