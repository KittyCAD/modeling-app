//! Mesh-free display geometry shared by Engine and browser tessellation.
//! World coordinates are meters, Z up; trim coordinates are surface parameters.

use serde::Deserialize;
use serde::Serialize;

pub const VERSION: u32 = 1;
pub const FILE_NAME: &str = "preview.brep.json";

fn deserialize_version<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<u32, D::Error> {
    let version = u32::deserialize(deserializer)?;
    if version != VERSION {
        return Err(serde::de::Error::custom(format!(
            "Unsupported native B-rep version: {version}"
        )));
    }
    Ok(version)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CoordinateSystem {
    ZUp,
}

/// A complete replacement for the preceding scene preview.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneSnapshot {
    #[serde(deserialize_with = "deserialize_version")]
    pub version: u32,
    pub coordinate_system: CoordinateSystem,
    pub bodies: Vec<Body>,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Body {
    pub id: String,
    pub brep: Brep,
}

pub type Point = [f64; 3];
pub type Uv = [f64; 2];
pub type Oriented = (usize, i8);

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(deserialize_with = "deserialize_version")]
    pub version: u32,
    pub brep: Brep,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Brep {
    pub surfaces: Vec<Surface>,
    pub faces: Vec<Face>,
    pub loops: Vec<TrimLoop>,
    #[serde(rename = "curves2D")]
    pub curves2d: Vec<Curve>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Surface {
    Plane { plane: Plane },
    Nurbs { nurbs: Nurbs },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plane {
    #[serde(default)]
    pub origin: Point,
    #[serde(default = "x_axis")]
    pub x_axis: Point,
    #[serde(default = "y_axis")]
    pub y_axis: Point,
}
fn x_axis() -> Point {
    [1.0, 0.0, 0.0]
}
fn y_axis() -> Point {
    [0.0, 1.0, 0.0]
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Nurbs {
    #[serde(default)]
    pub closed: [bool; 2],
    pub control_points: Vec<Point>,
    #[serde(default)]
    pub weights: Vec<f64>,
    pub knot_vector: Vec<f64>,
    pub num_control_points: [usize; 2],
    pub num_knots: [usize; 2],
    pub order: [usize; 2],
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Face {
    pub surface: Oriented,
    pub loops: Vec<Oriented>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct TrimLoop {
    #[serde(default)]
    pub traces: Vec<Trace>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Trace {
    pub curve: Oriented,
    pub t: [f64; 2],
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Curve {
    Line { line: Line },
    Circle { circle: Circle },
    Nurbs { nurbs: NurbsCurve },
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Line {
    #[serde(default)]
    pub origin: Uv,
    pub direction: Uv,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Circle {
    #[serde(default)]
    pub origin: Uv,
    pub radius: f64,
    #[serde(default = "uv_x_axis")]
    pub x_axis: Uv,
    #[serde(default = "uv_y_axis")]
    pub y_axis: Uv,
}
fn uv_x_axis() -> Uv {
    [1.0, 0.0]
}
fn uv_y_axis() -> Uv {
    [0.0, 1.0]
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NurbsCurve {
    pub control_points: Vec<Uv>,
    #[serde(default)]
    pub weights: Vec<f64>,
    pub knot_vector: Vec<f64>,
    pub order: usize,
}

/// Encode already-serialized bodies without parsing or rounding their geometry.
///
/// Each body must be valid JSON conforming to [`Brep`], produced by the trusted
/// native encoder. This function escapes envelope strings but deliberately does
/// not validate raw geometry; compatibility fixtures check the native producer.
pub fn encode_scene(bodies: &[(&str, &[u8])], errors: &[String]) -> serde_json::Result<Vec<u8>> {
    let mut out = Vec::with_capacity(
        bodies
            .iter()
            .map(|(id, body)| id.len() + body.len() + 24)
            .sum::<usize>()
            + 128,
    );
    out.extend_from_slice(b"{\"version\":");
    serde_json::to_writer(&mut out, &VERSION)?;
    out.extend_from_slice(b",\"coordinateSystem\":");
    serde_json::to_writer(&mut out, &CoordinateSystem::ZUp)?;
    out.extend_from_slice(b",\"bodies\":[");
    for (i, (id, body)) in bodies.iter().enumerate() {
        if i != 0 {
            out.push(b',');
        }
        out.extend_from_slice(b"{\"id\":");
        serde_json::to_writer(&mut out, id)?;
        out.extend_from_slice(b",\"brep\":");
        out.extend_from_slice(body);
        out.push(b'}');
    }
    out.extend_from_slice(b"],\"errors\":");
    serde_json::to_writer(&mut out, errors)?;
    out.push(b'}');
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_capture_is_compatible_and_keeps_exact_geometry_bytes() {
        // Captured from the C++ producer, not synthesized from these Rust types.
        let body = include_bytes!("../fixtures/sphere.brep.json");
        let id = "body\"\\\n";
        let errors = vec!["skipped body\n\"detail\"".to_owned()];
        let packet = encode_scene(&[(id, body)], &errors).unwrap();
        let scene: SceneSnapshot = serde_json::from_slice(&packet).unwrap();
        assert_eq!(scene.bodies[0].id, id);
        assert!(!scene.bodies[0].brep.faces.is_empty());
        assert_eq!(scene.errors, errors);
        assert!(packet.windows(body.len()).any(|part| part == body));
        let precise =
            br#"{"surfaces":[],"faces":[],"loops":[],"curves2D":[],"precise":1.2345678901234567,"tiny":1e-200}"#;
        let multiple = encode_scene(&[(id, body), ("precise", precise)], &[]).unwrap();
        let decoded: SceneSnapshot = serde_json::from_slice(&multiple).unwrap();
        assert_eq!(decoded.bodies.len(), 2);
        assert!(multiple.windows(precise.len()).any(|part| part == precise));
        let empty: SceneSnapshot = serde_json::from_slice(&encode_scene(&[], &[]).unwrap()).unwrap();
        assert!(empty.bodies.is_empty());
    }

    #[test]
    fn unsupported_protocol_versions_and_coordinate_systems_are_rejected() {
        let packet = encode_scene(&[], &[]).unwrap();
        let mut scene: serde_json::Value = serde_json::from_slice(&packet).unwrap();
        scene["version"] = (VERSION + 1).into();
        assert!(serde_json::from_value::<SceneSnapshot>(scene.clone()).is_err());
        scene["version"] = VERSION.into();
        scene["coordinateSystem"] = "y-up".into();
        assert!(serde_json::from_value::<SceneSnapshot>(scene).is_err());
    }
}
