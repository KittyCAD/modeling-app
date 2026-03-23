import { render, screen } from '@testing-library/react'
import { expect, vi, describe, test, beforeEach, afterEach } from 'vitest'

import { FilesSnapshot } from '@src/components/Thinking'
import type { MlCopilotFile } from '@kittycad/lib'

// Mock a small valid PNG image (1x1 transparent pixel)
const MOCK_PNG_DATA = [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120,
  156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]

// Mock a small valid JPEG image header
const MOCK_JPEG_DATA = [
  255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 255,
  219, 0, 67, 0, 8, 6, 6, 7, 6, 5, 8, 7, 7, 7, 9, 9, 8, 10, 12, 20, 13, 12, 11,
  11, 12, 25, 18, 19, 15, 20, 29, 26, 31, 30, 29, 26, 28, 28, 32, 36, 46, 39,
  32, 34, 44, 35, 28, 28, 40, 55, 41, 44, 48, 49, 52, 52, 52, 31, 39, 57, 61,
  56, 50, 60, 46, 51, 52, 50, 255, 217,
]

// Mock PDF data (just the header for testing purposes)
const MOCK_PDF_DATA = [
  37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10,
]

describe('FilesSnapshot', () => {
  let createObjectURLMock: ReturnType<typeof vi.fn>
  let revokeObjectURLMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createObjectURLMock = vi.fn((blob: Blob) => `blob:mock-url-${blob.type}`)
    revokeObjectURLMock = vi.fn()

    global.URL.createObjectURL =
      createObjectURLMock as typeof URL.createObjectURL
    global.URL.revokeObjectURL =
      revokeObjectURLMock as typeof URL.revokeObjectURL
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('renders a single image file with correct filename', () => {
    const files: MlCopilotFile[] = [
      {
        name: 'test-image.png',
        mimetype: 'image/png',
        data: MOCK_PNG_DATA,
      },
    ]

    render(<FilesSnapshot files={files} />)

    expect(screen.getByText('Zookeeper File')).toBeInTheDocument()
    expect(screen.getByText('test-image.png')).toBeInTheDocument()
    expect(screen.getByAltText('test-image.png')).toBeInTheDocument()
  })

  test('renders multiple image files with count in header', () => {
    const files: MlCopilotFile[] = [
      {
        name: 'image1.png',
        mimetype: 'image/png',
        data: MOCK_PNG_DATA,
      },
      {
        name: 'image2.jpeg',
        mimetype: 'image/jpeg',
        data: MOCK_JPEG_DATA,
      },
    ]

    render(<FilesSnapshot files={files} />)

    expect(screen.getByText('Zookeeper Files (2)')).toBeInTheDocument()
    expect(screen.getByText('image1.png')).toBeInTheDocument()
    expect(screen.getByText('image2.jpeg')).toBeInTheDocument()
  })

  test('renders non-image files with file icon', () => {
    const files: MlCopilotFile[] = [
      {
        name: 'document.pdf',
        mimetype: 'application/pdf',
        data: MOCK_PDF_DATA,
      },
    ]

    render(<FilesSnapshot files={files} />)

    expect(screen.getByText('Zookeeper File')).toBeInTheDocument()
    expect(screen.getByText('document.pdf')).toBeInTheDocument()
  })

  test('renders mixed image and non-image files', () => {
    const files: MlCopilotFile[] = [
      {
        name: 'photo.png',
        mimetype: 'image/png',
        data: MOCK_PNG_DATA,
      },
      {
        name: 'report.pdf',
        mimetype: 'application/pdf',
        data: MOCK_PDF_DATA,
      },
    ]

    render(<FilesSnapshot files={files} />)

    expect(screen.getByText('Zookeeper Files (2)')).toBeInTheDocument()
    // Image file
    expect(screen.getByText('photo.png')).toBeInTheDocument()
    expect(screen.getByAltText('photo.png')).toBeInTheDocument()
    // Non-image file
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
  })

  test('creates object URLs for all files on mount', () => {
    const files: MlCopilotFile[] = [
      {
        name: 'image.png',
        mimetype: 'image/png',
        data: MOCK_PNG_DATA,
      },
      {
        name: 'doc.pdf',
        mimetype: 'application/pdf',
        data: MOCK_PDF_DATA,
      },
    ]

    render(<FilesSnapshot files={files} />)

    expect(createObjectURLMock).toHaveBeenCalledTimes(2)
  })

  test('revokes object URLs on unmount', () => {
    const files: MlCopilotFile[] = [
      {
        name: 'image.png',
        mimetype: 'image/png',
        data: MOCK_PNG_DATA,
      },
    ]

    const { unmount } = render(<FilesSnapshot files={files} />)
    unmount()

    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1)
  })

  test('image has download button with correct title', () => {
    const files: MlCopilotFile[] = [
      {
        name: 'clickable-image.png',
        mimetype: 'image/png',
        data: MOCK_PNG_DATA,
      },
    ]

    render(<FilesSnapshot files={files} />)

    const imageButton = screen.getByTitle(
      'Click to download clickable-image.png'
    )
    expect(imageButton).toBeInTheDocument()
    expect(imageButton.tagName).toBe('BUTTON')
  })

  test('non-image file has download button with correct title', () => {
    const files: MlCopilotFile[] = [
      {
        name: 'clickable-doc.pdf',
        mimetype: 'application/pdf',
        data: MOCK_PDF_DATA,
      },
    ]

    render(<FilesSnapshot files={files} />)

    const fileButton = screen.getByTitle('Click to download clickable-doc.pdf')
    expect(fileButton).toBeInTheDocument()
    expect(fileButton.tagName).toBe('BUTTON')
  })
})
