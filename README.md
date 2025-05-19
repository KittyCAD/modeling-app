![Zoo Design Studio](/public/zma-logomark-outlined.png)

# Zoo Design Studio

[zoo.dev/modeling-app](https://zoo.dev/modeling-app)

A CAD application from the future, brought to you by the [Zoo team](https://zoo.dev).

Design Studio is our take on what a modern modelling experience can be. It is applying several lessons learned in the decades since most major CAD tools came into existence:

- All artifacts—including parts and assemblies—should be represented as human-readable code. At the end of the day, your CAD project should be "plain text"
  - This makes version control—which is a solved problem in software engineering—trivial for CAD
- All GUI (or point-and-click) interactions should be actions performed on this code representation under the hood
  - This unlocks a hybrid approach to modeling. Whether you point-and-click as you always have or you write your own KCL code, you are performing the same action in Design Studio
- Everything graphics _has_ to be built for the GPU
  - Most CAD applications have had to retrofit support for GPUs, but our geometry engine is made for GPUs (primarily Nvidia's Vulkan), getting the order of magnitude rendering performance boost with it
- Make the resource-intensive pieces of an application auto-scaling
  - One of the bottlenecks of today's hardware design tools is that they all rely on the local machine's resources to do the hardest parts, which include geometry rendering and analysis. Our geometry engine parallelizes rendering and just sends video frames back to the app (seriously, inspect source, it's just a `<video>` element), and our API will offload analysis as we build it in

We are excited about what a small team of people could build in a short time with our API. We welcome you to try our API, build your own applications, or contribute to ours!

Design Studio is a _hybrid_ user interface for CAD modeling. You can point-and-click to design parts (and soon assemblies), but everything you make is really just [`kcl` code](https://github.com/KittyCAD/kcl-experiments) under the hood. All of your CAD models can be checked into source control such as GitHub and responsibly versioned, rolled back, and more.

The 3D view in Design Studio is just a video stream from our hosted geometry engine. The app sends new modeling commands to the engine via WebSockets, which returns back video frames of the view within the engine.

## Technology

- UI
  - [React](https://react.dev/)
  - [Headless UI](https://headlessui.com/)
  - [TailwindCSS](https://tailwindcss.com/)
  - [XState](https://xstate.js.org/)
- Networking
  - WebSockets (via [KittyCAD TS client](https://github.com/KittyCAD/kittycad.ts))
- Code Editor
  - [CodeMirror](https://codemirror.net/)
  - [Custom WASM LSP Server](https://github.com/KittyCAD/modeling-app/tree/main/rust/kcl-lib/src/lsp/kcl)
- Modeling
  - [KittyCAD TypeScript client](https://github.com/KittyCAD/kittycad.ts)

## Get Started

We recommend downloading the latest application binary from our [releases](https://github.com/KittyCAD/modeling-app/releases) page. If you don't see your platform or architecture supported there, please file an issue.

## Developing

Finally, if you'd like to run a development build or contribute to the project, please visit our [contributor guide](CONTRIBUTING.md) to get started.

## KCL

To contribute to the KittyCAD Language, see the [README](https://github.com/KittyCAD/modeling-app/tree/main/rust/kcl-lib) for KCL.
