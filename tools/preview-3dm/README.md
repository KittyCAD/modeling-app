The browser worker uses this adapter to read binary 3DM archives and pass their trimmed faces to the Rust preview tessellator. Its build inputs are McNeel’s public OpenNURBS repository, the nlohmann/json single header and the Emscripten toolchain. CMake pins the source revision and header checksum.

From the modeling-app root, with Emscripten 4.0.21 activated:

```sh
emcmake cmake -S tools/preview-3dm -B /tmp/zds-3dm-reader -G 'Unix Makefiles' -DCMAKE_BUILD_TYPE=MinSizeRel
cmake --build /tmp/zds-3dm-reader --target reader --parallel
cp /tmp/zds-3dm-reader/reader.{mjs,wasm} public/preview-rhino/
```

Control points are converted to metres. Trim curves stay in surface parameter space. Where OpenNURBS reports that converting the surface to NURBS changes its parameterization, the adapter samples each trim span and maps its points into the new parameter space. This approximation is for preview tessellation.
