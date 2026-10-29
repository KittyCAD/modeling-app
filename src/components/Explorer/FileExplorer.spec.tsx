import { FileExplorer } from '@src/components/Explorer/FileExplorer'
import type { FileExplorerRender } from '@src/components/Explorer/utils'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

describe('FileExplorer', () => {
  it('opens a dragged-over folder immediately once per gesture without retoggling on child boundaries', () => {
    const onOpen = vi.fn()
    const folder: FileExplorerRender = {
      name: 'folder',
      path: '/project/folder',
      parentPath: '/project',
      children: [],
      key: 'folder',
      icon: 'folder',
      level: 0,
      index: 0,
      setSize: 1,
      isFolder: true,
      isOpen: false,
      render: true,
      isFake: false,
      activeIndex: 0,
      domIndex: 0,
      domLength: 1,
      onOpen,
      onClick: vi.fn(),
      onContextMenuOpen: vi.fn(),
      onCreateFile: vi.fn(),
      onOpenInNewWindow: vi.fn(),
      onDelete: vi.fn(),
      onCopy: vi.fn(),
      onPaste: vi.fn(),
      onDrop: vi.fn(),
      onRenameStart: vi.fn(),
      onRenameEnd: vi.fn(),
    }
    render(
      <FileExplorer
        rowsToRender={[folder]}
        selectedRow={null}
        contextMenuRow={null}
        isRenaming={false}
        isCopying={false}
        isDeleting={false}
        isInteractionDisabled={false}
        onDeleteEnd={vi.fn()}
      />
    )
    const row = screen.getByRole('treeitem')
    const dataTransfer = new DataTransfer()
    fireEvent.dragOver(row, { dataTransfer })
    expect(onOpen).toHaveBeenCalledTimes(1)
    fireEvent.dragOver(row, { dataTransfer })
    const label = screen.getByText('folder')
    const leaveForChild = createEvent.dragLeave(row, { dataTransfer })
    // Happy DOM's DragEvent constructor drops the native relatedTarget option.
    Object.defineProperty(leaveForChild, 'relatedTarget', { value: label })
    fireEvent(row, leaveForChild)
    fireEvent.dragOver(row, { dataTransfer })
    expect(onOpen).toHaveBeenCalledTimes(1)
    fireEvent.dragLeave(row, { dataTransfer, relatedTarget: document.body })
    fireEvent.dragOver(row, { dataTransfer })
    expect(onOpen).toHaveBeenCalledTimes(2)
  })
  describe('FileExplorer', () => {
    it('should render no rows', () => {
      render(
        <FileExplorer
          rowsToRender={[]}
          selectedRow={null}
          contextMenuRow={null}
          isRenaming={false}
          isCopying={false}
          isDeleting={false}
          isInteractionDisabled={false}
          onDeleteEnd={() => {}}
        />
      )
      const container = screen.getByTestId('file-explorer')
      expect(container.childNodes.length).toBe(0)
    })
  })
})
