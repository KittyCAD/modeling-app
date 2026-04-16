import { Popover } from '@headlessui/react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ShareDialog } from '@src/components/ShareDialog'

vi.mock('@src/lib/openWindow', () => ({
  openExternalBrowserIfDesktop: () => vi.fn(),
}))

describe('ShareDialog', () => {
  it('disables publish and shows account guidance when username is required', () => {
    render(
      <Popover>
        <ShareDialog
          onClose={() => {}}
          onCopyLink={vi.fn(async () => true)}
          onPublish={vi.fn(async () => true)}
          allowOrgRestrict={false}
          allowPassword={false}
          shareDisabled={false}
          publishDisabled={true}
          publishRequiresUsername={true}
          accountUrl="https://app.dev.zoo.dev/account"
        />
      </Popover>
    )

    expect(
      screen.getByRole('button', { name: 'Publish' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /Copy link/i })
    ).toBeEnabled()
    expect(
      screen.getByText(/Set a username in your/i)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'account settings' })
    ).toHaveAttribute('href', 'https://app.dev.zoo.dev/account')
  })

  it('leaves publish enabled when username guidance is not needed', () => {
    render(
      <Popover>
        <ShareDialog
          onClose={() => {}}
          onCopyLink={vi.fn(async () => true)}
          onPublish={vi.fn(async () => true)}
          allowOrgRestrict={false}
          allowPassword={false}
          shareDisabled={false}
          publishDisabled={false}
          publishRequiresUsername={false}
          accountUrl="https://app.dev.zoo.dev/account"
        />
      </Popover>
    )

    expect(
      screen.getByRole('button', { name: 'Publish' })
    ).toBeEnabled()
    expect(
      screen.queryByRole('link', { name: 'account settings' })
    ).not.toBeInTheDocument()
  })
})
