use crate::datatypes::*;
use kittycad_modeling_cmds::shared::Angle;

pub mod datatypes;

pub enum Constraint {
    /// Also length.
    Distance(DatumPoint, DatumPoint),
    /// Also point-on-line
    DistancePointToLine(DatumPoint, DatumLine),
    /// Also perpendicular, parallel, tangent
    Angle(DatumLine, Angle),
    /// Two points are the same
    Coincident(DatumPoint, DatumPoint),
    /// Two scalars are the same.
    /// Also vertical, horizontal
    Equal(f64, f64),
    /// Two points symmetric across a line.
    Symmetric(DatumLine, DatumPoint, DatumPoint),
}

impl Constraint {}
