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

use crate::{
    errors::KclError,
    execution::{ExecState, KclValue, types::PrimitiveType},
};

pub type StdFn = fn(
    &mut ExecState,
    Args,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<KclValue, KclError>> + Send + '_>>;

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
        ("sketch", "ellipse") => (
            |e, a| Box::pin(crate::std::shapes::ellipse(e, a)),
            StdFnProps::default("std::sketch::ellipse").include_in_feature_tree(),
        ),
        ("prelude", "helix") => (
            |e, a| Box::pin(crate::std::helix::helix(e, a)),
            StdFnProps::default("std::helix").include_in_feature_tree(),
        ),
        ("transform", "mirror2d") => (
            |e, a| Box::pin(crate::std::mirror::mirror_2d(e, a)),
            StdFnProps::default("std::transform::mirror2d").include_in_feature_tree(),
        ),
        ("transform", "translate") => (
            |e, a| Box::pin(crate::std::transform::translate(e, a)),
            StdFnProps::default("std::transform::translate").include_in_feature_tree(),
        ),
        ("transform", "rotate") => (
            |e, a| Box::pin(crate::std::transform::rotate(e, a)),
            StdFnProps::default("std::transform::rotate").include_in_feature_tree(),
        ),
        ("transform", "scale") => (
            |e, a| Box::pin(crate::std::transform::scale(e, a)),
            StdFnProps::default("std::transform::scale").include_in_feature_tree(),
        ),
        ("prelude", "offsetPlane") => (
            |e, a| Box::pin(crate::std::planes::offset_plane(e, a)),
            StdFnProps::default("std::offsetPlane").include_in_feature_tree(),
        ),
        ("prelude", "assert") => (
            |e, a| Box::pin(crate::std::assert::assert(e, a)),
            StdFnProps::default("std::assert"),
        ),
        ("prelude", "assertIs") => (
            |e, a| Box::pin(crate::std::assert::assert_is(e, a)),
            StdFnProps::default("std::assertIs"),
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
        ("solid", "union") => (
            |e, a| Box::pin(crate::std::csg::union(e, a)),
            StdFnProps::default("std::solid::union").include_in_feature_tree(),
        ),
        ("solid", "intersect") => (
            |e, a| Box::pin(crate::std::csg::intersect(e, a)),
            StdFnProps::default("std::solid::intersect").include_in_feature_tree(),
        ),
        ("solid", "subtract") => (
            |e, a| Box::pin(crate::std::csg::subtract(e, a)),
            StdFnProps::default("std::solid::subtract").include_in_feature_tree(),
        ),
        ("solid", "patternTransform") => (
            |e, a| Box::pin(crate::std::patterns::pattern_transform(e, a)),
            StdFnProps::default("std::solid::patternTransform").include_in_feature_tree(),
        ),
        ("solid", "patternLinear3d") => (
            |e, a| Box::pin(crate::std::patterns::pattern_linear_3d(e, a)),
            StdFnProps::default("std::solid::patternLinear3d").include_in_feature_tree(),
        ),
        ("solid", "patternCircular3d") => (
            |e, a| Box::pin(crate::std::patterns::pattern_circular_3d(e, a)),
            StdFnProps::default("std::solid::patternCircular3d").include_in_feature_tree(),
        ),
        ("solid", "appearance") => (
            |e, a| Box::pin(crate::std::appearance::appearance(e, a)),
            StdFnProps::default("std::solid::appearance"),
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
        ("array", "concat") => (
            |e, a| Box::pin(crate::std::array::concat(e, a)),
            StdFnProps::default("std::array::concat"),
        ),
        ("prelude", "clone") => (
            |e, a| Box::pin(crate::std::clone::clone(e, a)),
            StdFnProps::default("std::clone").include_in_feature_tree(),
        ),
        ("sketch", "conic") => (
            |e, a| Box::pin(crate::std::sketch::conic(e, a)),
            StdFnProps::default("std::sketch::conic").include_in_feature_tree(),
        ),
        ("sketch", "parabolic") => (
            |e, a| Box::pin(crate::std::sketch::parabolic(e, a)),
            StdFnProps::default("std::sketch::parabolic").include_in_feature_tree(),
        ),
        ("sketch", "parabolicPoint") => (
            |e, a| Box::pin(crate::std::sketch::parabolic_point(e, a)),
            StdFnProps::default("std::sketch::parabolicPoint"),
        ),
        ("sketch", "hyperbolic") => (
            |e, a| Box::pin(crate::std::sketch::hyperbolic(e, a)),
            StdFnProps::default("std::sketch::hyperbolic").include_in_feature_tree(),
        ),
        ("sketch", "hyperbolicPoint") => (
            |e, a| Box::pin(crate::std::sketch::hyperbolic_point(e, a)),
            StdFnProps::default("std::sketch::hyperbolicPoint"),
        ),
        ("sketch", "elliptic") => (
            |e, a| Box::pin(crate::std::sketch::elliptic(e, a)),
            StdFnProps::default("std::sketch::elliptic").include_in_feature_tree(),
        ),
        ("sketch", "ellipticPoint") => (
            |e, a| Box::pin(crate::std::sketch::elliptic_point(e, a)),
            StdFnProps::default("std::sketch::ellipticPoint"),
        ),
        ("sketch", "rectangle") => (
            |e, a| Box::pin(crate::std::shapes::rectangle(e, a)),
            StdFnProps::default("std::sketch::rectangle"),
        ),
        ("sketch", "planeOf") => (
            |e, a| Box::pin(crate::std::planes::plane_of(e, a)),
            StdFnProps::default("std::sketch::planeOf"),
        ),
        ("sketch", "extrude") => (
            |e, a| Box::pin(crate::std::extrude::extrude(e, a)),
            StdFnProps::default("std::sketch::extrude").include_in_feature_tree(),
        ),
        ("sketch", "patternTransform2d") => (
            |e, a| Box::pin(crate::std::patterns::pattern_transform_2d(e, a)),
            StdFnProps::default("std::sketch::patternTransform2d"),
        ),
        ("sketch", "revolve") => (
            |e, a| Box::pin(crate::std::revolve::revolve(e, a)),
            StdFnProps::default("std::sketch::revolve").include_in_feature_tree(),
        ),
        ("sketch", "sweep") => (
            |e, a| Box::pin(crate::std::sweep::sweep(e, a)),
            StdFnProps::default("std::sketch::sweep").include_in_feature_tree(),
        ),
        ("sketch", "loft") => (
            |e, a| Box::pin(crate::std::loft::loft(e, a)),
            StdFnProps::default("std::sketch::loft").include_in_feature_tree(),
        ),
        ("sketch", "polygon") => (
            |e, a| Box::pin(crate::std::shapes::polygon(e, a)),
            StdFnProps::default("std::sketch::polygon"),
        ),
        ("sketch", "circleThreePoint") => (
            |e, a| Box::pin(crate::std::shapes::circle_three_point(e, a)),
            StdFnProps::default("std::sketch::circleThreePoint"),
        ),
        ("sketch", "getCommonEdge") => (
            |e, a| Box::pin(crate::std::edge::get_common_edge(e, a)),
            StdFnProps::default("std::sketch::getCommonEdge"),
        ),
        ("sketch", "getNextAdjacentEdge") => (
            |e, a| Box::pin(crate::std::edge::get_next_adjacent_edge(e, a)),
            StdFnProps::default("std::sketch::getNextAdjacentEdge"),
        ),
        ("sketch", "getOppositeEdge") => (
            |e, a| Box::pin(crate::std::edge::get_opposite_edge(e, a)),
            StdFnProps::default("std::sketch::revolve"),
        ),
        ("sketch", "getPreviousAdjacentEdge") => (
            |e, a| Box::pin(crate::std::edge::get_previous_adjacent_edge(e, a)),
            StdFnProps::default("std::sketch::getPreviousAdjacentEdge"),
        ),
        ("sketch", "patternLinear2d") => (
            |e, a| Box::pin(crate::std::patterns::pattern_linear_2d(e, a)),
            StdFnProps::default("std::sketch::patternLinear2d"),
        ),
        ("sketch", "patternCircular2d") => (
            |e, a| Box::pin(crate::std::patterns::pattern_circular_2d(e, a)),
            StdFnProps::default("std::sketch::patternCircular2d"),
        ),
        ("sketch", "segEnd") => (
            |e, a| Box::pin(crate::std::segment::segment_end(e, a)),
            StdFnProps::default("std::sketch::segEnd"),
        ),
        ("sketch", "segEndX") => (
            |e, a| Box::pin(crate::std::segment::segment_end_x(e, a)),
            StdFnProps::default("std::sketch::segEndX"),
        ),
        ("sketch", "segEndY") => (
            |e, a| Box::pin(crate::std::segment::segment_end_y(e, a)),
            StdFnProps::default("std::sketch::segEndY"),
        ),
        ("sketch", "segStart") => (
            |e, a| Box::pin(crate::std::segment::segment_start(e, a)),
            StdFnProps::default("std::sketch::segStart"),
        ),
        ("sketch", "segStartX") => (
            |e, a| Box::pin(crate::std::segment::segment_start_x(e, a)),
            StdFnProps::default("std::sketch::segStartX"),
        ),
        ("sketch", "segStartY") => (
            |e, a| Box::pin(crate::std::segment::segment_start_y(e, a)),
            StdFnProps::default("std::sketch::segStartY"),
        ),
        ("sketch", "lastSegX") => (
            |e, a| Box::pin(crate::std::segment::last_segment_x(e, a)),
            StdFnProps::default("std::sketch::lastSegX"),
        ),
        ("sketch", "lastSegY") => (
            |e, a| Box::pin(crate::std::segment::last_segment_y(e, a)),
            StdFnProps::default("std::sketch::lastSegY"),
        ),
        ("sketch", "segLen") => (
            |e, a| Box::pin(crate::std::segment::segment_length(e, a)),
            StdFnProps::default("std::sketch::segLen"),
        ),
        ("sketch", "segAng") => (
            |e, a| Box::pin(crate::std::segment::segment_angle(e, a)),
            StdFnProps::default("std::sketch::segAng"),
        ),
        ("sketch", "tangentToEnd") => (
            |e, a| Box::pin(crate::std::segment::tangent_to_end(e, a)),
            StdFnProps::default("std::sketch::tangentToEnd"),
        ),
        ("sketch", "profileStart") => (
            |e, a| Box::pin(crate::std::sketch::profile_start(e, a)),
            StdFnProps::default("std::sketch::profileStart"),
        ),
        ("sketch", "profileStartX") => (
            |e, a| Box::pin(crate::std::sketch::profile_start_x(e, a)),
            StdFnProps::default("std::sketch::profileStartX"),
        ),
        ("sketch", "profileStartY") => (
            |e, a| Box::pin(crate::std::sketch::profile_start_y(e, a)),
            StdFnProps::default("std::sketch::profileStartY"),
        ),
        ("sketch", "startSketchOn") => (
            |e, a| Box::pin(crate::std::sketch::start_sketch_on(e, a)),
            StdFnProps::default("std::sketch::startSketchOn").include_in_feature_tree(),
        ),
        ("sketch", "startProfile") => (
            |e, a| Box::pin(crate::std::sketch::start_profile(e, a)),
            StdFnProps::default("std::sketch::startProfile"),
        ),
        ("sketch", "involuteCircular") => (
            |e, a| Box::pin(crate::std::sketch::involute_circular(e, a)),
            StdFnProps::default("std::sketch::involuteCircular"),
        ),
        ("sketch", "line") => (
            |e, a| Box::pin(crate::std::sketch::line(e, a)),
            StdFnProps::default("std::sketch::line"),
        ),
        ("sketch", "xLine") => (
            |e, a| Box::pin(crate::std::sketch::x_line(e, a)),
            StdFnProps::default("std::sketch::xLine"),
        ),
        ("sketch", "yLine") => (
            |e, a| Box::pin(crate::std::sketch::y_line(e, a)),
            StdFnProps::default("std::sketch::yLine"),
        ),
        ("sketch", "angledLine") => (
            |e, a| Box::pin(crate::std::sketch::angled_line(e, a)),
            StdFnProps::default("std::sketch::angledLine"),
        ),
        ("sketch", "angledLineThatIntersects") => (
            |e, a| Box::pin(crate::std::sketch::angled_line_that_intersects(e, a)),
            StdFnProps::default("std::sketch::angledLineThatIntersects"),
        ),
        ("sketch", "close") => (
            |e, a| Box::pin(crate::std::sketch::close(e, a)),
            StdFnProps::default("std::sketch::close"),
        ),
        ("sketch", "arc") => (
            |e, a| Box::pin(crate::std::sketch::arc(e, a)),
            StdFnProps::default("std::sketch::arc"),
        ),
        ("sketch", "tangentialArc") => (
            |e, a| Box::pin(crate::std::sketch::tangential_arc(e, a)),
            StdFnProps::default("std::sketch::tangentialArc"),
        ),
        ("sketch", "bezierCurve") => (
            |e, a| Box::pin(crate::std::sketch::bezier_curve(e, a)),
            StdFnProps::default("std::sketch::bezierCurve"),
        ),
        ("sketch", "subtract2d") => (
            |e, a| Box::pin(crate::std::sketch::subtract_2d(e, a)),
            StdFnProps::default("std::sketch::subtract2d").include_in_feature_tree(),
        ),
        ("appearance", "hexString") => (
            |e, a| Box::pin(crate::std::appearance::hex_string(e, a)),
            StdFnProps::default("std::appearance::hexString"),
        ),
        (module, fn_name) => {
            panic!("No implementation found for {module}::{fn_name}, please add it to this big match statement")
        }
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
        ("types", "TaggedEdge") => (PrimitiveType::TaggedEdge, StdFnProps::default("std::types::TaggedEdge")),
        ("types", "TaggedFace") => (PrimitiveType::TaggedFace, StdFnProps::default("std::types::TaggedFace")),
        _ => unreachable!(),
    }
}

/// The default tolerance for modeling commands in millimeters.
const DEFAULT_TOLERANCE_MM: f64 = 0.0000001;
