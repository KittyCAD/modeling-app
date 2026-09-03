//! Functions implemented for language execution.

pub mod appearance;
pub mod args;
pub mod array;
pub mod assert;
pub mod axis_or_reference;
pub mod chamfer;
pub mod clone;
pub mod constraints;
pub mod csg;
pub mod edge;
pub mod extrude;
pub mod faces;
pub mod fail;
pub mod fillet;
pub mod gdt;
pub mod helix;
pub mod ids;
pub mod loft;
pub mod math;
pub mod mirror;
pub mod patterns;
pub mod planes;
pub(crate) mod region_consumption;
pub mod revolve;
pub mod runtime;
pub mod segment;
pub mod shapes;
pub mod shell;
pub mod sketch;
pub(crate) mod solid_consumption;
pub(crate) mod solver;
pub mod string;
pub mod surfaces;
pub mod sweep;
pub mod transform;
pub mod utils;
pub mod view;

use anyhow::Result;
pub use args::Args;
use futures::future::FutureExt;

use crate::errors::KclError;
use crate::execution::ConsumedRegionOperation;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::KclValueControlFlow;
use crate::execution::types::PrimitiveType;

pub type StdFn =
    fn(
        &mut ExecState,
        Args,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<KclValueControlFlow, KclError>> + Send + '_>>;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum ConsumedSolidArgCheck {
    #[default]
    Error,
    WarnDeprecated,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ConsumedRegionDuplicatePolicy {
    Reject,
    Deduplicate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ConsumedRegionAliasPolicy {
    None,
    Reject(&'static str),
    Preserve(&'static str),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ConsumedRegionArg {
    pub(crate) operation: ConsumedRegionOperation,
    pub(crate) duplicate_policy: ConsumedRegionDuplicatePolicy,
    pub(crate) alias_policy: ConsumedRegionAliasPolicy,
    pub(crate) stale_region_policy: StaleRegionPolicy,
}

impl ConsumedRegionArg {
    pub(crate) const fn new(operation: ConsumedRegionOperation) -> Self {
        Self {
            operation,
            duplicate_policy: ConsumedRegionDuplicatePolicy::Reject,
            alias_policy: ConsumedRegionAliasPolicy::None,
            stale_region_policy: StaleRegionPolicy::Error,
        }
    }

    pub(crate) const fn reject_alias_with(mut self, arg_name: &'static str) -> Self {
        self.alias_policy = ConsumedRegionAliasPolicy::Reject(arg_name);
        self
    }

    pub(crate) const fn preserve_alias_with(mut self, arg_name: &'static str) -> Self {
        self.alias_policy = ConsumedRegionAliasPolicy::Preserve(arg_name);
        self
    }

    pub(crate) const fn deduplicate(mut self) -> Self {
        self.duplicate_policy = ConsumedRegionDuplicatePolicy::Deduplicate;
        self
    }

    pub(crate) const fn warn_if_already_consumed(mut self) -> Self {
        self.stale_region_policy = StaleRegionPolicy::Warning;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StaleRegionPolicy {
    Error,
    Warning,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum RegionBehavior {
    /// Warn when a consumed region reaches a Rust-backed stdlib function.
    #[default]
    WarnOnConsumed,
    /// Apply the configured stale-region policy and record the specified inputs
    /// as consumed after success.
    Consume(ConsumedRegionArg),
    /// The function reads stored region data without sending its object ID to the engine.
    ReadLocal,
}

impl RegionBehavior {
    pub(crate) const fn stale_region_policy(self) -> Option<StaleRegionPolicy> {
        match self {
            Self::WarnOnConsumed => Some(StaleRegionPolicy::Warning),
            Self::Consume(policy) => Some(policy.stale_region_policy),
            Self::ReadLocal => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StdFnProps {
    pub name: String,
    pub(crate) consumed_solid_arg_check: ConsumedSolidArgCheck,
    pub(crate) region_behavior: RegionBehavior,
    /// Set for the few builtins that call back into KCL (map, reduce,
    /// patternTransform): the machine executor routes them to a resumable
    /// entry so their callbacks run on the machine's continuation stack
    /// instead of re-entering natively. The recursive executor ignores this.
    pub(crate) resumable: Option<ResumableKind>,
}

/// Which resumable builtin this is. See
/// `crate::execution::machine`'s resume continuations.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ResumableKind {
    Map,
    Reduce,
    PatternTransform,
    PatternTransform2d,
}

impl StdFnProps {
    pub(crate) fn default(name: &str) -> Self {
        Self {
            name: name.to_owned(),
            consumed_solid_arg_check: Default::default(),
            region_behavior: Default::default(),
            resumable: None,
        }
    }

    pub(crate) fn resumable(mut self, kind: ResumableKind) -> Self {
        self.resumable = Some(kind);
        self
    }

    pub(crate) fn warn_deprecated_on_consumed_solid_args(mut self) -> Self {
        self.consumed_solid_arg_check = ConsumedSolidArgCheck::WarnDeprecated;
        self
    }

    pub(crate) fn consumes_regions(mut self, consumed_region_arg: ConsumedRegionArg) -> Self {
        self.region_behavior = RegionBehavior::Consume(consumed_region_arg);
        self
    }

    pub(crate) fn reads_regions_locally(mut self) -> Self {
        self.region_behavior = RegionBehavior::ReadLocal;
        self
    }
}

/// Resolves a Rust-backed standard-library function and its execution policies.
///
/// When registering a new function, start with `StdFnProps::default(...)`. Its
/// fully qualified name is used in diagnostics. Then add modifiers according to
/// how the function handles values consumed by earlier engine operations:
///
/// - Keep the default region behavior if the function does not accept Regions,
///   or may use a Region's engine UUID without consuming it. A stale Region
///   produces a warning and the call continues.
/// - Use [`StdFnProps::reads_regions_locally`] only when the function itself
///   uses stored KCL data and never sends an input Region's UUID to the engine.
///   Calls made by callbacks or KCL wrappers apply their own policies.
/// - Use [`StdFnProps::consumes_regions`] when a successful call consumes Regions
///   in its unlabeled input. By default, the function rejects stale Regions,
///   rejects duplicate Regions in that input, and records the Regions as consumed
///   after success. The modifiers define engine-specific exceptions:
///   - [`ConsumedRegionArg::warn_if_already_consumed`] warns instead of rejecting
///     stale Regions.
///   - [`ConsumedRegionArg::deduplicate`] allows duplicate Regions in the input.
///   - [`ConsumedRegionArg::reject_alias_with`] rejects a Region that is also
///     passed in the named argument.
///   - [`ConsumedRegionArg::preserve_alias_with`] does not record a Region as
///     consumed when it is also passed in the named argument.
/// - Keep the default consumed-solid behavior for new functions. Use
///   [`StdFnProps::warn_deprecated_on_consumed_solid_args`] only as a temporary
///   compatibility exception that warns instead of rejecting the call.
///
/// Region and solid policies are independent, so their modifiers may be chained.
pub(crate) fn std_fn(path: &str, fn_name: &str) -> (crate::std::StdFn, StdFnProps) {
    match (path, fn_name) {
        ("gdt", "datum") => (
            |e, a| Box::pin(crate::std::gdt::datum(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::datum"),
        ),
        ("gdt", "flatness") => (
            |e, a| Box::pin(crate::std::gdt::flatness(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::flatness"),
        ),
        ("gdt", "straightness") => (
            |e, a| Box::pin(crate::std::gdt::straightness(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::straightness"),
        ),
        ("gdt", "circularity") => (
            |e, a| Box::pin(crate::std::gdt::circularity(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::circularity"),
        ),
        ("gdt", "cylindricity") => (
            |e, a| Box::pin(crate::std::gdt::cylindricity(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::cylindricity"),
        ),
        ("gdt", "concentricity") => (
            |e, a| Box::pin(crate::std::gdt::concentricity(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::concentricity"),
        ),
        ("gdt", "symmetry") => (
            |e, a| Box::pin(crate::std::gdt::symmetry(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::symmetry"),
        ),
        ("gdt", "runout") => (
            |e, a| Box::pin(crate::std::gdt::runout(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::runout"),
        ),
        ("gdt", "angularity") => (
            |e, a| Box::pin(crate::std::gdt::angularity(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::angularity"),
        ),
        ("gdt", "perpendicularity") => (
            |e, a| Box::pin(crate::std::gdt::perpendicularity(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::perpendicularity"),
        ),
        ("gdt", "parallelism") => (
            |e, a| Box::pin(crate::std::gdt::parallelism(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::parallelism"),
        ),
        ("gdt", "annotation") => (
            |e, a| Box::pin(crate::std::gdt::annotation(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::annotation"),
        ),
        ("gdt", "note") => (
            |e, a| Box::pin(crate::std::gdt::note(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::note"),
        ),
        ("gdt", "distance") => (
            |e, a| Box::pin(crate::std::gdt::distance(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::distance"),
        ),
        ("gdt", "profile") => (
            |e, a| Box::pin(crate::std::gdt::profile(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::profile"),
        ),
        ("gdt", "profileLine") => (
            |e, a| Box::pin(crate::std::gdt::profile_line(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::profileLine"),
        ),
        ("gdt", "profileSurface") => (
            |e, a| Box::pin(crate::std::gdt::profile_surface(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::profileSurface"),
        ),
        ("gdt", "position") => (
            |e, a| Box::pin(crate::std::gdt::position(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::gdt::position"),
        ),
        ("math", "cos") => (
            |e, a| Box::pin(crate::std::math::cos(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::cos"),
        ),
        ("math", "sin") => (
            |e, a| Box::pin(crate::std::math::sin(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::sin"),
        ),
        ("math", "tan") => (
            |e, a| Box::pin(crate::std::math::tan(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::tan"),
        ),
        ("math", "acos") => (
            |e, a| Box::pin(crate::std::math::acos(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::acos"),
        ),
        ("math", "asin") => (
            |e, a| Box::pin(crate::std::math::asin(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::asin"),
        ),
        ("math", "atan") => (
            |e, a| Box::pin(crate::std::math::atan(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::atan"),
        ),
        ("math", "atan2") => (
            |e, a| Box::pin(crate::std::math::atan2(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::atan2"),
        ),
        ("math", "sqrt") => (
            |e, a| Box::pin(crate::std::math::sqrt(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::sqrt"),
        ),

        ("math", "abs") => (
            |e, a| Box::pin(crate::std::math::abs(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::abs"),
        ),
        ("math", "rem") => (
            |e, a| Box::pin(crate::std::math::rem(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::rem"),
        ),
        ("math", "round") => (
            |e, a| Box::pin(crate::std::math::round(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::round"),
        ),
        ("math", "floor") => (
            |e, a| Box::pin(crate::std::math::floor(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::floor"),
        ),
        ("math", "ceil") => (
            |e, a| Box::pin(crate::std::math::ceil(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::ceil"),
        ),
        ("math", "min") => (
            |e, a| Box::pin(crate::std::math::min(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::min"),
        ),
        ("math", "max") => (
            |e, a| Box::pin(crate::std::math::max(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::max"),
        ),
        ("math", "pow") => (
            |e, a| Box::pin(crate::std::math::pow(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::pow"),
        ),
        ("math", "log") => (
            |e, a| Box::pin(crate::std::math::log(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::log"),
        ),
        ("math", "log2") => (
            |e, a| Box::pin(crate::std::math::log2(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::log2"),
        ),
        ("math", "log10") => (
            |e, a| Box::pin(crate::std::math::log10(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::log10"),
        ),
        ("math", "ln") => (
            |e, a| Box::pin(crate::std::math::ln(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::ln"),
        ),
        ("math", "legLen") => (
            |e, a| Box::pin(crate::std::math::leg_length(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::legLen"),
        ),
        ("math", "legAngX") => (
            |e, a| Box::pin(crate::std::math::leg_angle_x(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::legAngX"),
        ),
        ("math", "legAngY") => (
            |e, a| Box::pin(crate::std::math::leg_angle_y(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::math::legAngY"),
        ),
        ("sketch", "circle") => (
            |e, a| Box::pin(crate::std::shapes::circle(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::circle").reads_regions_locally(),
        ),
        ("sketch", "ellipse") => (
            |e, a| Box::pin(crate::std::shapes::ellipse(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::ellipse").reads_regions_locally(),
        ),
        ("prelude", "helix") => (
            |e, a| Box::pin(crate::std::helix::helix(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::helix"),
        ),
        ("transform", "mirror2d") => (
            |e, a| Box::pin(crate::std::mirror::mirror_2d(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::transform::mirror2d"),
        ),
        ("transform", "mirror3d") => (
            |e, a| Box::pin(crate::std::mirror::mirror_3d(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::transform::mirror3d"),
        ),
        ("transform", "translate") => (
            |e, a| Box::pin(crate::std::transform::translate(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::transform::translate"),
        ),
        ("transform", "rotate") => (
            |e, a| Box::pin(crate::std::transform::rotate(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::transform::rotate"),
        ),
        ("transform", "scale") => (
            |e, a| Box::pin(crate::std::transform::scale(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::transform::scale"),
        ),
        ("transform", "hide") => (
            |e, a| Box::pin(crate::std::transform::hide(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::transform::hide").warn_deprecated_on_consumed_solid_args(),
        ),
        ("transform", "delete") => (
            |e, a| Box::pin(crate::std::transform::delete(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::transform::delete").consumes_regions(
                ConsumedRegionArg::new(ConsumedRegionOperation::Delete)
                    .deduplicate()
                    .warn_if_already_consumed(),
            ),
        ),
        ("prelude", "offsetPlane") => (
            |e, a| Box::pin(crate::std::planes::offset_plane(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::offsetPlane"),
        ),
        ("prelude", "assert") => (
            |e, a| Box::pin(crate::std::assert::assert(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::assert"),
        ),
        ("prelude", "assertIs") => (
            |e, a| Box::pin(crate::std::assert::assert_is(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::assertIs"),
        ),
        ("prelude", "fail") => (
            |e, a| Box::pin(crate::std::fail::fail(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::fail"),
        ),
        ("runtime", "exit") => (
            |e, a| Box::pin(crate::std::runtime::exit(e, a)),
            StdFnProps::default("std::runtime::exit"),
        ),
        ("string", "uppercase") => (
            |e, a| Box::pin(crate::std::string::uppercase(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::string::uppercase"),
        ),
        ("string", "lowercase") => (
            |e, a| Box::pin(crate::std::string::lowercase(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::string::lowercase"),
        ),
        ("string", "isEqual") => (
            |e, a| Box::pin(crate::std::string::is_equal(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::string::isEqual"),
        ),
        ("string", "trim") => (
            |e, a| Box::pin(crate::std::string::trim(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::string::trim"),
        ),
        ("string", "trimStart") => (
            |e, a| Box::pin(crate::std::string::trim_start(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::string::trimStart"),
        ),
        ("string", "trimEnd") => (
            |e, a| Box::pin(crate::std::string::trim_end(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::string::trimEnd"),
        ),
        ("string", "toString") => (
            |e, a| Box::pin(crate::std::string::number_to_string(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::string::toString"),
        ),
        ("solid", "fillet") => (
            |e, a| Box::pin(crate::std::fillet::fillet(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::fillet"),
        ),
        ("solid", "chamfer") => (
            |e, a| Box::pin(crate::std::chamfer::chamfer(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::chamfer"),
        ),
        ("solid", "shell") => (
            |e, a| Box::pin(crate::std::shell::shell(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::shell"),
        ),
        ("solid", "hollow") => (
            |e, a| Box::pin(crate::std::shell::hollow(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::hollow"),
        ),
        ("solid", "union") => (
            |e, a| Box::pin(crate::std::csg::union(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::union"),
        ),
        ("solid", "intersect") => (
            |e, a| Box::pin(crate::std::csg::intersect(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::intersect"),
        ),
        ("solid", "subtract") => (
            |e, a| Box::pin(crate::std::csg::subtract(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::subtract"),
        ),
        ("solid", "patternTransform") => (
            |e, a| Box::pin(crate::std::patterns::pattern_transform(e, a)),
            StdFnProps::default("std::solid::patternTransform").resumable(ResumableKind::PatternTransform),
        ),
        ("solid", "patternLinear3d") => (
            |e, a| Box::pin(crate::std::patterns::pattern_linear_3d(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::patternLinear3d"),
        ),
        ("solid", "patternCircular3d") => (
            |e, a| Box::pin(crate::std::patterns::pattern_circular_3d(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::patternCircular3d"),
        ),
        ("solid", "appearance") => (
            |e, a| Box::pin(crate::std::appearance::appearance(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::appearance"),
        ),
        ("solid", "flipSurface") => (
            |e, a| Box::pin(crate::std::surfaces::flip_surface(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::flipSurface"),
        ),
        ("solid", "split") => (
            |e, a| Box::pin(crate::std::csg::split(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::split"),
        ),
        ("array", "map") => (
            |e, a| Box::pin(crate::std::array::map(e, a)),
            StdFnProps::default("std::array::map")
                .reads_regions_locally()
                .resumable(ResumableKind::Map),
        ),
        ("array", "reduce") => (
            |e, a| Box::pin(crate::std::array::reduce(e, a)),
            StdFnProps::default("std::array::reduce")
                .reads_regions_locally()
                .resumable(ResumableKind::Reduce),
        ),
        ("array", "push") => (
            |e, a| Box::pin(crate::std::array::push(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::array::push").reads_regions_locally(),
        ),
        ("array", "pop") => (
            |e, a| Box::pin(crate::std::array::pop(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::array::pop").reads_regions_locally(),
        ),
        ("array", "concat") => (
            |e, a| Box::pin(crate::std::array::concat(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::array::concat").reads_regions_locally(),
        ),
        ("array", "slice") => (
            |e, a| Box::pin(crate::std::array::slice(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::array::slice").reads_regions_locally(),
        ),
        ("array", "flatten") => (
            |e, a| Box::pin(crate::std::array::flatten(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::array::flatten")
                .warn_deprecated_on_consumed_solid_args()
                .reads_regions_locally(),
        ),
        ("prelude", "clone") => (
            |e, a| Box::pin(crate::std::clone::clone(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::clone"),
        ),
        ("prelude", "faceId") => (
            |e, a| Box::pin(crate::std::ids::face_id(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::faceId"),
        ),
        ("prelude", "edgeId") => (
            |e, a| Box::pin(crate::std::ids::edge_id(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::edgeId"),
        ),
        ("sketch", "conic") => (
            |e, a| Box::pin(crate::std::sketch::conic(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::conic"),
        ),
        ("sketch", "parabolic") => (
            |e, a| Box::pin(crate::std::sketch::parabolic(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::parabolic"),
        ),
        ("sketch", "parabolicPoint") => (
            |e, a| Box::pin(crate::std::sketch::parabolic_point(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::parabolicPoint"),
        ),
        ("sketch", "hyperbolic") => (
            |e, a| Box::pin(crate::std::sketch::hyperbolic(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::hyperbolic"),
        ),
        ("sketch", "hyperbolicPoint") => (
            |e, a| Box::pin(crate::std::sketch::hyperbolic_point(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::hyperbolicPoint"),
        ),
        ("sketch", "elliptic") => (
            |e, a| Box::pin(crate::std::sketch::elliptic(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::elliptic"),
        ),
        ("sketch", "ellipticPoint") => (
            |e, a| Box::pin(crate::std::sketch::elliptic_point(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::ellipticPoint"),
        ),
        ("sketch", "rectangle") => (
            |e, a| Box::pin(crate::std::shapes::rectangle(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::rectangle").reads_regions_locally(),
        ),
        ("sketch", "planeOf") => (
            |e, a| Box::pin(crate::std::planes::plane_of(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::planeOf"),
        ),
        ("sketch", "faceOf") => (
            |e, a| Box::pin(crate::std::faces::face_of(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::faceOf"),
        ),
        ("sketch", "extrude") => (
            |e, a| Box::pin(crate::std::extrude::extrude(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::extrude")
                .consumes_regions(ConsumedRegionArg::new(ConsumedRegionOperation::Extrude).reject_alias_with("to")),
        ),
        ("sketch", "patternTransform2d") => (
            |e, a| Box::pin(crate::std::patterns::pattern_transform_2d(e, a)),
            StdFnProps::default("std::sketch::patternTransform2d").resumable(ResumableKind::PatternTransform2d),
        ),
        ("sketch", "revolve") => (
            |e, a| Box::pin(crate::std::revolve::revolve(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::revolve")
                .consumes_regions(ConsumedRegionArg::new(ConsumedRegionOperation::Revolve)),
        ),
        ("sketch", "sweep") => (
            |e, a| Box::pin(crate::std::sweep::sweep(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::sweep")
                .consumes_regions(ConsumedRegionArg::new(ConsumedRegionOperation::Sweep).preserve_alias_with("path")),
        ),
        ("sketch", "loft") => (
            |e, a| Box::pin(crate::std::loft::loft(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::loft"),
        ),
        ("sketch", "polygon") => (
            |e, a| Box::pin(crate::std::shapes::polygon(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::polygon").reads_regions_locally(),
        ),
        ("sketch", "circleThreePoint") => (
            |e, a| Box::pin(crate::std::shapes::circle_three_point(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::circleThreePoint").reads_regions_locally(),
        ),
        ("sketch", "getCommonEdge") => (
            |e, a| Box::pin(crate::std::edge::get_common_edge(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::getCommonEdge"),
        ),
        ("sketch", "getBoundedEdge") => (
            |e, a| Box::pin(crate::std::edge::get_bounded_edge(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::getBoundedEdge"),
        ),
        ("sketch", "getNextAdjacentEdge") => (
            |e, a| Box::pin(crate::std::edge::get_next_adjacent_edge(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::getNextAdjacentEdge"),
        ),
        ("sketch", "getOppositeEdge") => (
            |e, a| Box::pin(crate::std::edge::get_opposite_edge(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::getOppositeEdge"),
        ),
        ("sketch", "getPreviousAdjacentEdge") => (
            |e, a| Box::pin(crate::std::edge::get_previous_adjacent_edge(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::getPreviousAdjacentEdge"),
        ),
        ("sketch", "patternLinear2d") => (
            |e, a| Box::pin(crate::std::patterns::pattern_linear_2d(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::patternLinear2d"),
        ),
        ("sketch", "patternCircular2d") => (
            |e, a| Box::pin(crate::std::patterns::pattern_circular_2d(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::patternCircular2d"),
        ),
        ("sketch", "segEnd") => (
            |e, a| Box::pin(crate::std::segment::segment_end(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::segEnd"),
        ),
        ("sketch", "segEndX") => (
            |e, a| Box::pin(crate::std::segment::segment_end_x(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::segEndX"),
        ),
        ("sketch", "segEndY") => (
            |e, a| Box::pin(crate::std::segment::segment_end_y(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::segEndY"),
        ),
        ("sketch", "segStart") => (
            |e, a| Box::pin(crate::std::segment::segment_start(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::segStart"),
        ),
        ("sketch", "segStartX") => (
            |e, a| Box::pin(crate::std::segment::segment_start_x(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::segStartX"),
        ),
        ("sketch", "segStartY") => (
            |e, a| Box::pin(crate::std::segment::segment_start_y(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::segStartY"),
        ),
        ("sketch", "lastSegX") => (
            |e, a| Box::pin(crate::std::segment::last_segment_x(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::lastSegX").reads_regions_locally(),
        ),
        ("sketch", "lastSegY") => (
            |e, a| Box::pin(crate::std::segment::last_segment_y(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::lastSegY").reads_regions_locally(),
        ),
        ("sketch", "segLen") => (
            |e, a| Box::pin(crate::std::segment::segment_length(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::segLen"),
        ),
        ("sketch", "segAng") => (
            |e, a| Box::pin(crate::std::segment::segment_angle(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::segAng"),
        ),
        ("sketch", "tangentToEnd") => (
            |e, a| Box::pin(crate::std::segment::tangent_to_end(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::tangentToEnd"),
        ),
        ("sketch", "profileStart") => (
            |e, a| Box::pin(crate::std::sketch::profile_start(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::profileStart").reads_regions_locally(),
        ),
        ("sketch", "profileStartX") => (
            |e, a| Box::pin(crate::std::sketch::profile_start_x(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::profileStartX").reads_regions_locally(),
        ),
        ("sketch", "profileStartY") => (
            |e, a| Box::pin(crate::std::sketch::profile_start_y(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::profileStartY").reads_regions_locally(),
        ),
        ("sketch", "startSketchOn") => (
            |e, a| Box::pin(crate::std::sketch::start_sketch_on(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::startSketchOn"),
        ),
        ("sketch", "startProfile") => (
            |e, a| Box::pin(crate::std::sketch::start_profile(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::startProfile"),
        ),
        ("sketch", "involuteCircular") => (
            |e, a| Box::pin(crate::std::sketch::involute_circular(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::involuteCircular"),
        ),
        ("sketch", "line") => (
            |e, a| Box::pin(crate::std::sketch::line(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::line"),
        ),
        ("sketch", "xLine") => (
            |e, a| Box::pin(crate::std::sketch::x_line(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::xLine"),
        ),
        ("sketch", "yLine") => (
            |e, a| Box::pin(crate::std::sketch::y_line(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::yLine"),
        ),
        ("sketch", "angledLine") => (
            |e, a| Box::pin(crate::std::sketch::angled_line(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::angledLine"),
        ),
        ("sketch", "angledLineThatIntersects") => (
            |e, a| Box::pin(crate::std::sketch::angled_line_that_intersects(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::angledLineThatIntersects"),
        ),
        ("sketch", "close") => (
            |e, a| Box::pin(crate::std::sketch::close(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::close"),
        ),
        ("sketch", "arc") => (
            |e, a| Box::pin(crate::std::sketch::arc(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::arc"),
        ),
        ("sketch", "tangentialArc") => (
            |e, a| Box::pin(crate::std::sketch::tangential_arc(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::tangentialArc"),
        ),
        ("sketch", "bezierCurve") => (
            |e, a| Box::pin(crate::std::sketch::bezier_curve(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::bezierCurve"),
        ),
        ("sketch", "subtract2d") => (
            |e, a| Box::pin(crate::std::sketch::subtract_2d(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::subtract2d"),
        ),
        ("appearance", "hexString") => (
            |e, a| Box::pin(crate::std::appearance::hex_string(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::appearance::hexString"),
        ),
        ("solver", "point") => (
            |e, a| Box::pin(crate::std::constraints::point(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::point"),
        ),
        ("solver", "line") => (
            |e, a| Box::pin(crate::std::constraints::line(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::line"),
        ),
        ("solver", "arc") => (
            |e, a| Box::pin(crate::std::constraints::arc(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::arc"),
        ),
        ("solver", "circle") => (
            |e, a| Box::pin(crate::std::constraints::circle(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::circle"),
        ),
        ("solver", "controlPointSpline") => (
            |e, a| Box::pin(crate::std::constraints::control_point_spline(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::controlPointSpline"),
        ),
        ("solver", "coincident") => (
            |e, a| Box::pin(crate::std::constraints::coincident(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::coincident"),
        ),
        ("solver", "distance") => (
            |e, a| Box::pin(crate::std::constraints::distance(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::distance"),
        ),
        ("solver", "radius") => (
            |e, a| Box::pin(crate::std::constraints::radius(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::radius"),
        ),
        ("solver", "diameter") => (
            |e, a| Box::pin(crate::std::constraints::diameter(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::diameter"),
        ),
        ("solver", "horizontalDistance") => (
            |e, a| Box::pin(crate::std::constraints::horizontal_distance(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::horizontalDistance"),
        ),
        ("solver", "verticalDistance") => (
            |e, a| Box::pin(crate::std::constraints::vertical_distance(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::verticalDistance"),
        ),
        ("solver", "equalLength") => (
            |e, a| Box::pin(crate::std::constraints::equal_length(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::equalLength"),
        ),
        ("solver", "midpoint") => (
            |e, a| Box::pin(crate::std::constraints::midpoint(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::midpoint"),
        ),
        ("solver", "equalRadius") => (
            |e, a| Box::pin(crate::std::constraints::equal_radius(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::equalRadius"),
        ),
        ("solver", "angle") => (
            |e, a| Box::pin(crate::std::constraints::angle(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::angle"),
        ),
        ("solver", "angleDimension") => (
            |e, a| Box::pin(crate::std::constraints::angle_dimension(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::angleDimension"),
        ),
        ("solver", "tangent") => (
            |e, a| Box::pin(crate::std::constraints::tangent(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::tangent"),
        ),
        ("solver", "symmetric") => (
            |e, a| Box::pin(crate::std::constraints::symmetric(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::symmetric"),
        ),
        ("solver", "horizontal") => (
            |e, a| Box::pin(crate::std::constraints::horizontal(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::horizontal"),
        ),
        ("solver", "parallel") => (
            |e, a| Box::pin(crate::std::constraints::parallel(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::parallel"),
        ),
        ("solver", "perpendicular") => (
            |e, a| Box::pin(crate::std::constraints::perpendicular(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::perpendicular"),
        ),
        ("solver", "vertical") => (
            |e, a| Box::pin(crate::std::constraints::vertical(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solver::vertical"),
        ),
        ("sketch", "region") => (
            |e, a| Box::pin(crate::std::sketch::region(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::sketch::region"),
        ),
        ("solid", "isSurface") => (
            |e, a| Box::pin(crate::std::surfaces::is_surface(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::isSurface"),
        ),
        ("solid", "isSolid") => (
            |e, a| Box::pin(crate::std::surfaces::is_solid(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::isSolid"),
        ),
        ("solid", "deleteFace") => (
            |e, a| Box::pin(crate::std::surfaces::delete_face(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::deleteFace"),
        ),
        ("solid", "blend") => (
            |e, a| Box::pin(crate::std::surfaces::blend(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::blend"),
        ),
        ("solid", "joinSurfaces") => (
            |e, a| Box::pin(crate::std::surfaces::join(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::solid::joinSurfaces"),
        ),
        ("view", "oriented") => (
            |e, a| Box::pin(crate::std::view::oriented(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::view::oriented"),
        ),
        ("view", "directed") => (
            |e, a| Box::pin(crate::std::view::directed(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::view::directed"),
        ),
        ("view", "named") => (
            |e, a| Box::pin(crate::std::view::named(e, a).map(|r| r.map(KclValue::continue_))),
            StdFnProps::default("std::view::named"),
        ),
        (module, fn_name) => {
            panic!("No implementation found for {module}::{fn_name}, please add it to this big match statement")
        }
    }
}

pub(crate) fn std_ty(path: &str, fn_name: &str) -> (PrimitiveType, StdFnProps) {
    match (path, fn_name) {
        ("types", "Segment") => (PrimitiveType::Segment, StdFnProps::default("std::types::Segment")),
        ("types", "Sketch") => (PrimitiveType::Sketch, StdFnProps::default("std::types::Sketch")),
        ("types", "Solid") => (PrimitiveType::Solid, StdFnProps::default("std::types::Solid")),
        ("types", "Plane") => (PrimitiveType::Plane, StdFnProps::default("std::types::Plane")),
        ("types", "Face") => (PrimitiveType::Face, StdFnProps::default("std::types::Face")),
        ("types", "GdtAnnotation") => (
            PrimitiveType::GdtAnnotation,
            StdFnProps::default("std::types::GdtAnnotation"),
        ),
        ("types", "Helix") => (PrimitiveType::Helix, StdFnProps::default("std::types::Helix")),
        ("types", "Edge") => (PrimitiveType::Edge, StdFnProps::default("std::types::Edge")),
        ("types", "Axis2d") => (PrimitiveType::Axis2d, StdFnProps::default("std::types::Axis2d")),
        ("types", "Axis3d") => (PrimitiveType::Axis3d, StdFnProps::default("std::types::Axis3d")),
        ("types", "TaggedEdge") => (PrimitiveType::TaggedEdge, StdFnProps::default("std::types::TaggedEdge")),
        ("types", "TaggedFace") => (PrimitiveType::TaggedFace, StdFnProps::default("std::types::TaggedFace")),
        ("types", "BoundedEdge") => (
            PrimitiveType::BoundedEdge,
            StdFnProps::default("std::types::BoundedEdge"),
        ),
        ("view", "CameraView") => (PrimitiveType::CameraView, StdFnProps::default("std::view::CameraView")),
        ("view", "NamedView") => (PrimitiveType::NamedView, StdFnProps::default("std::view::NamedView")),
        _ => unreachable!(),
    }
}

/// The default tolerance for modeling commands in millimeters.
const DEFAULT_TOLERANCE_MM: f64 = 0.0000001;

/// The default tolerance for testing the equality of points.
/// WARNING: This must match the tolerance in engine/cpp/engine/scene/constants.h
#[allow(clippy::excessive_precision)]
const EQUAL_POINTS_DIST_EPSILON: f64 = 2.3283064365386962890625e-10;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CircularDirection {
    Counterclockwise,
    Clockwise,
}

impl CircularDirection {
    pub fn is_clockwise(self) -> bool {
        match self {
            CircularDirection::Counterclockwise => false,
            CircularDirection::Clockwise => true,
        }
    }
}
