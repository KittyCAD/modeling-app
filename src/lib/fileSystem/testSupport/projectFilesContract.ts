import { FileNotFound } from '@src/lib/fileSystem/fileOperations'
import {
  collectProjectFiles as collectProjectFilesWithFileOperations,
  collectProjectFilesForUpload,
} from '@src/lib/fileSystem/projectFiles'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

export interface ProjectFilesFixture {
  readonly fs: IZooDesignStudioFS
  readonly root: string
  readonly operations: FileOperationsRegistryService
  readonly dispose: () => Promise<void>
}

/** Shared project-collection behavior; each caller supplies its actual storage. */
export function projectFilesContract(
  name: string,
  create: () => Promise<ProjectFilesFixture>
) {
  describe(name, () => {
    let fixture: ProjectFilesFixture
    let fs: IZooDesignStudioFS
    let operations: FileOperationsRegistryService

    beforeEach(async () => {
      fixture = await create()
      fs = fixture.fs
      operations = fixture.operations
    })
    afterEach(async () => {
      await fixture?.dispose()
    })

    const collectProjectFiles = (
      args: Omit<
        Parameters<typeof collectProjectFilesWithFileOperations>[0],
        'fileOperations'
      >
    ) =>
      collectProjectFilesWithFileOperations({
        ...args,
        fileOperations: operations,
      })

    it('collects project files and excludes .gitignore patterns', async () => {
      const projectPath = fixture.root
      await fs.mkdir(fs.join(projectPath, '.hidden-dir'), {
        recursive: true,
      })
      await fs.mkdir(fs.join(projectPath, 'dist'), { recursive: true })
      await fs.writeFile(
        fs.join(projectPath, 'main.kcl'),
        new TextEncoder().encode('cube()')
      )
      await fs.writeFile(
        fs.join(projectPath, 'notes.txt'),
        new TextEncoder().encode('notes')
      )
      await fs.writeFile(
        fs.join(projectPath, 'project.toml'),
        new TextEncoder().encode('[settings.app]')
      )
      await fs.writeFile(
        fs.join(projectPath, '.gitignore'),
        new TextEncoder().encode('dist\nnotes.txt\n.hidden-dir/\n')
      )
      await fs.writeFile(
        fs.join(projectPath, '.hidden-dir', 'secret.txt'),
        new TextEncoder().encode('secret')
      )
      await fs.writeFile(
        fs.join(projectPath, 'dist', 'ignored.kcl'),
        new TextEncoder().encode('ignored = 1')
      )

      try {
        const projectFiles = await collectProjectFiles({
          selectedFileContents: 'cube()',
          fileNames: {
            0: {
              type: 'Local',
              value: fs.join(projectPath, 'main.kcl'),
              original_import_path: null,
            },
          },
          projectContext: {
            name: 'zookeeper-project',
            path: projectPath,
            children: [
              {
                name: 'main.kcl',
                path: fs.join(projectPath, 'main.kcl'),
                children: null,
              },
            ],
            metadata: null,
            kcl_file_count: 1,
            directory_count: 0,
            default_file: fs.join(projectPath, 'main.kcl'),
            readWriteAccess: true,
          },
        })

        expect(projectFiles.map((file) => file.relPath).sort()).toEqual([
          '.gitignore',
          'main.kcl',
          'project.toml',
        ])
        await fs.mkdir(fs.join(projectPath, '.git'))
        await fs.writeFile(
          fs.join(projectPath, '.git', 'HEAD'),
          new TextEncoder().encode('internal')
        )
        const upload = await collectProjectFilesForUpload({
          fileOperations: operations,
          projectRoot: projectPath,
        })
        expect(upload.map((file) => file.relativePath)).toEqual(
          projectFiles.map((file) => file.relPath).sort()
        )
      } finally {
        await fs.rm(projectPath, { recursive: true, force: true })
      }
    })

    it.each([undefined, false])(
      'handles a file removed after directory listing with skipUnreadableFiles=%s',
      async (skipUnreadableFiles) => {
        const projectPath = fixture.root
        const mainPath = fs.join(projectPath, 'main.kcl')
        const removedPath = fs.join(projectPath, 'project.toml.crswap')
        await fs.mkdir(projectPath, { recursive: true })

        try {
          await fs.writeFile(mainPath, new TextEncoder().encode('height = 10'))
          await fs.writeFile(
            fs.join(projectPath, 'notes.txt'),
            new TextEncoder().encode('project notes')
          )
          await fs.writeFile(removedPath, new TextEncoder().encode('temporary'))
          const projectFiles = collectProjectFilesWithFileOperations({
            fileOperations: {
              ...operations,
              readDirectory: async (path) => {
                const entries = await operations.readDirectory(path)
                if (path === projectPath) {
                  await operations.remove(removedPath)
                }
                return entries
              },
            },
            selectedFileContents: 'height = 10',
            selectedFilePath: mainPath,
            fileNames: {},
            skipUnreadableFiles,
            projectContext: {
              name: 'zookeeper-project',
              path: projectPath,
              children: [],
              metadata: null,
              kcl_file_count: 1,
              directory_count: 0,
              default_file: mainPath,
              readWriteAccess: true,
            },
          })

          if (skipUnreadableFiles === false) {
            await expect(projectFiles).rejects.toBeInstanceOf(FileNotFound)
          } else {
            const files = await projectFiles
            expect(files.map((file) => file.relPath).sort()).toEqual([
              'main.kcl',
              'notes.txt',
            ])
            expect(
              files.find((file) => file.relPath === 'main.kcl')
            ).toMatchObject({
              type: 'kcl',
              fileContents: 'height = 10',
            })
            expect(
              files.find((file) => file.relPath === 'notes.txt')
            ).toMatchObject({
              type: 'other',
            })
          }
        } finally {
          await fs.rm(projectPath, { recursive: true, force: true })
        }
      }
    )

    it('returns forward-slash relPaths for nested files', async () => {
      // relPath becomes the `current_files` keys and `source_ranges` file paths
      // sent to the ML/Zookeeper service, which keys everything with forward
      // slashes. On Windows fs.relative yields backslashes, so collectProjectFiles
      // must normalize; this guards that posix invariant for nested files.
      const projectPath = fixture.root
      const nestedPath = fs.join(projectPath, 'parts', 'bracket.kcl')
      await fs.mkdir(fs.join(projectPath, 'parts'), { recursive: true })
      await fs.writeFile(
        fs.join(projectPath, 'main.kcl'),
        new TextEncoder().encode('cube()')
      )
      await fs.writeFile(nestedPath, new TextEncoder().encode('bracket = 1'))

      try {
        const projectFiles = await collectProjectFiles({
          selectedFileContents: 'cube()',
          fileNames: {
            0: {
              type: 'Local',
              value: fs.join(projectPath, 'main.kcl'),
              original_import_path: null,
            },
          },
          projectContext: {
            name: 'zookeeper-project',
            path: projectPath,
            children: [
              {
                name: 'main.kcl',
                path: fs.join(projectPath, 'main.kcl'),
                children: null,
              },
            ],
            metadata: null,
            kcl_file_count: 2,
            directory_count: 1,
            default_file: fs.join(projectPath, 'main.kcl'),
            readWriteAccess: true,
          },
        })

        const relPaths = projectFiles.map((file) => file.relPath)
        expect(relPaths).toContain('parts/bracket.kcl')
        for (const relPath of relPaths) {
          expect(relPath).not.toContain('\\')
        }
      } finally {
        await fs.rm(projectPath, { recursive: true, force: true })
      }
    })

    it.each([
      { name: 'after path normalization', hasExecFileNames: true },
      { name: 'when exec filenames are unavailable', hasExecFileNames: false },
    ])('uses live editor contents $name', async ({ hasExecFileNames }) => {
      const projectPath = fixture.root
      const mainPath = fs.join(projectPath, 'main.kcl')
      await fs.mkdir(projectPath, { recursive: true })
      await fs.writeFile(mainPath, new TextEncoder().encode('boxHeight = 50mm'))

      try {
        const projectFiles = await collectProjectFiles({
          selectedFileContents: 'boxHeight = 500mm',
          selectedFilePath: hasExecFileNames
            ? `${projectPath}${fs.sep}.${fs.sep}main.kcl`
            : mainPath,
          fileNames: hasExecFileNames
            ? {
                0: {
                  type: 'Local',
                  value: mainPath,
                  original_import_path: null,
                },
              }
            : {},
          projectContext: {
            name: 'zookeeper-project',
            path: projectPath,
            children: [
              {
                name: 'main.kcl',
                path: mainPath,
                children: null,
              },
            ],
            metadata: null,
            kcl_file_count: 1,
            directory_count: 0,
            default_file: mainPath,
            readWriteAccess: true,
          },
        })

        const mainFile = projectFiles.find(
          (file) => file.relPath === 'main.kcl'
        )
        expect(mainFile).toMatchObject({
          type: 'kcl',
          fileContents: 'boxHeight = 500mm',
          execStateFileNamesIndex: 0,
        })
      } finally {
        await fs.rm(projectPath, { recursive: true, force: true })
      }
    })
  })
}
