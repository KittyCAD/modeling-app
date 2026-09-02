# KCL language server

The `kcl` [Language Server Protocol](https://microsoft.github.io/language-server-protocol)
implementation.

The Rust language-server implementation, its executable, tests, benchmarks,
and VS Code extension live in this crate. It depends on the KCL compiler and
language tooling published as [kcl-lib](https://crates.io/crates/kcl-lib).

## Neovim

You can add the following to your `vim` configuration if you are using `lspconfig`.

This is [@jessfraz's
setup](https://github.com/jessfraz/.vim/blob/master/vimrc#L935).

```vim
if executable('kcl-language-server')
lua << EOF
local lspconfig = require 'lspconfig'
local configs = require 'lspconfig.configs'

if not configs.kcl_lsp then
  configs.kcl_lsp = {
    default_config = {
      cmd = {'kcl-language-server', 'server', '--stdio'},
      filetypes = {'kcl'},
      root_dir = lspconfig.util.root_pattern('.git'),
      single_file_support = true,
    },
    docs = {
      description = [=[
https://github.com/KittyCAD/kcl-lsp
https://kittycad.io

The KittyCAD Language Server Protocol implementation for the KCL language.

To better detect kcl files, the following can be added:


    vim.cmd [[ autocmd BufRead,BufNewFile *.kcl set filetype=kcl ]]

]=],
      default_config = {
        root_dir = [[root_pattern(".git")]],
      },
    }
  }
end

lspconfig.kcl_lsp.setup{}
EOF
else
  echo "You might want to install kcl-language-server: https://github.com/KittyCAD/kcl-lsp/releases"
end
```

## Helix

Add this to your `languages.toml` file. Remember to change `/Users/adamchalmers` to your path.

Note that we don't currently have Treesitter parsers, so there won't be syntax highlighting.

```toml
[[language]]
name = "kcl"
scope = "source.kcl"
injection-regex = "kcl"
file-types = ["kcl"]
comment-tokens = "//"
indent = { tab-width = 2, unit = "  " }
language-servers = [ "kcl-lsp" ]
block-comment-tokens = { start = "/*", end = "*/"}


[language-server.kcl-lsp]
command = "/Users/adamchalmers/kc-repos/kcl-lsp/target/release/kcl-language-server"
args = ["server", "--stdio"]
```

## Development

```bash
cargo build -p kcl-language-server
```

Editor integrations live in the sibling `kcl-lsp-client-vscode` and
`kcl-lsp-client-zed` directories.
