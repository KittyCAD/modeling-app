//! Functions implemented for language execution.

pub mod appearance;
pub mod args;
pub mod array;
pub mod assert;
pub mod axis_or_reference;
pub mod chamfer;
pub mod convert;
pub mod csg;
pub mod edge;
pub mod extrude;
pub mod fillet;
pub mod helix;
pub mod import;
pub mod loft;
pub mod math;
pub mod mirror;
pub mod patterns;
pub mod planes;
pub mod polar;
pub mod revolve;
pub mod segment;
pub mod shapes;
pub mod shell;
pub mod sketch;
pub mod sweep;
pub mod transform;
pub mod types;
pub mod units;
pub mod utils;

use anyhow::Result;
pub use args::Args;
use indexmap::IndexMap;
use kcl_derive_docs::stdlib;
use lazy_static::lazy_static;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    docs::StdLibFn,
    errors::KclError,
    execution::{types::PrimitiveType, ExecState, KclValue},
    parsing::ast::types::Name,
};

pub type StdFn = fn(
    &mut ExecState,
    Args,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<KclValue, KclError>> + Send + '_>>;

lazy_static! {
    static ref CORE_FNS: Vec<Box<dyn StdLibFn>> = vec![
        Box::new(LegLen),
        Box::new(LegAngX),
        Box::new(LegAngY),
        Box::new(crate::std::appearance::Appearance),
        Box::new(crate::std::convert::Int),
        Box::new(crate::std::extrude::Extrude),
        Box::new(crate::std::segment::SegEnd),
        Box::new(crate::std::segment::SegEndX),
        Box::new(crate::std::segment::SegEndY),
        Box::new(crate::std::segment::SegStart),
        Box::new(crate::std::segment::SegStartX),
        Box::new(crate::std::segment::SegStartY),
        Box::new(crate::std::segment::LastSegX),
        Box::new(crate::std::segment::LastSegY),
        Box::new(crate::std::segment::SegLen),
        Box::new(crate::std::segment::SegAng),
        Box::new(crate::std::segment::TangentToEnd),
        Box::new(crate::std::segment::AngleToMatchLengthX),
        Box::new(crate::std::segment::AngleToMatchLengthY),
        Box::new(crate::std::shapes::CircleThreePoint),
        Box::new(crate::std::shapes::Polygon),
        Box::new(crate::std::sketch::Line),
        Box::new(crate::std::sketch::XLine),
        Box::new(crate::std::sketch::YLine),
        Box::new(crate::std::sketch::AngledLineToX),
        Box::new(crate::std::sketch::AngledLineToY),
        Box::new(crate::std::sketch::AngledLine),
        Box::new(crate::std::sketch::AngledLineOfXLength),
        Box::new(crate::std::sketch::AngledLineOfYLength),
        Box::new(crate::std::sketch::AngledLineThatIntersects),
        Box::new(crate::std::sketch::StartSketchOn),
        Box::new(crate::std::sketch::StartProfileAt),
        Box::new(crate::std::sketch::ProfileStartX),
        Box::new(crate::std::sketch::ProfileStartY),
        Box::new(crate::std::sketch::ProfileStart),
        Box::new(crate::std::sketch::Close),
        Box::new(crate::std::sketch::Arc),
        Box::new(crate::std::sketch::ArcTo),
        Box::new(crate::std::sketch::TangentialArc),
        Box::new(crate::std::sketch::TangentialArcTo),
        Box::new(crate::std::sketch::TangentialArcToRelative),
        Box::new(crate::std::sketch::BezierCurve),
        Box::new(crate::std::sketch::Hole),
        Box::new(crate::std::mirror::Mirror2D),
        Box::new(crate::std::patterns::PatternLinear2D),
        Box::new(crate::std::patterns::PatternLinear3D),
        Box::new(crate::std::patterns::PatternCircular2D),
        Box::new(crate::std::patterns::PatternCircular3D),
        Box::new(crate::std::patterns::PatternTransform),
        Box::new(crate::std::patterns::PatternTransform2D),
        Box::new(crate::std::array::Reduce),
        Box::new(crate::std::array::Map),
        Box::new(crate::std::array::Push),
        Box::new(crate::std::array::Pop),
        Box::new(crate::std::chamfer::Chamfer),
        Box::new(crate::std::fillet::Fillet),
        Box::new(crate::std::edge::GetOppositeEdge),
        Box::new(crate::std::edge::GetNextAdjacentEdge),
        Box::new(crate::std::edge::GetPreviousAdjacentEdge),
        Box::new(crate::std::edge::GetCommonEdge),
        Box::new(crate::std::helix::Helix),
        Box::new(crate::std::shell::Shell),
        Box::new(crate::std::shell::Hollow),
        Box::new(crate::std::revolve::Revolve),
        Box::new(crate::std::sweep::Sweep),
        Box::new(crate::std::loft::Loft),
        Box::new(crate::std::planes::OffsetPlane),
        Box::new(crate::std::import::Import),
        Box::new(crate::std::math::Acos),
        Box::new(crate::std::math::Asin),
        Box::new(crate::std::math::Atan),
        Box::new(crate::std::math::Atan2),
        Box::new(crate::std::math::Pi),
        Box::new(crate::std::math::E),
        Box::new(crate::std::math::Tau),
        Box::new(crate::std::math::Sqrt),
        Box::new(crate::std::math::Abs),
        Box::new(crate::std::math::Rem),
        Box::new(crate::std::math::Round),
        Box::new(crate::std::math::Floor),
        Box::new(crate::std::math::Ceil),
        Box::new(crate::std::math::Min),
        Box::new(crate::std::math::Max),
        Box::new(crate::std::math::Pow),
        Box::new(crate::std::math::Log),
        Box::new(crate::std::math::Log2),
        Box::new(crate::std::math::Log10),
        Box::new(crate::std::math::Ln),
        Box::new(crate::std::math::ToDegrees),
        Box::new(crate::std::math::ToRadians),
        Box::new(crate::std::units::Mm),
        Box::new(crate::std::units::Inch),
        Box::new(crate::std::units::Ft),
        Box::new(crate::std::units::M),
        Box::new(crate::std::units::Cm),
        Box::new(crate::std::units::Yd),
        Box::new(crate::std::polar::Polar),
        Box::new(crate::std::assert::Assert),
        Box::new(crate::std::assert::AssertEqual),
        Box::new(crate::std::assert::AssertLessThan),
        Box::new(crate::std::assert::AssertGreaterThan),
        Box::new(crate::std::assert::AssertLessThanOrEq),
        Box::new(crate::std::assert::AssertGreaterThanOrEq),
        Box::new(crate::std::transform::Scale),
        Box::new(crate::std::transform::Translate),
        Box::new(crate::std::transform::Rotate),
        Box::new(crate::std::csg::Intersect),
        Box::new(crate::std::csg::Union),
        Box::new(crate::std::csg::Subtract),
    ];
}

pub fn name_in_stdlib(name: &str) -> bool {
    CORE_FNS.iter().any(|f| f.name() == name)
}

pub fn get_stdlib_fn(name: &str) -> Option<Box<dyn StdLibFn>> {
    CORE_FNS.iter().find(|f| f.name() == name).cloned()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StdFnProps {
    pub name: String,
    pub deprecated: bool,
}

impl StdFnProps {
    fn default(name: &str) -> Self {
        Self {
            name: name.to_owned(),
            deprecated: false,
        }
    }
}

pub(crate) fn std_fn(path: &str, fn_name: &str) -> (crate::std::StdFn, StdFnProps) {
    match (path, fn_name) {
        ("math", "cos") => (
            |e, a| Box::pin(crate::std::math::cos(e, a)),
            StdFnProps::default("std::math::cos"),
        ),
        ("math", "sin") => (
            |e, a| Box::pin(crate::std::math::sin(e, a)),
            StdFnProps::default("std::math::sin"),
        ),
        ("math", "tan") => (
            |e, a| Box::pin(crate::std::math::tan(e, a)),
            StdFnProps::default("std::math::tan"),
        ),
        ("sketch", "circle") => (
            |e, a| Box::pin(crate::std::shapes::circle(e, a)),
            StdFnProps::default("std::sketch::circle"),
        ),
        _ => unreachable!(),
    }
}

pub(crate) fn std_ty(path: &str, fn_name: &str) -> (PrimitiveType, StdFnProps) {
    match (path, fn_name) {
        ("prelude", "Sketch") => (PrimitiveType::Sketch, StdFnProps::default("std::Sketch")),
        ("prelude", "Solid") => (PrimitiveType::Solid, StdFnProps::default("std::Solid")),
        ("prelude", "Plane") => (PrimitiveType::Plane, StdFnProps::default("std::Plane")),
        ("prelude", "Face") => (PrimitiveType::Face, StdFnProps::default("std::Face")),
        ("prelude", "Helix") => (PrimitiveType::Helix, StdFnProps::default("std::Helix")),
        _ => unreachable!(),
    }
}

pub struct StdLib {
    pub fns: IndexMap<String, Box<dyn StdLibFn>>,
}

impl std::fmt::Debug for StdLib {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StdLib").field("fns.len()", &self.fns.len()).finish()
    }
}

impl StdLib {
    pub fn new() -> Self {
        let fns = CORE_FNS
            .clone()
            .into_iter()
            .map(|internal_fn| (internal_fn.name(), internal_fn))
            .collect();

        Self { fns }
    }

    // Get the combined hashmaps.
    pub fn combined(&self) -> IndexMap<String, Box<dyn StdLibFn>> {
        self.fns.clone()
    }

    pub fn get(&self, name: &str) -> Option<Box<dyn StdLibFn>> {
        self.fns.get(name).cloned()
    }

    pub fn get_either(&self, name: &Name) -> FunctionKind {
        if let Some(name) = name.local_ident() {
            if let Some(f) = self.get(name.inner) {
                return FunctionKind::Core(f);
            }
        }

        FunctionKind::UserDefined
    }

    pub fn contains_key(&self, key: &str) -> bool {
        self.fns.contains_key(key)
    }
}

impl Default for StdLib {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug)]
pub enum FunctionKind {
    Core(Box<dyn StdLibFn>),
    UserDefined,
}

/// Compute the length of the given leg.
pub async fn leg_length(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (hypotenuse, leg, ty) = args.get_hypotenuse_leg()?;
    let result = inner_leg_length(hypotenuse, leg);
    Ok(KclValue::from_number_with_type(result, ty, vec![args.into()]))
}

/// Compute the length of the given leg.
///
/// ```no_run
/// legLen(5, 3)
/// ```
#[stdlib {
    name = "legLen",
    tags = ["utilities"],
}]
fn inner_leg_length(hypotenuse: f64, leg: f64) -> f64 {
    (hypotenuse.powi(2) - f64::min(hypotenuse.abs(), leg.abs()).powi(2)).sqrt()
}

/// Compute the angle of the given leg for x.
pub async fn leg_angle_x(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (hypotenuse, leg, ty) = args.get_hypotenuse_leg()?;
    let result = inner_leg_angle_x(hypotenuse, leg);
    Ok(KclValue::from_number_with_type(result, ty, vec![args.into()]))
}

/// Compute the angle of the given leg for x.
///
/// ```no_run
/// legAngX(5, 3)
/// ```
#[stdlib {
    name = "legAngX",
    tags = ["utilities"],
}]
fn inner_leg_angle_x(hypotenuse: f64, leg: f64) -> f64 {
    (leg.min(hypotenuse) / hypotenuse).acos().to_degrees()
}

/// Compute the angle of the given leg for y.
pub async fn leg_angle_y(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (hypotenuse, leg, ty) = args.get_hypotenuse_leg()?;
    let result = inner_leg_angle_y(hypotenuse, leg);
    Ok(KclValue::from_number_with_type(result, ty, vec![args.into()]))
}

/// Compute the angle of the given leg for y.
///
/// ```no_run
/// legAngY(5, 3)
/// ```
#[stdlib {
    name = "legAngY",
    tags = ["utilities"],
}]
fn inner_leg_angle_y(hypotenuse: f64, leg: f64) -> f64 {
    (leg.min(hypotenuse) / hypotenuse).asin().to_degrees()
}

/// The primitive types that can be used in a KCL file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, Display, FromStr)]
#[serde(rename_all = "lowercase")]
#[display(style = "lowercase")]
pub enum Primitive {
    /// A boolean value.
    Bool,
    /// A number value.
    Number,
    /// A string value.
    String,
    /// A uuid value.
    Uuid,
}
