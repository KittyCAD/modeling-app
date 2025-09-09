import { ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import { CustomIcon } from '@src/components/CustomIcon'
import {
  type FileExplorerEntry,
  type FileExplorerRender,
  type FileExplorerRow,
  type FileExplorerRowContextMenuProps,
  isRowFake,
} from '@src/components/Explorer/utils'
import { DeleteConfirmationDialog } from '@src/components/ProjectCard/DeleteProjectDialog'
import type { MaybePressOrBlur, SubmitByPressOrBlur } from '@src/lib/types'
import { uuidv4 } from '@src/lib/utils'
import type { Dispatch } from 'react'
import { useRef, useState } from 'react'

export const StatusDot = () => {
  return <span className="text-primary hue-rotate-90">•</span>
}

/**
 * A dynamic spacer that will add spaces based on the level it is in the tree
 * @param level supported be from 0 to N
 * @returns
 */
export const Spacer = (level: number) => {
  if (level < 0) {
    return <div>Do not pass a number less than 0.</div>
  }
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
          return (
            <div className="h-full w-full" key={uuidv4()}>
              <div
                style={{ width: '0.45rem' }}
                className={`h-full border-r border-gray-300`}
              ></div>
              <div style={{ width: '0.25rem' }} className={`h-full`}></div>
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
 * Pure functional renderer, state is stored outside this component.
 */
export const FileExplorer = ({
  rowsToRender,
  selectedRow,
  contextMenuRow,
  isRenaming,
  isCopying,
}: {
  rowsToRender: FileExplorerRow[]
  selectedRow: FileExplorerEntry | null
  contextMenuRow: FileExplorerEntry | null
  isRenaming: boolean
  isCopying: boolean
}) => {
  return (
    <div data-testid="file-explorer" role="presentation" className="relative">
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
            isCopying={isCopying}
          ></FileExplorerRowElement>
        )
      })}
    </div>
  )
}

/**
 * TODO Support cut, copy, paste https://github.com/KittyCAD/modeling-app/issues/7952
 */
function FileExplorerRowContextMenu({
  itemRef,
  onRename,
  onDelete,
  onCopy,
  onOpenInNewWindow,
  callback,
  onPaste,
  isCopying,
}: FileExplorerRowContextMenuProps) {
  return (
    <ContextMenu
      menuTargetElement={itemRef}
      callback={callback}
      items={[
        <ContextMenuItem data-testid="context-menu-rename" onClick={onRename}>
          Rename
        </ContextMenuItem>,
        <ContextMenuItem data-testid="context-menu-delete" onClick={onDelete}>
          Delete
        </ContextMenuItem>,
        <ContextMenuItem data-testid="context-menu-copy" onClick={onCopy}>
          Copy
        </ContextMenuItem>,
        <ContextMenuItem
          disabled={!isCopying}
          data-testid="context-menu-paste"
          onClick={onPaste}
        >
          Paste
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
  onSubmit: SubmitByPressOrBlur
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleRenameSubmit(e: NonNullable<MaybePressOrBlur>) {
    if ('key' in e && e.key !== 'Enter') {
      return
    }
    // To get out of the renaming state, without this the current file is still in renaming mode
    onSubmit(e)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onSubmit(null)
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
  const formattedPlaceHolder = isRowFake(row) ? '' : row.name
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
          placeholder={formattedPlaceHolder}
          className="p-1 overflow-hidden whitespace-nowrap text-ellipsis py-1 bg-transparent outline outline-primary -outline-offset-4 text-chalkboard-100 placeholder:text-chalkboard-70 dark:text-chalkboard-10 dark:placeholder:text-chalkboard-50 focus:ring-0"
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

function DeleteFileTreeItemDialog({
  row,
  setIsOpen,
}: {
  row: FileExplorerRender
  setIsOpen: Dispatch<React.SetStateAction<boolean>>
}) {
  return (
    <DeleteConfirmationDialog
      title={`Delete ${row.isFolder ? 'folder' : 'file'}`}
      onDismiss={() => setIsOpen(false)}
      onConfirm={() => {
        row.onDelete()
        setIsOpen(false)
      }}
    >
      <p className="my-4">
        This will permanently delete "{row.name || 'this file'}"
        {row.children !== null ? ' and all of its contents. ' : '. '}
      </p>
      <p className="my-4">
        Are you sure you want to delete "{row.name || 'this file'}
        "? This action cannot be undone.
      </p>
    </DeleteConfirmationDialog>
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
  isCopying,
}: {
  row: FileExplorerRender
  selectedRow: FileExplorerEntry | null
  contextMenuRow: FileExplorerEntry | null
  isRenaming: boolean
  isCopying: boolean
}) => {
  const rowElementRef = useRef(null)
  const isSelected =
    row.name === selectedRow?.name && row.parentPath === selectedRow?.parentPath
  const isIndexActive = row.domIndex === row.activeIndex
  const isContextMenuRow = contextMenuRow?.key === row.key
  const isMyRowRenaming = isContextMenuRow && isRenaming
  const [isConfirmingDelete, setIsConfirmingDelete] = useState<boolean>(false)

  const outlineCSS =
    isIndexActive && !isMyRowRenaming
      ? 'outline outline-1 outline-primary'
      : 'outline-0 outline-none'
  // Complaining about role="treeitem" focus but it is reimplemented aria labels
  /* eslint-disable */
  return (
    <div
      ref={rowElementRef}
      role="treeitem"
      data-testid="file-tree-item"
      className={`h-5 flex flex-row items-center text-xs cursor-pointer -outline-offset-1 ${outlineCSS} hover:outline hover:outline-1 hover:bg-gray-300/50 hover:bg-gray-300/50 ${isSelected ? 'bg-primary/10' : ''}`}
      data-index={row.domIndex}
      data-last-element={row.domIndex === row.domLength - 1}
      data-parity={row.domIndex % 2 === 0}
      aria-setsize={row.setSize}
      aria-posinset={row.positionInSet}
      aria-label={row.name}
      aria-selected={isSelected}
      aria-level={row.level + 1}
      aria-expanded={row.isFolder && row.isOpen}
      onClick={() => {
        row.onClick(row.domIndex)
      }}
      draggable="true"
      onDragOver={(event) => {
        // TODO: the onDrag work is for dragging the DOM element to move folders and files
        // if (!row.isOpen && row.isFolder) {
        //   // on drag over, open!
        //   row.onOpen()
        // }
        // event.preventDefault()
      }}
      onDragStart={(event) => {
        // TODO console.log(event.target.innerText, 'onDragStart')
      }}
      onDrop={(event) => {
        // TODO console.log(event.target.innerText, 'onDrop')
      }}
    >
      <div style={{ width: '0.5rem' }}></div>
      {Spacer(row.level)}
      <CustomIcon
        name={row.icon}
        className="inline-block w-4 text-current mr-1"
      />
      {!isMyRowRenaming && !row.isFake ? (
        <span className="overflow-hidden whitespace-nowrap text-ellipsis">
          {row.name}
        </span>
      ) : (
        <RenameForm
          row={row}
          onSubmit={(event: MaybePressOrBlur) => {
            row.onRenameEnd(event)
          }}
        ></RenameForm>
      )}
      <div className="ml-auto">{row.status}</div>
      <div style={{ width: '0.25rem' }}></div>
      {isConfirmingDelete && (
        <DeleteFileTreeItemDialog row={row} setIsOpen={setIsConfirmingDelete} />
      )}
      <FileExplorerRowContextMenu
        itemRef={rowElementRef}
        onRename={() => {
          row.onRenameStart()
        }}
        onDelete={() => {
          setIsConfirmingDelete(true)
        }}
        onOpenInNewWindow={() => {
          row.onOpenInNewWindow()
        }}
        onCopy={() => {
          row.onCopy()
        }}
        callback={() => {
          row.onContextMenuOpen(row.domIndex)
        }}
        onPaste={() => {
          row.onPaste()
        }}
        isCopying={isCopying}
      />
    </div>
  )
}
