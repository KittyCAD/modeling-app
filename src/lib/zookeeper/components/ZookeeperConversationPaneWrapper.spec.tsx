import { AreaType, LayoutType } from '@src/lib/layout/types'
import { ZookeeperConversationPaneWrapper } from '@src/lib/zookeeper/components/ZookeeperConversationPaneWrapper'
import type { ZookeeperSessionController } from '@src/lib/zookeeper/registry/controller'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  browserSaveFile: vi.fn(async () => undefined),
  contextModeling: { selectionRanges: [] },
  getConversationExport: vi.fn(() => ({
    fileName: 'conversation-123.md',
    markdown: '# Conversation',
  })),
  paneProps: undefined as Record<string, unknown> | undefined,
  settings: {
    app: { zookeeperMode: { project: undefined, user: undefined } },
  },
  settingsSend: vi.fn(),
  user: { id: 'user-id', image: 'avatar.png' },
}))

vi.mock('@headlessui/react', () => ({
  Menu: {
    Item: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  },
}))

vi.mock('@src/components/layout/Panel', () => ({
  LayoutPanel: ({
    children,
    className,
    id,
    title,
  }: {
    children: React.ReactNode
    className: string
    id: string
    title: string
  }) => (
    <section
      className={className}
      data-testid="layout-panel"
      id={id}
      title={title}
    >
      {children}
    </section>
  ),
  LayoutPanelHeader: ({
    Menu,
    icon,
    id,
    onClose,
    title,
  }: {
    Menu: React.ReactNode
    icon: string
    id: string
    onClose?: () => void
    title: string
  }) => (
    <header data-icon={icon} data-testid="layout-panel-header" id={id}>
      <span>{title}</span>
      <button type="button" onClick={onClose}>
        Close
      </button>
      {Menu}
    </header>
  ),
}))

vi.mock('@src/components/layout/Panel/HeaderMenu', () => ({
  HeaderMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@src/lib/zookeeper/components/ZookeeperConversationPane', () => ({
  ZookeeperConversationPane: (props: Record<string, unknown>) => {
    mocks.paneProps = props
    return <div data-testid="conversation-pane" />
  },
}))

vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => ({ context: mocks.contextModeling }),
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    auth: {
      useUser: () => mocks.user,
    },
    settings: {
      actor: { send: mocks.settingsSend },
      useSettings: () => mocks.settings,
    },
  }),
}))

vi.mock('@src/lib/browserSaveFile', () => ({
  browserSaveFile: mocks.browserSaveFile,
}))

const controller = {
  getConversationExport: mocks.getConversationExport,
} as unknown as ZookeeperSessionController

function renderWrapper(onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <ZookeeperConversationPaneWrapper
        controller={controller}
        layout={{
          areaType: AreaType.Zookeeper,
          id: 'zookeeper',
          label: 'Zookeeper',
          type: LayoutType.Simple,
        }}
        onClose={onClose}
      />
    ),
  }
}

describe('ZookeeperConversationPaneWrapper', () => {
  beforeEach(() => {
    mocks.browserSaveFile.mockClear()
    mocks.getConversationExport.mockClear()
    mocks.paneProps = undefined
    mocks.settingsSend.mockClear()
  })

  test('renders the pane chrome and wires the presentation props', () => {
    const { onClose } = renderWrapper()

    expect(screen.getByTestId('layout-panel')).toMatchObject({
      className: 'border-none',
      id: 'zookeeper-pane',
      title: 'Zookeeper',
    })
    expect(screen.getByTestId('layout-panel-header')).toHaveAttribute(
      'data-icon',
      'sparkles'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()

    expect(mocks.paneProps).toMatchObject({
      controller,
      selectionRanges: mocks.contextModeling.selectionRanges,
      zookeeperMode: mocks.settings.app.zookeeperMode,
      userAvatarSrc: mocks.user.image,
    })

    const changeMode = mocks.paneProps?.onMlCopilotModeChange as (
      mode: string
    ) => void
    changeMode('text-to-cad')

    expect(mocks.settingsSend).toHaveBeenCalledWith({
      type: 'set.app.zookeeperMode',
      data: { level: 'project', value: 'text-to-cad' },
    })
  })

  test('exports the current conversation from the header menu', () => {
    renderWrapper()

    fireEvent.click(screen.getByRole('button', { name: 'Export conversation' }))

    expect(mocks.getConversationExport).toHaveBeenCalledOnce()
    expect(mocks.browserSaveFile).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'text/markdown' }),
      'conversation-123.md',
      ''
    )
  })
})
