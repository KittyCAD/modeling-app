import * as assert from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { suite, suiteSetup, test } from 'mocha'
import * as vscode from 'vscode'

// The extension starts the server binary named by __KCL_LSP_SERVER_DEBUG, which
// `getServer` in bootstrap.ts reads before any other source. A dev checkout has
// no bundled binary, so without the variable these tests are skipped rather than
// failed. Build one with `cargo build -p kcl-language-server` and point the
// variable at `rust/target/debug/kcl-language-server`.
const serverPath = process.env['__KCL_LSP_SERVER_DEBUG']

const EXTENSION_ID = 'kittycad.kcl-language-server'

// Launching VS Code, activating the extension and starting the server together
// take longer than mocha's default timeout.
const SETUP_TIMEOUT_MS = 60_000
const DIAGNOSTIC_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 250

const ENUM_DECLARATION = 'type Color { | Red }\n'
const ENUM_DECLARATION_MESSAGE = 'Use of enum declarations is experimental'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/// Write `code` to a KCL file in its own temporary directory and open it in the
/// editor, returning the file's URI.
///
/// Opening the first KCL document is also what starts the language client. The
/// extension activates on `onLanguage:kcl` and its `Ctx` reads the workspace
/// once, at construction; with no KCL document open that workspace is `Empty`
/// and `getOrCreateClient` returns without creating a client. Activating the
/// extension before opening a document therefore leaves no server running.
async function openKclDocument(code: string): Promise<vscode.Uri> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcl-lsp-diagnostics-'))
  const uri = vscode.Uri.file(path.join(dir, 'main.kcl'))
  fs.writeFileSync(uri.fsPath, code)

  const document = await vscode.workspace.openTextDocument(uri)
  await vscode.window.showTextDocument(document)

  const extension = vscode.extensions.getExtension(EXTENSION_ID)
  assert.ok(extension, 'the extension is not installed in this VS Code')
  await extension.activate()

  return uri
}

/// Wait until the document has at least one diagnostic, and return them.
/// Returns an empty array if none arrive before the timeout.
///
/// The counts asserted below are exact. They are only exact because the server
/// reports diagnostics through one channel: it pushes
/// `textDocument/publishDiagnostics` and does not advertise pull diagnostics.
/// Advertising both makes the client keep a collection per channel, which
/// `getDiagnostics` merges, and every diagnostic arrives twice.
async function waitForDiagnostics(
  uri: vscode.Uri
): Promise<vscode.Diagnostic[]> {
  const deadline = Date.now() + DIAGNOSTIC_TIMEOUT_MS
  let diagnostics = vscode.languages.getDiagnostics(uri)
  while (diagnostics.length === 0 && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    diagnostics = vscode.languages.getDiagnostics(uri)
  }
  return diagnostics
}

suite('KCL language server diagnostics', function () {
  this.timeout(SETUP_TIMEOUT_MS + DIAGNOSTIC_TIMEOUT_MS)

  suiteSetup(function () {
    if (!serverPath) {
      this.skip()
    }
  })

  // An enum declaration without `@settings(experimentalFeatures = allow)` raises
  // an Error-severity issue during parsing. The issue is not fatal, so the pass
  // continues to the end, and the pass used to clear every Error diagnostic once
  // it got there. That discarded this one before the editor saw it.
  test('an Error-severity parse issue reaches the editor', async () => {
    const uri = await openKclDocument(ENUM_DECLARATION)

    const diagnostics = await waitForDiagnostics(uri)

    // Two tsconfigs cover this file and they disagree on
    // `noUncheckedIndexedAccess`: `rust/kcl-language-server/tsconfig.json`
    // sets it on through `@tsconfig/strictest`, and the repository root config
    // leaves it off. Asserting that the element is present narrows the type
    // under the first config and compiles under the second, whereas
    // `diagnostics[0]!` is rejected by the root config as an unnecessary
    // assertion.
    const [diagnostic] = diagnostics
    assert.ok(diagnostic, 'expected one diagnostic, got none')
    assert.strictEqual(
      diagnostics.length,
      1,
      `expected one diagnostic, got ${JSON.stringify(diagnostics)}`
    )
    assert.strictEqual(diagnostic.severity, vscode.DiagnosticSeverity.Error)
    assert.ok(
      diagnostic.message.includes(ENUM_DECLARATION_MESSAGE),
      `unexpected message: ${diagnostic.message}`
    )
  })

  // The other half of the same pass. A document that raises nothing must end
  // with no diagnostics, so the test above cannot be satisfied by a server that
  // has stopped clearing anything at all.
  //
  // The erroring document is opened alongside the clean one and waited on first.
  // Without it, an empty result would equally mean the server never processed
  // the file.
  test('a clean document reaches the editor with no diagnostics', async () => {
    const cleanUri = await openKclDocument('x = 1\n')
    const erroringUri = await openKclDocument(ENUM_DECLARATION)

    assert.strictEqual(
      (await waitForDiagnostics(erroringUri)).length,
      1,
      'the server did not process the erroring document, so the clean result proves nothing'
    )

    assert.deepStrictEqual(
      vscode.languages.getDiagnostics(cleanUri),
      [],
      `expected no diagnostics, got ${JSON.stringify(vscode.languages.getDiagnostics(cleanUri))}`
    )
  })
})
