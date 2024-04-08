import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { Themes, getSystemTheme } from 'lib/theme'
import { Resizable } from 're-resizable'
import { useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { PaneType, useStore } from 'useStore'
import { CollapsiblePanel } from 'components/CollapsiblePanel'
import {
  faCode,
  faCodeCommit,
  faSquareRootVariable,
} from '@fortawesome/free-solid-svg-icons'
import { CodeMenu } from 'components/CodeMenu'
import { TextEditor } from 'components/TextEditor'
import { MemoryPanel } from 'components/MemoryPanel'
import { KCLErrors, Logs } from 'components/Logs'

interface ModelingSidebarProps {
  paneOpacity: '' | 'opacity-20' | 'opacity-40'
}

export function ModelingSidebar({ paneOpacity }: ModelingSidebarProps) {
  const { buttonDownInStream, openPanes, setOpenPanes } = useStore((s) => ({
    buttonDownInStream: s.buttonDownInStream,
    openPanes: s.openPanes,
    setOpenPanes: s.setOpenPanes,
    didDragInStream: s.didDragInStream,
    streamDimensions: s.streamDimensions,
  }))
  const { settings } = useSettingsAuthContext()
  const {
    app: { theme, onboardingStatus },
  } = settings.context

  const editorTheme =
    theme.current === Themes.System ? getSystemTheme() : theme.current

  // Pane toggling keyboard shortcuts
  const togglePane = useCallback(
    (newPane: PaneType) =>
      openPanes.includes(newPane)
        ? setOpenPanes(openPanes.filter((p) => p !== newPane))
        : setOpenPanes([...openPanes, newPane]),
    [openPanes, setOpenPanes]
  )
  useHotkeys('shift + c', () => togglePane('code'))
  useHotkeys('shift + v', () => togglePane('variables'))
  useHotkeys('shift + l', () => togglePane('logs'))
  useHotkeys('shift + e', () => togglePane('kclErrors'))
  useHotkeys('shift + d', () => togglePane('debug'))

  return (
    <Resizable
      className={
        'pointer-events-none h-full flex flex-col flex-1 z-10 my-2 ml-2 pr-1 transition-opacity transition-duration-75 ' +
        +paneOpacity
      }
      defaultSize={{
        width: '550px',
        height: 'auto',
      }}
      minWidth={200}
      maxWidth={800}
      minHeight={'auto'}
      maxHeight={'auto'}
      handleClasses={{
        right:
          'hover:bg-chalkboard-10 hover:dark:bg-chalkboard-110 bg-transparent transition-colors duration-75 transition-ease-out delay-100 ' +
          (buttonDownInStream || onboardingStatus.current === 'camera'
            ? 'pointer-events-none '
            : 'pointer-events-auto'),
      }}
    >
      <div
        id="code-pane"
        className="h-full flex flex-col justify-between pointer-events-none"
      >
        <CollapsiblePanel
          title="Code"
          icon={faCode}
          className="open:!mb-2"
          open={openPanes.includes('code')}
          menu={<CodeMenu />}
        >
          <TextEditor theme={editorTheme} />
        </CollapsiblePanel>
        <section className="flex flex-col">
          <MemoryPanel
            theme={editorTheme}
            open={openPanes.includes('variables')}
            title="Variables"
            icon={faSquareRootVariable}
          />
          <Logs
            theme={editorTheme}
            open={openPanes.includes('logs')}
            title="Logs"
            icon={faCodeCommit}
          />
          <KCLErrors
            theme={editorTheme}
            open={openPanes.includes('kclErrors')}
            title="KCL Errors"
            iconClassNames={{ bg: 'group-open:bg-destroy-70' }}
          />
        </section>
      </div>
    </Resizable>
  )
}
