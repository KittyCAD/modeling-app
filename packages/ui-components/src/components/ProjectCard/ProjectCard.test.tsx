import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import {
  ProjectCard,
  type ProjectCardContextMenuRenderProps,
} from '@kittycad/ui-components'

describe('ProjectCard', () => {
  test('renders caller-provided project card slots', () => {
    const renderContextMenu = vi.fn(
      (_props: ProjectCardContextMenuRenderProps) => (
        <div data-testid="project-context-menu" />
      )
    )
    render(
      <ProjectCard
        title="Remote bracket"
        thumbnailUrl="https://example.com/thumbnail.png"
        thumbnailAlt="Remote bracket thumbnail"
        badges={<span data-testid="badge">Synced</span>}
        details={<span data-testid="details">2 files</span>}
        renderContextMenu={renderContextMenu}
      />
    )

    expect(screen.getByTestId('project-title')).toHaveTextContent(
      'Remote bracket'
    )
    expect(
      screen.getByRole('img', { name: 'Remote bracket thumbnail' })
    ).toHaveAttribute('src', 'https://example.com/thumbnail.png')
    expect(screen.getByTestId('badge')).toHaveTextContent('Synced')
    expect(screen.getByTestId('details')).toHaveTextContent('2 files')
    expect(screen.getByTestId('project-context-menu')).toBeInTheDocument()
    expect(renderContextMenu.mock.calls[0]?.[0].menuTargetElement.current).toBe(
      screen.getByRole('listitem')
    )
  })

  test('lets callers render the open link and intercept opens', () => {
    const onOpen = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault()
    })

    render(
      <ProjectCard
        title="Cloud-only project"
        href="/projects/cloud-only"
        onOpen={onOpen}
        renderOpenLink={({ href, children, ...props }) => (
          <a {...props} href={href} data-testid="custom-link">
            {children}
          </a>
        )}
      />
    )

    fireEvent.click(screen.getByTestId('custom-link'))

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  test('can be restyled through class name slots', () => {
    render(
      <ProjectCard
        title="Unstyled project"
        classNames={{
          root: 'custom-root',
          openLink: 'custom-link',
          thumbnailFrame: 'custom-thumbnail',
        }}
      />
    )

    expect(screen.getByRole('listitem')).toHaveClass('custom-root')
    expect(screen.getByTestId('project-link')).toHaveClass('custom-link')
    expect(
      screen.getByTestId('project-link').querySelector('.custom-thumbnail')
    ).toBeInTheDocument()
  })
})
