## GLB CPU Renderer
This crate makes images of Zoo GLB exports, primarily for visual diffing purposes.

We use the zoo fork of gltf-rs to read our BREP extension included in the file.
The NURBS edges are discretized into polylines in `sampling.rs`. `lib.rs` frames the model and draws the picture on a transparent background.

More rendering options and modes will be introduced as needed.

## Crate CLI
The crate includes a binary you can run.
```sh
cargo run -p glb-render --bin glb-render -- model.glb 1024 1024
```
Will yield 2 images.
- x-ray view of NURBS edges only
- solid view with face colors and silhouette lines

silhouette lines are in green to distinguish them from brep edges, which are blue.

## Users
- KCL lib tests
- Zoo CLI
