//! The boundary between KCL arcs and the ezpz solver's arc inputs.
//!
//! The solver's [`ezpz::datatypes::inputs::DatumCircularArc`] always sweeps
//! counterclockwise from its start to its end, while KCL arcs sweep from
//! their declared start to their declared end in the direction given by
//! [`ArcDirection`]. Getting a solver arc's point order wrong silently
//! constrains the complementary portion of the circle, so `clippy.toml` bans
//! naming the datum type (`disallowed-types`) and calling any of the solver's
//! arc constraint constructors (`disallowed-methods`). [`SolverArc`] is the
//! one allowed way: it takes an arc's declared points and direction, resolves
//! the sweep order internally, and only hands out finished constraints.
//!
//! Each banned usage in this module carries its own `#[expect]` so that the
//! module stays subject to every other disallowed type and method, and so
//! that stale exemptions turn into errors.

#[expect(
    clippy::disallowed_types,
    reason = "SolverArc is the one place allowed to hold the solver's arc datum"
)]
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
    center: DatumPoint,
    /// Invariant: already the start of the counterclockwise sweep.
    sweep_start: DatumPoint,
    /// Invariant: already the end of the counterclockwise sweep.
    sweep_end: DatumPoint,
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
            center: datum_point(center)?,
            sweep_start: datum_point(sweep_start)?,
            sweep_end: datum_point(sweep_end)?,
        })
    }

    /// The solver's datum for this arc, in its counterclockwise convention.
    #[expect(
        clippy::disallowed_types,
        reason = "SolverArc is the one place allowed to build the solver's arc datum"
    )]
    fn datum(self) -> DatumCircularArc {
        DatumCircularArc {
            center: self.center,
            start: self.sweep_start,
            end: self.sweep_end,
        }
    }

    /// The implicit constraint that makes the three points an arc: the start
    /// and end are equidistant from the center.
    #[expect(
        clippy::disallowed_methods,
        reason = "SolverArc is the one place allowed to build solver arc constraints"
    )]
    pub(crate) fn arc_constraint(self) -> ezpz::Constraint {
        ezpz::Constraint::Arc(self.datum())
    }

    /// Constrain a point to lie on the arc's swept portion of the circle.
    #[expect(
        clippy::disallowed_methods,
        reason = "SolverArc is the one place allowed to build solver arc constraints"
    )]
    pub(crate) fn point_coincident_constraint(self, point: DatumPoint) -> ezpz::Constraint {
        ezpz::Constraint::PointArcCoincident(self.datum(), point)
    }

    /// Constrain a point to lie at the midpoint of the arc's swept portion of
    /// the circle.
    #[expect(
        clippy::disallowed_methods,
        reason = "SolverArc is the one place allowed to build solver arc constraints"
    )]
    pub(crate) fn point_bisects_constraints(self, point: DatumPoint) -> [ezpz::Constraint; 2] {
        ezpz::Constraint::point_bisects_arc(self.datum(), point)
    }

    /// Constrain the arc's radius to a value in solver units.
    #[expect(
        clippy::disallowed_methods,
        reason = "SolverArc is the one place allowed to build solver arc constraints"
    )]
    pub(crate) fn radius_constraint(self, radius: f64) -> ezpz::Constraint {
        ezpz::Constraint::ArcRadius(self.datum(), radius)
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

        let datum = arc.datum();
        assert_eq!(point_ids(datum.center), [0, 1]);
        assert_eq!(point_ids(datum.start), [2, 3]);
        assert_eq!(point_ids(datum.end), [4, 5]);
    }

    #[test]
    fn clockwise_arc_swaps_declared_start_and_end() {
        let arc = SolverArc::new(CENTER, START, END, ArcDirection::Cw, SourceRange::default()).unwrap();

        let datum = arc.datum();
        assert_eq!(point_ids(datum.center), [0, 1]);
        assert_eq!(point_ids(datum.start), [4, 5]);
        assert_eq!(point_ids(datum.end), [2, 3]);
    }
}
