import { CustomIcon } from '@src/components/CustomIcon'
import { uuidv4 } from '@src/lib/utils'
import {
  type FileExplorerEntry,
  type FileExplorerRow,
  type FileExplorerRender,
  type FileExplorerRowContextMenuProps,
} from '@src/components/Explorer/utils'
import { ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import { useRef, useState } from 'react'
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
  contextMenuRow,
  isRenaming,
}: {
  rowsToRender: FileExplorerRow[]
  selectedRow: FileExplorerEntry | null
  contextMenuRow: FileExplorerRow | null
  isRenaming: boolean
}) => {
  // Local state for selection and what is opened
  // diff this against new Project value that comes in
  return (
    <div role="presentation" className="p-px">
      {rowsToRender.map((row, index, original) => {
        const key = row.key
        const renderRow: FileExplorerRender = {
          ...row,
          domIndex: index,
          domLength: original.length,
        }
        return (
          <FileExplorerRowElement
            key={key}
            row={renderRow}
            selectedRow={selectedRow}
            contextMenuRow={contextMenuRow}
            isRenaming={isRenaming}
          ></FileExplorerRowElement>
        )
      })}
    </div>
  )
}

function FileExplorerRowContextMenu({
  itemRef,
  onRename,
  onDelete,
  onClone,
  onOpenInNewWindow,
  callback,
}: FileExplorerRowContextMenuProps) {
  const platform = usePlatform()
  const metaKey = platform === 'macos' ? '⌘' : 'Ctrl'
  return (
    <ContextMenu
      menuTargetElement={itemRef}
      callback={callback}
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

function RenameForm({
  row,
  onSubmit,
}: {
  row: FileExplorerRender
  onSubmit: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleRenameSubmit(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Enter') {
      return
    }

    // TODO: Do the renaming
    // newName: inputRef.current?.value || fileOrDir.name || '',

    // To get out of the renaming state, without this the current file is still in renaming mode
    onSubmit(e)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onSubmit()
    } else if (e.key === 'Enter') {
      // This is needed to prevent events to bubble up and the form to be submitted.
      // (Alternatively the form could be changed into a div.)
      // Bug without this:
      // - open a parent folder (close and open if it's already open)
      // - right click -> rename one of its children
      // - give new name and press enter
      // -> new name is not applied, old name is reverted
      e.preventDefault()
      e.stopPropagation()
    }
  }

  return (
    <form onKeyUp={handleRenameSubmit}>
      <label>
        <span className="sr-only">Rename file</span>
        <input
          data-testid="file-rename-field"
          ref={inputRef}
          type="text"
          autoFocus
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={row.name}
          className="w-full py-1 bg-transparent text-chalkboard-100 placeholder:text-chalkboard-70 dark:text-chalkboard-10 dark:placeholder:text-chalkboard-50 focus:outline-none focus:ring-0"
          onKeyDown={handleKeyDown}
          onBlur={onSubmit}
        />
      </label>
      <button className="sr-only" type="submit">
        Submit
      </button>
    </form>
  )
}

/**
 * Making div soup!
 * A row is a folder or a file.
 */
export const FileExplorerRowElement = ({
  row,
  selectedRow,
  contextMenuRow,
  isRenaming,
}: {
  row: FileExplorerRender
  selectedRow: FileExplorerEntry | null
  contextMenuRow: FileExplorerRow | null
  isRenaming: boolean
}) => {
  const isSelected =
    row.name === selectedRow?.name && row.parentPath === selectedRow?.parentPath
  const isIndexActive = row.domIndex === row.activeIndex
  const outlineCSS = isIndexActive
    ? 'outline outline-1 outline-sky-500 '
    : 'outline-0 outline-none'

  const rowElementRef = useRef(null)
  const isContextMenuRow = contextMenuRow?.key === row.key
  const isMyRowRenaming = isContextMenuRow && isRenaming

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
      onDragOver={(event) => {
        if (!row.isOpen && row.isFolder) {
          // on drag over, open!
          row.rowOpen()
        }
        event.preventDefault()
      }}
      onDragStart={(event) => {
        console.log(event.target.innerText, 'onDragStart')
      }}
      onDrop={(event) => {
        console.log(event.target.innerText, 'onDrop')
      }}
    >
      <div style={{ width: '0.25rem' }}></div>
      {Spacer(row.level)}
      <CustomIcon
        name={row.icon}
        className="inline-block w-4 text-current mr-1"
      />
      {!isMyRowRenaming ? (
        <span className="overflow-hidden whitespace-nowrap text-ellipsis">
          {row.name}
        </span>
      ) : (
        <RenameForm
          row={row}
          onSubmit={(event) => {
            row.rowRenameEnd(event)
          }}
        ></RenameForm>
      )}
      <div className="ml-auto">{row.status}</div>
      <div style={{ width: '0.25rem' }}></div>
      <FileExplorerRowContextMenu
        itemRef={rowElementRef}
        onRename={() => {
          row.rowRenameStart()
        }}
        onDelete={() => {}}
        onClone={() => {}}
        onOpenInNewWindow={() => {}}
        callback={row.rowContextMenu}
      />
    </div>
  )
}
