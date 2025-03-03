# Rust Crates

### Releasing

1. Make sure your working directory is this directory.
1. Bump the versions of the crates:
    ```bash
    just bump-kcl-crate-versions 
    ```
3. Commit the changes:
    ```bash
    git add .
    git commit -m "Bump versions"
    ```
4. Push the changes and get your PR approved.
5. Publish the crates:
    ```bash
    just publish-kcl {version}
    ```
    - This will publish the relevant crates and push a new tag with the prefix
    `kcl-`. DO NOT SET THE PREFIX TO `kcl-` when you run the command. The `just`
    command will do that for you.
    - The tag will then trigger the release of kcl-python-bindings.
