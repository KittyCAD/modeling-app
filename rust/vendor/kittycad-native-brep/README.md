Temporary vendored copy of `native-brep` from KittyCAD/format at
`1db7c8e9504b99f3850d80a12a07db2153a2d836`.

Vercel cannot fetch the private Format repository. This copy lets the preview
build without Git credentials until `kittycad-native-brep` is published.
Only application Rust formatting and removal of the standalone `[workspace]`
declaration have been applied; the contract and fixtures are unchanged.

Make contract changes in Format and refresh this copy rather than editing it
independently. Once the package is published, replace the path dependency in
`display-tessellation/Cargo.toml` with its version and delete this directory.
