import { CustomIcon } from '@src/components/CustomIcon'
import { uuidv4 } from '@src/lib/utils'
import type {
  FileExplorerEntry,
  FileExplorerRow,
  FileExplorerRender,
  FileExplorerRowContextMenuProps,
} from '@src/components/Explorer/utils'
import { ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import { useRef } from 'react'
import usePlatform from '@src/hooks/usePlatform'

export const StatusDot = () => {
  return <span>•</span>
}

/**
 * Implement a dynamic spacer with rem to offset the row
 * in the tree based on the level within the tree
 * level 0 to level N
 */
const Spacer = (level: number) => {
  const containerRemSpacing = `${level}rem`
  return level === 0 ? (
    <div></div>
  ) : (
    <div
      style={{ width: containerRemSpacing }}
      className="h-full flex flex-row"
    >
      {Array(level)
        .fill(0)
        .map(() => {
          const remSpacing = `${0.5}rem`
          return (
            <div className="h-full w-full" key={uuidv4()}>
              <div
                style={{ width: remSpacing }}
                className={`h-full border-r border-sky-600`}
              ></div>
              <div style={{ width: remSpacing }} className={`h-full`}></div>
            </div>
          )
        })}
    </div>
  )
}

/**
 * Render all the rows of the file explorer in linear layout in the DOM.
 * each row is rendered one after another in the same parent DOM element
 * rows will have aria support to understand the linear div soup layout
 *

 * what is opened and selected outside of this logic level.
 *
 */
export const FileExplorer = ({
  rowsToRender,
  selectedRow,
}: {
  rowsToRender: FileExplorerRow[]
  selectedRow: FileExplorerEntry | null
}) => {
  // Local state for selection and what is opened
  // diff this against new Project value that comes in
  return (
    <div role="presentation" className="p-px">
      {rowsToRender.map((row, index, original) => {
        const renderRow: FileExplorerRender = {
          ...row,
          domIndex: index,
          domLength: original.length,
        }
        return (
          <FileExplorerRowElement
            key={uuidv4()}
            row={renderRow}
            selectedRow={selectedRow}
          ></FileExplorerRowElement>
        )
      })}
    </div>
  )
}

/**
 * Making div soup!
 * A row is a folder or a file.
 */
export const FileExplorerRowElement = ({
  row,
  selectedRow,
}: {
  row: FileExplorerRender
  selectedRow: FileExplorerEntry | null
  domLength: number
}) => {
  const isSelected =
    row.name === selectedRow?.name && row.parentPath === selectedRow?.parentPath
  const isIndexActive = row.domIndex === row.activeIndex
  const outlineCSS = isIndexActive
    ? 'outline outline-1 outline-sky-500 '
    : 'outline-0 outline-none'

  const rowElementRef = useRef(null)
  return (
    <div
      ref={rowElementRef}
      role="treeitem"
      className={`h-6 flex flex-row items-center text-xs cursor-pointer -outline-offset-1 ${outlineCSS} hover:outline hover:outline-1 hover:outline-sky-500 hover:bg-sky-400 ${isSelected ? 'bg-sky-800' : ''}`}
      data-index={row.domIndex}
      data-last-element={row.domIndex === row.domLength - 1}
      data-parity={row.domIndex % 2 === 0}
      aria-setsize={row.domLength}
      aria-posinset={row.domIndex + 1}
      aria-label={row.name}
      aria-selected={isSelected}
      aria-level={row.level + 1}
      aria-expanded={row.isFolder && row.isOpen}
      onClick={() => {
        row.rowClicked(row.domIndex)
      }}
      draggable="true"
      onDragOver={(event)=>{
        if (!row.isOpen && row.isFolder) {
          // on drag over, open!
          row.rowOpen()
        }
        event.preventDefault()
      }}
      onDragStart={((event)=>{
        console.log(event.target.innerText,'onDragStart')
      })}
      onDrop={(event)=>{
        console.log(event.target.innerText,'onDrop')
      }}
    >
      <div style={{ width: '0.25rem' }}></div>
      {Spacer(row.level)}
      <CustomIcon
        name={row.icon}
        className="inline-block w-4 text-current mr-1"
      />
      <span className="overflow-hidden whitespace-nowrap text-ellipsis">
        {row.name}
      </span>
      <div className="ml-auto">{row.status}</div>
      <div style={{ width: '0.25rem' }}></div>
      <FileExplorerRowContextMenu
        itemRef={rowElementRef}
        onRename={() => {}}
        onDelete={() => {}}
        onClone={() => {}}
        onOpenInNewWindow={() => {}}
      />
    </div>
  )
}

function FileExplorerRowContextMenu({
  itemRef,
  onRename,
  onDelete,
  onClone,
  onOpenInNewWindow,
}: FileExplorerRowContextMenuProps) {
  const platform = usePlatform()
  const metaKey = platform === 'macos' ? '⌘' : 'Ctrl'
  return (
    <ContextMenu
      menuTargetElement={itemRef}
      items={[
        <ContextMenuItem
          data-testid="context-menu-rename"
          onClick={onRename}
          hotkey="Enter"
        >
          Rename
        </ContextMenuItem>,
        <ContextMenuItem
          data-testid="context-menu-delete"
          onClick={onDelete}
          hotkey={metaKey + ' + Del'}
        >
          Delete
        </ContextMenuItem>,
        <ContextMenuItem
          data-testid="context-menu-clone"
          onClick={onClone}
          hotkey=""
        >
          Clone
        </ContextMenuItem>,
        <ContextMenuItem
          data-testid="context-menu-open-in-new-window"
          onClick={onOpenInNewWindow}
        >
          Open in new window
        </ContextMenuItem>,
      ]}
    />
  )
}
