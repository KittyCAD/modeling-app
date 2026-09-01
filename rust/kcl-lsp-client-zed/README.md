# Zoo KCL for Zed

This Zed extension provides language support for Zoo KCL (`.kcl` files):

- syntax highlighting and editor behavior from `tree-sitter-kcl`
- diagnostics, completion, hover, formatting, and other language features from
  `kcl-language-server`

The extension uses `kcl-language-server` from `PATH` when available. Otherwise,
it downloads the latest compatible binary from the modeling-app GitHub releases.

## Development

In Zed, run `zed: install dev extension` and select this directory. Open a
`.kcl` file and use the language-server status menu to inspect server logs.

The Rust language server source lives in the sibling `kcl-lsp-server`
directory.

To use a locally built server, add this to Zed's settings and replace the path:

```json
{
  "lsp": {
    "kcl-language-server": {
      "binary": {
        "path": "/path/to/modeling-app/rust/target/debug/kcl-language-server"
      }
    }
  }
}
```
