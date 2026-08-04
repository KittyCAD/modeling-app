//! The boundary between KCL arcs and the ezpz solver's arc inputs.
//!
//! The solver's [`ezpz::datatypes::inputs::DatumCircularArc`] always sweeps
//! counterclockwise from its start to its end, while KCL arcs sweep from
//! their declared start to their declared end in the direction given by
//! [`ArcDirection`]. Getting a solver arc's point order wrong silently
//! constrains the complementary portion of the circle, so constructing one
//! directly is banned by the `disallowed-types` entry in `clippy.toml`.
//! [`SolverArc`] is the one allowed way: it takes an arc's declared points
//! and direction, resolves the sweep order internally, and only hands out
//! finished constraints.
#![allow(clippy::disallowed_types, reason = "this module is the SolverArc choke point")]

use ezpz::datatypes::inputs::DatumCircularArc;
use ezpz::datatypes::inputs::DatumPoint;
use kcl_error::SourceRange;

use crate::KclError;
use crate::execution::SketchVarId;
use crate::front::ArcDirection;

/// An arc in the solver's counterclockwise convention. Constructing one from
/// an arc's declared endpoints and direction is the only way to build arc
/// constraints, so the sweep-order swap can't be forgotten.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SolverArc {
    /// Invariant: already in counterclockwise sweep order.
    datum: DatumCircularArc,
}

impl SolverArc {
    /// Create a solver arc from the arc's declared center, start, and end
    /// point variables. The points are reordered internally so that the
    /// solver sweeps them counterclockwise, matching the arc's direction.
    pub(crate) fn new(
        center: [SketchVarId; 2],
        declared_start: [SketchVarId; 2],
        declared_end: [SketchVarId; 2],
        direction: ArcDirection,
        range: SourceRange,
    ) -> Result<Self, KclError> {
        let datum_point = |point: [SketchVarId; 2]| -> Result<DatumPoint, KclError> {
            Ok(DatumPoint::new_xy(
                point[0].to_constraint_id(range)?,
                point[1].to_constraint_id(range)?,
            ))
        };
        let (sweep_start, sweep_end) = direction.ccw_order(declared_start, declared_end);
        Ok(Self {
            datum: DatumCircularArc {
                center: datum_point(center)?,
                start: datum_point(sweep_start)?,
                end: datum_point(sweep_end)?,
            },
        })
    }

    /// The implicit constraint that makes the three points an arc: the start
    /// and end are equidistant from the center.
    pub(crate) fn arc_constraint(self) -> ezpz::Constraint {
        ezpz::Constraint::Arc(self.datum)
    }

    /// Constrain a point to lie on the arc's swept portion of the circle.
    pub(crate) fn point_coincident_constraint(self, point: DatumPoint) -> ezpz::Constraint {
        ezpz::Constraint::PointArcCoincident(self.datum, point)
    }

    /// Constrain a point to lie at the midpoint of the arc's swept portion of
    /// the circle.
    pub(crate) fn point_bisects_constraints(self, point: DatumPoint) -> [ezpz::Constraint; 2] {
        ezpz::Constraint::point_bisects_arc(self.datum, point)
    }

    /// Constrain the arc's radius to a value in solver units.
    pub(crate) fn radius_constraint(self, radius: f64) -> ezpz::Constraint {
        ezpz::Constraint::ArcRadius(self.datum, radius)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CENTER: [SketchVarId; 2] = [SketchVarId(0), SketchVarId(1)];
    const START: [SketchVarId; 2] = [SketchVarId(2), SketchVarId(3)];
    const END: [SketchVarId; 2] = [SketchVarId(4), SketchVarId(5)];

    fn point_ids(point: DatumPoint) -> [ezpz::Id; 2] {
        [point.x_id, point.y_id]
    }

    #[test]
    fn counterclockwise_arc_keeps_declared_order() {
        let arc = SolverArc::new(CENTER, START, END, ArcDirection::Ccw, SourceRange::default()).unwrap();

        assert_eq!(point_ids(arc.datum.center), [0, 1]);
        assert_eq!(point_ids(arc.datum.start), [2, 3]);
        assert_eq!(point_ids(arc.datum.end), [4, 5]);
    }

    #[test]
    fn clockwise_arc_swaps_declared_start_and_end() {
        let arc = SolverArc::new(CENTER, START, END, ArcDirection::Cw, SourceRange::default()).unwrap();

        assert_eq!(point_ids(arc.datum.center), [0, 1]);
        assert_eq!(point_ids(arc.datum.start), [4, 5]);
        assert_eq!(point_ids(arc.datum.end), [2, 3]);
    }

    /// The `disallowed-types` entry in `clippy.toml` catches imports of the
    /// solver's arc datum type, but not fully-qualified expressions like
    /// `ezpz::datatypes::inputs::DatumCircularArc { .. }`. This test closes
    /// that gap: the type must not be named anywhere outside this module, so
    /// every solver arc goes through [`SolverArc`] and gets its sweep order
    /// resolved.
    #[test]
    fn solver_arc_datum_type_is_only_named_in_this_module() {
        fn collect_offenders(dir: &std::path::Path, offenders: &mut Vec<std::path::PathBuf>) {
            for entry in std::fs::read_dir(dir).expect("failed to read source directory") {
                let path = entry.expect("failed to read directory entry").path();
                if path.is_dir() {
                    collect_offenders(&path, offenders);
                    continue;
                }
                if path.extension().is_none_or(|ext| ext != "rs")
                    || path.ends_with(std::path::Path::new("execution").join("solver_arc.rs"))
                {
                    continue;
                }
                let contents = std::fs::read_to_string(&path).expect("failed to read source file");
                if contents.contains("DatumCircularArc") {
                    offenders.push(path);
                }
            }
        }

        let src_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut offenders = Vec::new();
        collect_offenders(&src_root, &mut offenders);
        assert!(
            offenders.is_empty(),
            "DatumCircularArc must only be used via SolverArc in execution/solver_arc.rs, \
             so that arc sweep order is always resolved for the solver. Found in: {offenders:?}"
        );
    }
}
