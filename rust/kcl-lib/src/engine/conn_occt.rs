//! Native OpenCascade engine backend scaffold.
//!
//! This module is the native entrypoint that lets the CLI select the
//! `open_cascade` modeling engine without opening a Zoo WebSocket. The command
//! processor intentionally delegates to the mock engine until the native OCCT
//! C++ command core is linked behind this boundary.

pub use crate::engine::conn_mock::EngineConnection;
