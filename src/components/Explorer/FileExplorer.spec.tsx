import { FileExplorer } from '@src/components/Explorer/FileExplorer'
import { FileExplorerPreviewProvider } from '@src/components/Explorer/FileExplorerPreviewContext'
import type { FileExplorerRow } from '@src/components/Explorer/utils'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('FileExplorer', () => {
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

  it('shows a cached KCL preview when the containing pane is wide enough', () => {
    const row: FileExplorerRow = {
      activeIndex: -1,
      children: null,
      icon: 'file',
      index: 0,
      isFake: false,
      isFolder: false,
      isOpen: false,
      key: 'demo/main.kcl',
      level: 0,
      name: 'main.kcl',
      onClick: () => {},
      onContextMenuOpen: () => {},
      onCopy: () => {},
      onDelete: () => {},
      onDrop: () => {},
      onOpen: () => {},
      onOpenInNewWindow: () => {},
      onPaste: () => {},
      onRenameEnd: () => {},
      onRenameStart: () => {},
      parentPath: 'demo',
      path: '/projects/demo/main.kcl',
      positionInSet: 1,
      render: true,
      setSize: 1,
    }

    render(
      <FileExplorerPreviewProvider
        previewUrls={new Map([[row.path, 'blob:main-preview']])}
        showPreviews
      >
        <FileExplorer
          contextMenuRow={null}
          isCopying={false}
          isDeleting={false}
          isInteractionDisabled={false}
          isRenaming={false}
          onDeleteEnd={() => {}}
          rowsToRender={[row]}
          selectedRow={null}
        />
      </FileExplorerPreviewProvider>
    )

    expect(screen.getByAltText('Preview of main.kcl')).toHaveAttribute(
      'src',
      'blob:main-preview'
    )
    expect(screen.getByTestId('file-tree-item')).toHaveClass('min-h-14')
  })
})
