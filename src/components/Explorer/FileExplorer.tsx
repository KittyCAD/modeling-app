import type { Project, FileEntry } from '@src/lib/project'
import Tooltip from '@src/components/Tooltip'
import { FILE_EXT, INSERT_FOREIGN_TOAST_ID } from '@src/lib/constants'
import type {ReactNode} from 'react'
import {useState, useEffect} from 'react'
import { ActionButton } from '@src/components/ActionButton'
import { ActionIcon } from '@src/components/ActionIcon'
import type { CustomIconName } from '@src/components/CustomIcon'
import { CustomIcon } from '@src/components/CustomIcon'
import {
  systemIOActor,
} from '@src/lib/singletons'

interface Explorer {

}

interface ExplorerState {

}

interface FileExplorerRowContents {
  icon: CustomIconName,
  name: string,
  isFolder: boolean,
  status?: ReactNode,
  isOpen: boolean
}

interface FileExplorerEntry extends FileEntry {
  parentPath: string
  level: number
}


export const StatusDot = () => {
  return (<span>•</span>)
}

export const Spacer = (level: number) => {
  const tailwindSpacing = `${(level)}rem`
  return level === 0 ? (<div></div>) : (<div style={{width:tailwindSpacing}}></div>)
}


const flattenProjectHelper = (f: FileEntry, list: FileEntry[], path: string, level: number) => {
  f.parentPath = path
  f.level = level
  list.push(f)
  if (f.children === null) {
    return
  }
  for (let i = 0; i < f.children.length; i++) {
    flattenProjectHelper(f.children[i], list, path+'/'+f.name, level + 1)
  }

}

const flattenProject = (project: Project) : FileEntry[] => {
  if (project.children === null) {
    return []
  }

  const flattenTreeInOrder : FileEntry [] = []
  for (let i = 0; i < project.children.length; i++) {
    flattenProjectHelper(project.children[i], flattenTreeInOrder, project.name, 0)
  }

  return flattenTreeInOrder
}

export const FileExplorer = ({
  parentProject
}:{
  parentProject: Project
}) => {
  let flattenedData : FileEntry[] = []
  if (parentProject) {
    flattenedData = flattenProject(parentProject)
  }
  const [openedRows, setOpenedRows] = useState<{[key:string]:boolean}>({})
  const [rowsToRender, setRowsToRender] = useState<FileExplorerRowContents[]>([])

  useEffect(()=> {
    /* const allRows = parentProject?.children?.map((child)=>{ */
    const allRows = flattenedData.map((child)=>{
      const isFile = child.children === null
      const isKCLFile = isFile && child.name?.endsWith(FILE_EXT)

      let icon : CustomIconName = 'file'
      if (isKCLFile) {
        icon = 'kcl'
      } else if (!isFile) {
        icon = 'folder'
      }

      /**
       * If any parent is closed, keep the history of open children
       */
      let isAnyParentClosed = false
      const pathIterator = child.parentPath.split('/')

      while (pathIterator.length > 0) {
        const key = pathIterator.join('/')
        const isOpened = openedRows[key] || parentProject.name === key
        isAnyParentClosed = isAnyParentClosed || !isOpened
        pathIterator.pop()
      }


      return {
        name: child.name,
        icon: icon,
        isFolder: !isFile,
        status: StatusDot(),
        isOpen: (openedRows[child.parentPath] || parentProject.name === child.parentPath) && !isAnyParentClosed,
        parentPath: child.parentPath,
        level: child.level,
        rowClicked: () => {
          const newOpenedRows = {...openedRows}
          const key = child.parentPath + '/' + child.name
          const value = openedRows[key]
          newOpenedRows[key] = !value
          setOpenedRows(newOpenedRows)
        }
      }
    }) ||  []

    setRowsToRender(allRows)

  },[parentProject, openedRows])

// Local state for selection and what is opened
// diff this against new Project value that comes in
return (<div>
  {rowsToRender.map((row)=>{
    return (row.isOpen ? <FileExplorerRow
              row={row}
            ></FileExplorerRow> : null)
  })}
</div>)
}

export const FileExplorerRow = ({
  row
}:{
  row: any
}) => {
  return (<div className="h-6 flex flex-row"
               onClick={()=>{row.rowClicked()} }
          >
    {Spacer(row.level)}
    <CustomIcon
      name={row.icon}
      className="inline-block w-4 text-current mr-1"
    />
    <span className="overflow-hidden whitespace-nowrap text-ellipsis">{row.name}</span>
    <div className="ml-auto">
    {row.status}
    </div>
  </div>)
}
