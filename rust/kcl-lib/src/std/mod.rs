//! Functions implemented for language execution.

pub mod appearance;
pub mod args;
pub mod array;
pub mod assert;
pub mod axis_or_reference;
pub mod chamfer;
pub mod clone;
pub mod csg;
pub mod edge;
pub mod extrude;
pub mod fillet;
pub mod helix;
pub mod loft;
pub mod math;
pub mod mirror;
pub mod patterns;
pub mod planes;
pub mod revolve;
pub mod segment;
pub mod shapes;
pub mod shell;
pub mod sketch;
pub mod sweep;
pub mod transform;
pub mod utils;

use anyhow::Result;
pub use args::Args;
use indexmap::IndexMap;
use lazy_static::lazy_static;

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
        Box::new(crate::std::appearance::Appearance),
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
        Box::new(crate::std::shapes::CircleThreePoint),
        Box::new(crate::std::shapes::Polygon),
        Box::new(crate::std::sketch::InvoluteCircular),
        Box::new(crate::std::sketch::Line),
        Box::new(crate::std::sketch::XLine),
        Box::new(crate::std::sketch::YLine),
        Box::new(crate::std::sketch::AngledLine),
        Box::new(crate::std::sketch::AngledLineThatIntersects),
        Box::new(crate::std::sketch::StartSketchOn),
        Box::new(crate::std::sketch::StartProfile),
        Box::new(crate::std::sketch::ProfileStartX),
        Box::new(crate::std::sketch::ProfileStartY),
        Box::new(crate::std::sketch::ProfileStart),
        Box::new(crate::std::sketch::Close),
        Box::new(crate::std::sketch::Arc),
        Box::new(crate::std::sketch::TangentialArc),
        Box::new(crate::std::sketch::BezierCurve),
        Box::new(crate::std::sketch::Subtract2D),
        Box::new(crate::std::patterns::PatternLinear2D),
        Box::new(crate::std::patterns::PatternLinear3D),
        Box::new(crate::std::patterns::PatternCircular2D),
        Box::new(crate::std::patterns::PatternCircular3D),
        Box::new(crate::std::patterns::PatternTransform),
        Box::new(crate::std::patterns::PatternTransform2D),
        Box::new(crate::std::edge::GetOppositeEdge),
        Box::new(crate::std::edge::GetNextAdjacentEdge),
        Box::new(crate::std::edge::GetPreviousAdjacentEdge),
        Box::new(crate::std::edge::GetCommonEdge),
        Box::new(crate::std::sweep::Sweep),
        Box::new(crate::std::loft::Loft),
        Box::new(crate::std::assert::Assert),
        Box::new(crate::std::assert::AssertIs),
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
    pub include_in_feature_tree: bool,
}

impl StdFnProps {
    fn default(name: &str) -> Self {
        Self {
            name: name.to_owned(),
            deprecated: false,
            include_in_feature_tree: false,
        }
    }

    fn include_in_feature_tree(mut self) -> Self {
        self.include_in_feature_tree = true;
        self
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
        ("math", "acos") => (
            |e, a| Box::pin(crate::std::math::acos(e, a)),
            StdFnProps::default("std::math::acos"),
        ),
        ("math", "asin") => (
            |e, a| Box::pin(crate::std::math::asin(e, a)),
            StdFnProps::default("std::math::asin"),
        ),
        ("math", "atan") => (
            |e, a| Box::pin(crate::std::math::atan(e, a)),
            StdFnProps::default("std::math::atan"),
        ),
        ("math", "atan2") => (
            |e, a| Box::pin(crate::std::math::atan2(e, a)),
            StdFnProps::default("std::math::atan2"),
        ),
        ("math", "sqrt") => (
            |e, a| Box::pin(crate::std::math::sqrt(e, a)),
            StdFnProps::default("std::math::sqrt"),
        ),

        ("math", "abs") => (
            |e, a| Box::pin(crate::std::math::abs(e, a)),
            StdFnProps::default("std::math::abs"),
        ),
        ("math", "rem") => (
            |e, a| Box::pin(crate::std::math::rem(e, a)),
            StdFnProps::default("std::math::rem"),
        ),
        ("math", "round") => (
            |e, a| Box::pin(crate::std::math::round(e, a)),
            StdFnProps::default("std::math::round"),
        ),
        ("math", "floor") => (
            |e, a| Box::pin(crate::std::math::floor(e, a)),
            StdFnProps::default("std::math::floor"),
        ),
        ("math", "ceil") => (
            |e, a| Box::pin(crate::std::math::ceil(e, a)),
            StdFnProps::default("std::math::ceil"),
        ),
        ("math", "min") => (
            |e, a| Box::pin(crate::std::math::min(e, a)),
            StdFnProps::default("std::math::min"),
        ),
        ("math", "max") => (
            |e, a| Box::pin(crate::std::math::max(e, a)),
            StdFnProps::default("std::math::max"),
        ),
        ("math", "pow") => (
            |e, a| Box::pin(crate::std::math::pow(e, a)),
            StdFnProps::default("std::math::pow"),
        ),
        ("math", "log") => (
            |e, a| Box::pin(crate::std::math::log(e, a)),
            StdFnProps::default("std::math::log"),
        ),
        ("math", "log2") => (
            |e, a| Box::pin(crate::std::math::log2(e, a)),
            StdFnProps::default("std::math::log2"),
        ),
        ("math", "log10") => (
            |e, a| Box::pin(crate::std::math::log10(e, a)),
            StdFnProps::default("std::math::log10"),
        ),
        ("math", "ln") => (
            |e, a| Box::pin(crate::std::math::ln(e, a)),
            StdFnProps::default("std::math::ln"),
        ),
        ("math", "legLen") => (
            |e, a| Box::pin(crate::std::math::leg_length(e, a)),
            StdFnProps::default("std::math::legLen"),
        ),
        ("math", "legAngX") => (
            |e, a| Box::pin(crate::std::math::leg_angle_x(e, a)),
            StdFnProps::default("std::math::legAngX"),
        ),
        ("math", "legAngY") => (
            |e, a| Box::pin(crate::std::math::leg_angle_y(e, a)),
            StdFnProps::default("std::math::legAngY"),
        ),
        ("sketch", "circle") => (
            |e, a| Box::pin(crate::std::shapes::circle(e, a)),
            StdFnProps::default("std::sketch::circle"),
        ),
        ("prelude", "helix") => (
            |e, a| Box::pin(crate::std::helix::helix(e, a)),
            StdFnProps::default("std::helix").include_in_feature_tree(),
        ),
        ("transform", "mirror2d") => (
            |e, a| Box::pin(crate::std::mirror::mirror_2d(e, a)),
            StdFnProps::default("std::transform::mirror2d"),
        ),
        ("sketch", "revolve") => (
            |e, a| Box::pin(crate::std::revolve::revolve(e, a)),
            StdFnProps::default("std::sketch::revolve").include_in_feature_tree(),
        ),
        ("prelude", "offsetPlane") => (
            |e, a| Box::pin(crate::std::planes::offset_plane(e, a)),
            StdFnProps::default("std::offsetPlane").include_in_feature_tree(),
        ),
        ("solid", "fillet") => (
            |e, a| Box::pin(crate::std::fillet::fillet(e, a)),
            StdFnProps::default("std::solid::fillet").include_in_feature_tree(),
        ),
        ("solid", "chamfer") => (
            |e, a| Box::pin(crate::std::chamfer::chamfer(e, a)),
            StdFnProps::default("std::solid::chamfer").include_in_feature_tree(),
        ),
        ("solid", "shell") => (
            |e, a| Box::pin(crate::std::shell::shell(e, a)),
            StdFnProps::default("std::solid::shell").include_in_feature_tree(),
        ),
        ("solid", "hollow") => (
            |e, a| Box::pin(crate::std::shell::hollow(e, a)),
            StdFnProps::default("std::solid::hollow").include_in_feature_tree(),
        ),
        ("array", "map") => (
            |e, a| Box::pin(crate::std::array::map(e, a)),
            StdFnProps::default("std::array::map"),
        ),
        ("array", "reduce") => (
            |e, a| Box::pin(crate::std::array::reduce(e, a)),
            StdFnProps::default("std::array::reduce"),
        ),
        ("array", "push") => (
            |e, a| Box::pin(crate::std::array::push(e, a)),
            StdFnProps::default("std::array::push"),
        ),
        ("array", "pop") => (
            |e, a| Box::pin(crate::std::array::pop(e, a)),
            StdFnProps::default("std::array::pop"),
        ),
        ("prelude", "clone") => (
            |e, a| Box::pin(crate::std::clone::clone(e, a)),
            StdFnProps::default("std::clone").include_in_feature_tree(),
        ),
        _ => unreachable!(),
    }
}

pub(crate) fn std_ty(path: &str, fn_name: &str) -> (PrimitiveType, StdFnProps) {
    match (path, fn_name) {
        ("types", "Sketch") => (PrimitiveType::Sketch, StdFnProps::default("std::types::Sketch")),
        ("types", "Solid") => (PrimitiveType::Solid, StdFnProps::default("std::types::Solid")),
        ("types", "Plane") => (PrimitiveType::Plane, StdFnProps::default("std::types::Plane")),
        ("types", "Face") => (PrimitiveType::Face, StdFnProps::default("std::types::Face")),
        ("types", "Helix") => (PrimitiveType::Helix, StdFnProps::default("std::types::Helix")),
        ("types", "Edge") => (PrimitiveType::Edge, StdFnProps::default("std::types::Edge")),
        ("types", "Axis2d") => (PrimitiveType::Axis2d, StdFnProps::default("std::types::Axis2d")),
        ("types", "Axis3d") => (PrimitiveType::Axis3d, StdFnProps::default("std::types::Axis3d")),
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

/// The default tolerance for modeling commands in [`kittycad_modeling_cmds::length_unit::LengthUnit`].
const DEFAULT_TOLERANCE: f64 = 0.0000001;
