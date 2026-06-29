import { FileExplorer } from '@src/components/Explorer/FileExplorer'
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
})
