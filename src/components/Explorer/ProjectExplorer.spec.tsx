import { ProjectExplorer } from '@src/components/Explorer/ProjectExplorer'
import {
  type FileExplorerEntry,
  addPlaceHoldersForNewFileAndFolder,
} from '@src/components/Explorer/utils'
import type { FileEntry, Project } from '@src/lib/project'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { expect, describe, it, beforeEach, afterEach } from 'vitest'

// Helper functions within this file to create a project and file entries easier to
// populate the unit tests
const projectName = 'project-001'
const applicationDirectory = 'applicationDirectory'

// Actual wasmInstance not used by these tests, only when drag and dropping external files,
// so no real wasmInstance used here as it would make these tests unnecessarily heavier -
const wasmInstance = {} as ModuleType
const createFile = (name: string, parent?: string): FileEntry => {
  return {
    name: name,
    path: `/${applicationDirectory}/${projectName}/${parent}${name}`,
    children: null,
  }
}
const createFolder = (name: string, children?: FileEntry[]): FileEntry => {
  return {
    name: name,
    path: `/${applicationDirectory}/${projectName}/${name}`,
    children: children || [],
  }
}
const oneFile: FileEntry = createFile('main.kcl')
const PROJECT_TEMPLATE: Project = {
  metadata: null,
  kcl_file_count: 0,
  directory_count: 0,
  default_file: `${applicationDirectory}/${projectName}/main.kcl`,
  path: `${applicationDirectory}/${projectName}`,
  name: projectName,
  children: [],
  readWriteAccess: true,
}
let project: Project = PROJECT_TEMPLATE

describe('ProjectExplorer', () => {
  beforeEach(() => {
    // reset the project before each test
    project = JSON.parse(JSON.stringify(PROJECT_TEMPLATE))
  })
  afterEach(() => {
    cleanup()
  })
  it('should render no rows', () => {
    render(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={-1}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )
    const container = screen.getByTestId('file-explorer')
    expect(container.childNodes.length).toBe(0)
  })
  it('should render one file', () => {
    project.children = [oneFile]
    render(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={-1}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )
    const container = screen.getByTestId('file-explorer')
    const file = screen.getByTestId('file-tree-item')
    expect(container.childNodes.length).toBe(1)
    expect(file.innerText).toBe('main.kcl')
  })
  it('should render two files A-Z', () => {
    project.children = [createFile('main.kcl'), createFile('dog.kcl')]
    render(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={-1}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )
    const container = screen.getByTestId('file-explorer')
    const file = screen.getAllByTestId('file-tree-item')
    expect(container.childNodes.length).toBe(2)
    expect(file.length).toBe(2)
    expect(file[0].innerText).toBe('dog.kcl')
    expect(file[1].innerText).toBe('main.kcl')
  })
  it('should render one folder', () => {
    project.children = [createFolder('parts')]
    render(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={-1}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )
    const container = screen.getByTestId('file-explorer')
    const items = screen.getAllByTestId('file-tree-item')
    expect(container.childNodes.length).toBe(1)
    expect(items.length).toBe(1)
    expect(items[0].innerText).toBe('parts')
  })
  it('should render one folder with one hidden file', () => {
    const mainFile = createFile('main.kcl')
    project.children = [createFolder('parts', [mainFile])]
    render(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={-1}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )
    const container = screen.getByTestId('file-explorer')
    const items = screen.getAllByTestId('file-tree-item')
    expect(container.childNodes.length).toBe(1)
    expect(items.length).toBe(1)
    expect(items[0].innerText).toBe('parts')
  })
  it('should render nested main.kcl file on load since it is the loaded file. All folders above opened.', () => {
    const mainFile = createFile('main.kcl', 'parts/')
    project.children = [createFolder('parts', [mainFile])]
    addPlaceHoldersForNewFileAndFolder(project.children, project.path)
    render(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={mainFile}
        createFilePressed={-1}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
        overrideApplicationProjectDirectory="applicationDirectory/"
      />
    )
    const container = screen.getByTestId('file-explorer')
    const items = screen.getAllByTestId('file-tree-item')
    expect(container.childNodes.length).toBe(2)
    expect(items.length).toBe(2)
    expect(items[0].innerText).toBe('parts')
    expect(items[1].innerText).toBe('main.kcl')
  })
  it('should render main.kcl on initialization within 3 nested folders', () => {
    const mainFile = createFile('main.kcl', 'parts/very/cool/')
    project.children = [
      createFolder('parts', [
        createFolder('very', [createFolder('cool', [mainFile])]),
      ]),
    ]
    addPlaceHoldersForNewFileAndFolder(project.children, project.path)
    render(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={mainFile}
        createFilePressed={-1}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
        overrideApplicationProjectDirectory="applicationDirectory/"
      />
    )
    const container = screen.getByTestId('file-explorer')
    const items = screen.getAllByTestId('file-tree-item')
    expect(container.childNodes.length).toBe(4)
    expect(items.length).toBe(4)
    expect(items[0].innerText).toBe('parts')
    expect(items[1].innerText).toBe('very')
    expect(items[2].innerText).toBe('cool')
    expect(items[3].innerText).toBe('main.kcl')
  })
  it('should render a folder then render the file when the folder is clicked', () => {
    const mainFile = createFile('main.kcl')
    project.children = [createFolder('parts', [mainFile])]
    const { getByText } = render(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={-1}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )
    const container = screen.getByTestId('file-explorer')

    let items = screen.getAllByTestId('file-tree-item')
    expect(container.childNodes.length).toBe(1)
    expect(items.length).toBe(1)
    expect(items[0].innerText).toBe('parts')

    fireEvent.click(getByText('parts'))

    items = screen.getAllByTestId('file-tree-item')
    expect(items.length).toBe(2)
    expect(items[0].innerText).toBe('parts')
    expect(items[1].innerText).toBe('main.kcl')
  })
  it('should open and close a single folder with 1 file', () => {
    const mainFile = createFile('main.kcl')
    project.children = [createFolder('parts', [mainFile])]
    const { getByText } = render(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={-1}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )
    const container = screen.getByTestId('file-explorer')

    let items = screen.getAllByTestId('file-tree-item')
    expect(container.childNodes.length).toBe(1)
    expect(items.length).toBe(1)
    expect(items[0].innerText).toBe('parts')

    fireEvent.click(getByText('parts'))

    items = screen.getAllByTestId('file-tree-item')
    expect(items.length).toBe(2)
    expect(items[0].innerText).toBe('parts')
    expect(items[1].innerText).toBe('main.kcl')

    fireEvent.click(getByText('parts'))

    items = screen.getAllByTestId('file-tree-item')
    expect(items.length).toBe(1)
    expect(items[0].innerText).toBe('parts')
  })
  it('should collapse all folders which will hide one file and show one folder', () => {
    const mainFile = createFile('main.kcl')
    project.children = [createFolder('parts', [mainFile])]
    const { getByText, rerender } = render(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={-1}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )
    const container = screen.getByTestId('file-explorer')

    let items = screen.getAllByTestId('file-tree-item')
    expect(container.childNodes.length).toBe(1)
    expect(items.length).toBe(1)
    expect(items[0].innerText).toBe('parts')

    fireEvent.click(getByText('parts'))

    items = screen.getAllByTestId('file-tree-item')
    expect(items.length).toBe(2)
    expect(items[0].innerText).toBe('parts')
    expect(items[1].innerText).toBe('main.kcl')

    // collapsePressed since a new time stamp came in!
    rerender(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={-1}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={performance.now()}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )

    items = screen.getAllByTestId('file-tree-item')
    expect(items.length).toBe(1)
    expect(items[0].innerText).toBe('parts')
  })
  it('should render a placefolder for a file when create file is pressed', () => {
    const mainFile = createFile('main.kcl')
    project.children = [createFolder('parts', [mainFile])]
    addPlaceHoldersForNewFileAndFolder(project.children, project.path)
    const { rerender } = render(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={-1}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )
    const container = screen.getByTestId('file-explorer')

    let items = screen.getAllByTestId('file-tree-item')
    expect(container.childNodes.length).toBe(1)
    expect(items.length).toBe(1)
    expect(items[0].innerText).toBe('parts')

    rerender(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={performance.now()}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )

    items = screen.getAllByTestId('file-tree-item')
    expect(items.length).toBe(2)
    expect(items[0].innerText).toBe('parts')

    const renameField = screen.getByTestId('file-rename-field')
    expect(renameField.innerText).toBe('')
  })
  it('should render a placefolder for a folder when create folder is pressed', () => {
    const mainFile = createFile('main.kcl')
    project.children = [createFolder('parts', [mainFile])]
    addPlaceHoldersForNewFileAndFolder(project.children, project.path)
    const { rerender } = render(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={-1}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )
    const container = screen.getByTestId('file-explorer')

    let items = screen.getAllByTestId('file-tree-item')
    expect(container.childNodes.length).toBe(1)
    expect(items.length).toBe(1)
    expect(items[0].innerText).toBe('parts')

    rerender(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={-1}
        createFolderPressed={performance.now()}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )

    items = screen.getAllByTestId('file-tree-item')
    expect(items.length).toBe(2)
    // The folder is shifted down because placeholders always render to the top of the correct tree level it is in.
    expect(items[1].innerText).toBe('parts')

    const renameField = screen.getByTestId('file-rename-field')
    expect(renameField.innerText).toBe('')
  })
  it('should press create file, press create folder, press create file', () => {
    /**
     * This test would create a file see the placeholder, the user would create a folder
     * so in place it would update to be create a folder workflow even though no create file was made
     * then we click create file again to swap from folder to file.
     * e.g. When you create your input field will always put up no matter what and the other one will hide
     */
    const mainFile = createFile('main.kcl')
    project.children = [createFolder('parts', [mainFile])]
    addPlaceHoldersForNewFileAndFolder(project.children, project.path)

    const { rerender } = render(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={-1}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )
    const container = screen.getByTestId('file-explorer')
    let items = screen.getAllByTestId('file-tree-item')
    expect(container.childNodes.length).toBe(1)
    expect(items.length).toBe(1)
    expect(items[0].innerText).toBe('parts')
    rerender(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={performance.now()}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )
    items = screen.getAllByTestId('file-tree-item')
    expect(items.length).toBe(2)
    expect(items[0].innerText).toBe('parts')
    let renameField = screen.getByTestId('file-rename-field')
    expect(renameField.innerText).toBe('')
    rerender(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={-1}
        createFolderPressed={performance.now()}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )
    items = screen.getAllByTestId('file-tree-item')
    expect(items.length).toBe(2)
    expect(items[1].innerText).toBe('parts')
    renameField = screen.getByTestId('file-rename-field')
    expect(renameField.innerText).toBe('')
    rerender(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={performance.now()}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )
    items = screen.getAllByTestId('file-tree-item')
    expect(items.length).toBe(2)
    expect(items[0].innerText).toBe('parts')
    renameField = screen.getByTestId('file-rename-field')
    expect(renameField.innerText).toBe('')
  })
  it('should open parent folder, open child folder, close parent, then open parent, to see child open.', () => {
    /**
     * Whenever you open any folder it will stay open until you close it. When you close a parent it is hidden but it is still open behind the scenes.
     * This allows you to save the state of the visibility when you open or close a parent folder and the children are already opened.
     */
    const mainFile = createFile('main.kcl', 'parts/very/cool/')
    project.children = [
      createFolder('parts', [
        createFolder('very', [createFolder('cool', [mainFile])]),
      ]),
    ]
    addPlaceHoldersForNewFileAndFolder(project.children, project.path)
    // file={oneFile} is purposefully mismatched to not open these folders on initialization
    const { getByText } = render(
      <ProjectExplorer
        wasmInstance={wasmInstance}
        project={project}
        file={oneFile}
        createFilePressed={-1}
        createFolderPressed={-1}
        refreshExplorerPressed={-1}
        collapsePressed={-1}
        onRowClicked={(row: FileExplorerEntry, index: number) => {}}
        onRowEnter={(row: FileExplorerEntry, index: number) => {}}
        readOnly={false}
        canNavigate={true}
      />
    )
    const container = screen.getByTestId('file-explorer')
    let items = screen.getAllByTestId('file-tree-item')
    expect(container.childNodes.length).toBe(1)
    expect(items.length).toBe(1)
    expect(items[0].innerText).toBe('parts')
    fireEvent.click(getByText('parts'))
    items = screen.getAllByTestId('file-tree-item')
    expect(items.length).toBe(2)
    expect(items[0].innerText).toBe('parts')
    expect(items[1].innerText).toBe('very')
    fireEvent.click(getByText('very'))
    items = screen.getAllByTestId('file-tree-item')
    expect(items.length).toBe(3)
    expect(items[0].innerText).toBe('parts')
    expect(items[1].innerText).toBe('very')
    expect(items[2].innerText).toBe('cool')
    fireEvent.click(getByText('parts'))
    items = screen.getAllByTestId('file-tree-item')
    expect(items.length).toBe(1)
    expect(items[0].innerText).toBe('parts')
    fireEvent.click(getByText('parts'))
    items = screen.getAllByTestId('file-tree-item')
    expect(items.length).toBe(3)
    expect(items[0].innerText).toBe('parts')
    expect(items[1].innerText).toBe('very')
    expect(items[2].innerText).toBe('cool')
  })
})
