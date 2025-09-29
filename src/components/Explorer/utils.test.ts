import {
  addPlaceHoldersForNewFileAndFolder,
  copyPasteSourceAndTarget,
  getUniqueCopyPath,
  isRowFake,
  shouldDroppedEntryBeMoved,
} from '@src/components/Explorer/utils'
import type { FileExplorerEntry } from '@src/components/Explorer/utils'
import type { FileEntry } from '@src/lib/project'

describe('Explorer utils.ts', () => {
  describe('isRowFake', () => {
    describe('when row is a file with fake placeholder name', () => {
      it('should be fake', () => {
        const expected = true
        const file: FileExplorerEntry = {
          path: '/home/kevin/zoo/test-project/.zoo-placeholder-file.kcl',
          name: '.zoo-placeholder-file.kcl',
          children: null,
          parentPath: '/home/kevin/zoo/test-project',
          level: 0,
          index: 0,
          key: '/home/kevin/zoo/test-project/.zoo-placeholder-file.kcl',
          setSize: 1,
          positionInSet: 1,
        }
        const actual = isRowFake(file)
        expect(expected).toBe(actual)
      })
    })
    describe('when row is a file with a real placeholder name', () => {
      it('should not be fake', () => {
        const expected = false
        const file: FileExplorerEntry = {
          path: '/home/kevin/zoo/test-project/main.kcl',
          name: 'main.kcl',
          children: null,
          parentPath: '/home/kevin/zoo/test-project',
          level: 0,
          index: 0,
          key: '/home/kevin/zoo/test-project/main.kcl',
          setSize: 1,
          positionInSet: 1,
        }
        const actual = isRowFake(file)
        expect(expected).toBe(actual)
      })
    })
  })
  describe('when row is a folder with a fake placeholder name', () => {
    it('should be fake', () => {
      const expected = true
      const folder: FileExplorerEntry = {
        path: '/home/kevin/zoo/test-project/.zoo-placeholder-folder',
        name: '.zoo-placeholder-folder',
        children: [],
        parentPath: '/home/kevin/zoo/test-project',
        level: 0,
        index: 0,
        key: '/home/kevin/zoo/test-project/.zoo-placeholder-folder',
        setSize: 1,
        positionInSet: 1,
      }
      const actual = isRowFake(folder)
      expect(expected).toBe(actual)
    })
  })
  describe('when row is a folder with a real placeholder name', () => {
    it('should not be fake', () => {
      const expected = false
      const folder: FileExplorerEntry = {
        path: '/home/kevin/zoo/test-project/part001',
        name: 'part001',
        children: [],
        parentPath: '/home/kevin/zoo/test-project',
        level: 0,
        index: 0,
        key: '/home/kevin/zoo/test-project/part001',
        setSize: 1,
        positionInSet: 1,
      }
      const actual = isRowFake(folder)
      expect(expected).toBe(actual)
    })
  })

  describe('addPlaceHoldersForNewFileAndFolder', () => {
    describe('when children is null', () => {
      it('should immediately return', () => {
        const expectedResult = undefined
        const children = null
        const parentPath = 'test-project'
        const actual = addPlaceHoldersForNewFileAndFolder(children, parentPath)

        expect(actual).toBe(expectedResult)
        expect(children).toBe(null)
      })
    })
    describe('when children is empty array', () => {
      it('should place two placeholder files', () => {
        const expectedResult = undefined
        const parentPath = 'test-project'
        const expectedList = [
          {
            path: `/${parentPath}/.zoo-placeholder-folder`,
            name: '.zoo-placeholder-folder',
            children: [],
          },
          {
            path: `/${parentPath}/.zoo-placeholder-file.kcl`,
            name: '.zoo-placeholder-file.kcl',
            children: null,
          },
        ]
        const children: FileEntry[] = []
        const actual = addPlaceHoldersForNewFileAndFolder(children, parentPath)
        expect(actual).toBe(expectedResult)
        expect(children).toStrictEqual(expectedList)
      })
    })
    describe('when children has a file and folder', () => {
      it('should place four placeholder files', () => {
        const expectedResult = undefined
        const parentPath = 'test-project'
        const expectedList = [
          {
            path: `/${parentPath}/.zoo-placeholder-folder`,
            name: '.zoo-placeholder-folder',
            children: [],
          },
          {
            path: `/${parentPath}/part001`,
            name: 'part001',
            children: [
              {
                path: `/${parentPath}/part001/.zoo-placeholder-folder`,
                name: '.zoo-placeholder-folder',
                children: [],
              },
              {
                path: `/${parentPath}/part001/.zoo-placeholder-file.kcl`,
                name: '.zoo-placeholder-file.kcl',
                children: null,
              },
            ],
          },
          {
            path: `/${parentPath}/main.kcl`,
            name: 'main.kcl',
            children: null,
          },
          {
            path: `/${parentPath}/.zoo-placeholder-file.kcl`,
            name: '.zoo-placeholder-file.kcl',
            children: null,
          },
        ]
        const children: FileEntry[] = [
          {
            path: `/${parentPath}/part001`,
            name: 'part001',
            children: [],
          },
          {
            path: `/${parentPath}/main.kcl`,
            name: 'main.kcl',
            children: null,
          },
        ]
        const actual = addPlaceHoldersForNewFileAndFolder(children, parentPath)
        expect(actual).toBe(expectedResult)
        expect(children).toStrictEqual(expectedList)
      })
    })
  })
  describe('copyPasteSourceAndTarget', () => {
    it('should copy folder to folder without collision as -copy-1', () => {
      const identifier = '-copy-'
      const expected = '/my/really/cool/path/project-001/parts-copy-1'
      const actual = getUniqueCopyPath(
        [
          '/my/really/cool/path/project-001/parts',
          '/my/really/cool/path/project-001/parts-old',
          '/my/really/cool/path/project-001/parts-new',
        ],
        '/my/really/cool/path/project-001/parts',
        identifier,
        false
      )
      expect(actual).toBe(expected)
    })
    it('should copy folder to folder without collision as -copy-2', () => {
      const identifier = '-copy-'
      const expected = '/my/really/cool/path/project-001/parts-copy-2'
      const actual = getUniqueCopyPath(
        [
          '/my/really/cool/path/project-001/parts',
          '/my/really/cool/path/project-001/parts-copy-1',
          '/my/really/cool/path/project-001/parts-old',
          '/my/really/cool/path/project-001/parts-new',
        ],
        '/my/really/cool/path/project-001/parts',
        identifier,
        false
      )
      expect(actual).toBe(expected)
    })
    it('should copy folder to folder without collision as -copy-3', () => {
      const identifier = '-copy-'
      const expected = '/my/really/cool/path/project-001/parts-copy-3'
      const actual = getUniqueCopyPath(
        [
          '/my/really/cool/path/project-001/parts',
          '/my/really/cool/path/project-001/parts-copy-1',
          '/my/really/cool/path/project-001/parts-copy-2',
          '/my/really/cool/path/project-001/parts-copy-5',
          '/my/really/cool/path/project-001/parts-old',
          '/my/really/cool/path/project-001/parts-new',
        ],
        '/my/really/cool/path/project-001/parts',
        identifier,
        false
      )
      expect(actual).toBe(expected)
    })
    it('should copy folder to folder without collisions but you have -copy-1 at the end do not get tricked', () => {
      const identifier = '-copy-'
      const expected = '/my/really/cool/path/project-001/parts-copy-1-copy-1'
      const actual = getUniqueCopyPath(
        [
          '/my/really/cool/path/project-001/parts',
          '/my/really/cool/path/project-001/parts-copy-1',
          '/my/really/cool/path/project-001/parts-copy-2',
          '/my/really/cool/path/project-001/parts-copy-5',
          '/my/really/cool/path/project-001/parts-old',
          '/my/really/cool/path/project-001/parts-new',
        ],
        '/my/really/cool/path/project-001/parts-copy-1-copy-1',
        identifier,
        false
      )
      expect(actual).toBe(expected)
    })
    it('should copy folder into folder with multiple -copy-1 prefixes but it is properly labelled', () => {
      const identifier = '-copy-'
      const expected =
        '/my/really/cool/path/project-001/parts-copy-1-copy-1-copy-1'
      const actual = getUniqueCopyPath(
        [
          '/my/really/cool/path/project-001/parts',
          // It is duplicated here thus adding the -copy-1 to the end
          '/my/really/cool/path/project-001/parts-copy-1-copy-1',
          '/my/really/cool/path/project-001/parts-copy-2',
          '/my/really/cool/path/project-001/parts-copy-5',
          '/my/really/cool/path/project-001/parts-old',
          '/my/really/cool/path/project-001/parts-new',
        ],
        // attempting this file path
        '/my/really/cool/path/project-001/parts-copy-1-copy-1',
        identifier,
        false
      )
      expect(actual).toBe(expected)
    })
    describe('extra scenarios', () => {
      it('should copy folder into folder', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/parts'
        const actual = getUniqueCopyPath(
          [],
          '/root/project-001/parts',
          identifier,
          false
        )
        expect(actual).toBe(expected)
      })
      it('should copy file into folder', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/parts/main.kcl'
        const actual = getUniqueCopyPath(
          [],
          '/root/project-001/parts/main.kcl',
          identifier,
          true
        )
        expect(actual).toBe(expected)
      })
      it('should copy file into folder with many files but no collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/parts/main.kcl'
        const actual = getUniqueCopyPath(
          [
            '/root/project-001/parts/a.kcl',
            '/root/project-001/parts/b.kcl',
            '/root/project-001/parts/c.kcl',
            '/root/project-001/parts/d.kcl',
          ],
          '/root/project-001/parts/main.kcl',
          identifier,
          true
        )
        expect(actual).toBe(expected)
      })
      it('should copy file into folder and they have similar name but no collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/parts/dog.kcl'
        const actual = getUniqueCopyPath(
          [
            '/root/project-001/parts/do.kcl',
            '/root/project-001/parts/do.kcl',
            '/root/project-001/parts/dogg.kcl',
            '/root/project-001/parts/doggg.kcl',
            '/root/project-001/parts/d',
            '/root/project-001/parts/do',
            '/root/project-001/parts/dogg',
            '/root/project-001/parts/doggg',
          ],
          '/root/project-001/parts/dog.kcl',
          identifier,
          true
        )
        expect(actual).toBe(expected)
      })
      it('should copy folder into folder and they have similar name but no collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/parts/dog'
        const actual = getUniqueCopyPath(
          [
            '/root/project-001/parts/d',
            '/root/project-001/parts/do',
            '/root/project-001/parts/dogg',
            '/root/project-001/parts/doggg',
            '/root/project-001/parts/d.kcl',
            '/root/project-001/parts/do.kcl',
            '/root/project-001/parts/dogg.kcl',
            '/root/project-001/parts/doggg.kcl',
          ],
          '/root/project-001/parts/dog',
          identifier,
          false
        )
        expect(actual).toBe(expected)
      })
      it('should copy folder into folder and they have similar absolute path names but no collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/dogg/dog'
        const actual = getUniqueCopyPath(
          [
            '/root/project-001/dog/d',
            '/root/project-001/dog/do',
            '/root/project-001/dog/dogg',
            '/root/project-001/dog/doggg',
            '/root/project-001/dog/d.kcl',
            '/root/project-001/dog/do.kcl',
            '/root/project-001/dog/dogg.kcl',
            '/root/project-001/dog/doggg.kcl',
          ],
          '/root/project-001/dogg/dog',
          identifier,
          false
        )
        expect(actual).toBe(expected)
      })
      it('should copy folder into folder and they have similar absolute path names but no collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/dogg/dog'
        const actual = getUniqueCopyPath(
          [
            '/root/project-001/dogg/d',
            '/root/project-001/dogg/do',
            '/root/project-001/dogg/dogg',
            '/root/project-001/dogg/doggg',
            '/root/project-001/dogg/d.kcl',
            '/root/project-001/dogg/do.kcl',
            '/root/project-001/dogg/dogg.kcl',
            '/root/project-001/dogg/doggg.kcl',
          ],
          '/root/project-001/dogg/dog',
          identifier,
          false
        )
        expect(actual).toBe(expected)
      })
      it('should copy folder into folder and the folder name shows up in the path but no collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/dog/dog'
        const actual = getUniqueCopyPath(
          [
            '/root/project-001/dog/d',
            '/root/project-001/dog/do',
            '/root/project-001/dog/dogg',
            '/root/project-001/dog/doggg',
            '/root/project-001/dog/d.kcl',
            '/root/project-001/dog/do.kcl',
            '/root/project-001/dog/dogg.kcl',
            '/root/project-001/dog/doggg.kcl',
          ],
          '/root/project-001/dog/dog',
          identifier,
          false
        )
        expect(actual).toBe(expected)
      })
      it('should copy file into folder', () => {
        const expected = {
          src: '/somefile.kcl',
          target: '/folder/somefile.kcl',
        }

        // Folder structure:
        // |-/folder
        // |   |-a.kcl
        // |  |-b.wtf      <-- target
        // |-somefile.kcl  <-- src
        const actual = copyPasteSourceAndTarget(
          ['/folder/a.kcl', '/folder/b.wtf'],
          ['/somefile.kcl'],
          { path: '/somefile.kcl', name: 'somefile.kcl', children: null },
          { path: '/folder/b.wtf', name: '/folder/b.wtf', children: null },
          '-copy-'
        )

        expect(actual).toStrictEqual(expected)
      })
      it('should copy folder onto itself and make sibling in parent', () => {
        const expected = {
          src: '/root/folder',
          target: '/root/folder-copy-1',
        }

        // Folder structure:
        // |-/root
        // |  |-folder          <-- src & target (same folder)
        // |  |-folder-copy-1   (expected new sibling)
        const actual = copyPasteSourceAndTarget(
          ['/root/folder/a.kcl', '/root/folder/b.kcl'],
          ['/root/folder', '/root/another'],
          { path: '/root/folder', name: 'folder', children: [] },
          { path: '/root/folder', name: 'folder', children: [] },
          '-copy-'
        )

        expect(actual).toStrictEqual(expected)
      })
      it('should copy folder onto file and make sibling in target parent', () => {
        const expected = {
          src: '/a/srcFolder',
          target: '/b/srcFolder-copy-1',
        }

        // Folder structure:
        // |-/a
        // |  |-srcFolder       <-- src
        // |-/b
        // |  |-file.txt        <-- target
        // |  |-srcFolder       (collision to trigger -copy-1)
        const actual = copyPasteSourceAndTarget(
          ['/b/file.txt'],
          ['/b/srcFolder', '/b/file.txt'],
          { path: '/a/srcFolder', name: 'srcFolder', children: [] },
          { path: '/b/file.txt', name: 'file.txt', children: null },
          '-copy-'
        )

        expect(actual).toStrictEqual(expected)
      })
      it('should copy file onto file and make sibling in target parent', () => {
        const expected = {
          src: '/a/srcfile.kcl',
          target: '/b/srcfile-copy-1.kcl',
        }

        // Folder structure:
        // |-/a
        // |  |-srcfile.kcl     <-- src
        // |-/b
        // |  |-target.wtf      <-- target
        // |  |-srcfile.kcl     (collision to trigger -copy-1)
        const actual = copyPasteSourceAndTarget(
          ['/b/target.wtf'],
          ['/b/srcfile.kcl', '/b/target.wtf'],
          { path: '/a/srcfile.kcl', name: 'srcfile.kcl', children: null },
          { path: '/b/target.wtf', name: 'target.wtf', children: null },
          '-copy-'
        )

        expect(actual).toStrictEqual(expected)
      })
    })
    describe('Files with different extensions', () => {
      it('should copy file with .kcl without collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/parts/dog.kcl'
        const actual = getUniqueCopyPath(
          ['/root/project-001/parts/main.kcl'],
          '/root/project-001/parts/dog.kcl',
          identifier,
          true
        )
        expect(actual).toBe(expected)
      })
      it('should copy file with .kcl with collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/parts/dog-copy-1.kcl'
        const actual = getUniqueCopyPath(
          ['/root/project-001/parts/dog.kcl'],
          '/root/project-001/parts/dog-copy-1.kcl',
          identifier,
          true
        )
        expect(actual).toBe(expected)
      })
      it('should copy file with .gltf without collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/parts/dog.gltf'
        const actual = getUniqueCopyPath(
          ['/root/project-001/parts/main.gltf'],
          '/root/project-001/parts/dog.gltf',
          identifier,
          true
        )
        expect(actual).toBe(expected)
      })
      it('should copy file with .gltf with collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/parts/dog-copy-1.gltf'
        const actual = getUniqueCopyPath(
          ['/root/project-001/parts/dog.gltf'],
          '/root/project-001/parts/dog-copy-1.gltf',
          identifier,
          true
        )
        expect(actual).toBe(expected)
      })
    })
    describe('with another identifier than -copy-', () => {
      it('should copy file with .kcl without collision', () => {
        const identifier = 'areallysmalldog'
        const expected = '/root/project-001/parts/dog.kcl'
        const actual = getUniqueCopyPath(
          ['/root/project-001/parts/main.kcl'],
          '/root/project-001/parts/dog.kcl',
          identifier,
          true
        )
        expect(actual).toBe(expected)
      })
      it('should copy file with .kcl with collision', () => {
        const identifier = 'areallysmalldog'
        const expected = '/root/project-001/parts/dog-copy-1.kcl'
        const actual = getUniqueCopyPath(
          ['/root/project-001/parts/dog.kcl'],
          '/root/project-001/parts/dog-copy-1.kcl',
          identifier,
          true
        )
        expect(actual).toBe(expected)
      })
    })
    describe('repeated file extensions', () => {
      it('should copy file with .kcl without collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/parts/dog.kcl'
        const actual = getUniqueCopyPath(
          [
            '/root/project-001/parts/dog.kcl.kcl.kcl.kcl.kcl.kcl',
            '/root/project-001/parts/dog.kcl.kcl',
          ],
          '/root/project-001/parts/dog.kcl',
          identifier,
          true
        )
        expect(actual).toBe(expected)
      })
    })
    describe('shouldDroppedEntryBeMoved', () => {
      it('should not move file into the same parent directory', () => {
        const result = shouldDroppedEntryBeMoved(
          {
            name: 'main.kcl',
            path: '/root/main.kcl',
            children: null,
            parentPath: '/root',
          },
          {
            path: '/root/another.kcl',
            name: 'another.kcl',
            children: null,
            parentPath: '/root',
            level: 0,
            index: 0,
            key: '/root/another.kcl',
            setSize: 1,
            positionInSet: 1,
          }
        )

        expect(result).toEqual(false)
      })
      it('should not move a directory into any of its own descendents', () => {
        const result = shouldDroppedEntryBeMoved(
          {
            name: 'src',
            path: '/root/src',
            children: [],
            parentPath: '/root',
          },
          {
            path: '/root/src/child',
            name: 'child',
            children: [],
            parentPath: '/root/src',
            level: 1,
            index: 0,
            key: '/root/src/child',
            setSize: 1,
            positionInSet: 1,
          }
        )

        expect(result).toEqual(false)
      })
      it('should move a file into a nested directory', () => {
        const result = shouldDroppedEntryBeMoved(
          {
            name: 'main.kcl',
            path: '/root/main.kcl',
            children: null,
            parentPath: '/root',
          },
          {
            path: '/root/folder/nested',
            name: 'nested',
            children: [],
            parentPath: '/root/folder',
            level: 1,
            index: 0,
            key: '/root/folder/nested',
            setSize: 1,
            positionInSet: 1,
          }
        )

        expect(result).toEqual(true)
      })
      it('should move a directory into a sibling directory', () => {
        const result = shouldDroppedEntryBeMoved(
          {
            name: 'src',
            path: '/root/src',
            children: [],
            parentPath: '/root',
          },
          {
            path: '/root/another',
            name: 'another',
            children: [],
            parentPath: '/root',
            level: 0,
            index: 0,
            key: '/root/another',
            setSize: 1,
            positionInSet: 1,
          }
        )

        expect(result).toEqual(true)
      })
    })
  })
})
