//! Feature-gated Rust-first OCCT kernel spike using `cadrum`.
//!
//! This module is intentionally not wired into the production OpenCascade engine
//! path yet. It proves that the native Rust side can construct real OCCT-backed
//! topology without adding more command semantics to our C++ command core.

use anyhow::Result;
use cadrum::{DVec3, Edge, Solid};

#[derive(Debug, Clone, PartialEq)]
pub struct CadrumExtrudeProbe {
    pub volume: f64,
    pub area: f64,
    pub face_count: usize,
    pub edge_count: usize,
    pub brep_text_bytes: usize,
}

pub fn rectangle_extrude_probe(width: f64, height: f64, depth: f64) -> Result<CadrumExtrudeProbe> {
    let profile = Edge::polygon(&[
        DVec3::new(0.0, 0.0, 0.0),
        DVec3::new(width, 0.0, 0.0),
        DVec3::new(width, height, 0.0),
        DVec3::new(0.0, height, 0.0),
    ])?;
    let solid = Solid::extrude(&profile, DVec3::Z * depth)?;
    let mut brep = Vec::new();
    Solid::write_brep_text([&solid], &mut brep)?;

    Ok(CadrumExtrudeProbe {
        volume: solid.volume(),
        area: solid.area(),
        face_count: solid.iter_face().count(),
        edge_count: solid.iter_edge().count(),
        brep_text_bytes: brep.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::rectangle_extrude_probe;

    #[test]
    fn cadrum_rectangle_extrude_builds_real_occt_topology() {
        let probe = rectangle_extrude_probe(2.0, 3.0, 4.0).expect("cadrum rectangle extrude should succeed");

        assert!((probe.volume - 24.0).abs() < 1e-6);
        assert!((probe.area - 52.0).abs() < 1e-6);
        assert_eq!(probe.face_count, 6);
        assert_eq!(probe.edge_count, 12);
        assert!(probe.brep_text_bytes > 0);
    }
}
