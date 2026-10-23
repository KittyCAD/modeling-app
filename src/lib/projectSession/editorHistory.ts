import type { EditorState } from '@codemirror/state'
import { HistoryView } from '@src/editor/HistoryView'
import { fsHistoryExtension } from '@src/editor/plugins/fs'
import { zookeeperHistoryExtension } from '@src/lib/zookeeper/editorPlugin'

/** Project undo history survives file editor replacement and ends with the project. */
export class ProjectEditorHistory {
  readonly view = new HistoryView([
    fsHistoryExtension(),
    zookeeperHistoryExtension(),
  ])
  readonly files = new Map<string, EditorState>()

  dispose() {
    this.files.clear()
    this.view.destroy()
  }
}
