# Zoo KCL for Visual Studio Code

This extension provides Zoo KCL (`.kcl` files) language support in Visual
Studio Code using `kcl-language-server`.

Install the published extension from the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=KittyCAD.kcl-language-server).

The Rust language server source lives in the sibling `kcl-lsp-server`
directory. Release builds bundle its platform-specific executable into the
extension package.

## Development

```bash
npm install
npm run build
npm run test-compile
npm test
```

To debug the extension, open this directory in Visual Studio Code and launch
the extension development host. If the compiled extension cannot be found,
run `npm run compile` first.
