import { DownloadDesktopAppStatusBarItem } from '@src/components/StatusBar/DownloadDesktopAppStatusBarItem'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('DownloadDesktopAppStatusBarItem', () => {
  it('shows the browser storage warning and restores it on hover', () => {
    render(<DownloadDesktopAppStatusBarItem />)

    const downloadLink = screen.getByRole('link', {
      name: 'Install desktop app',
    })
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'This demo project is only stored in your browser.'
    )

    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.mouseEnter(downloadLink)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })
})
