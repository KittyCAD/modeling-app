use crate::datatypes::*;
use kittycad_modeling_cmds::shared::Angle;

pub mod datatypes;
pub mod equations;

pub enum Constraint {
    /// Also length.
    Distance(DatumPoint, DatumPoint),
    /// Also point-on-line
    DistancePointToLine(DatumPoint, DatumLine),
    /// Also perpendicular, parallel, tangent
    Angle(DatumLine, Angle),
    /// Two points are the same
    Coincident(DatumPoint, DatumPoint),
    /// These two points have the same Y value.
    Vertical(DatumPoint, DatumPoint),
    /// These two points have the same X value.
    Horizontal(DatumPoint, DatumPoint),
    /// Two points symmetric across a line.
    Symmetric(DatumLine, DatumPoint, DatumPoint),
}

// impl From<Constraint> for Equation {
//     fn from(constraint: Constraint) -> Self {
//         match constraint {
//             Constraint::Distance(p0, p1) => todo!(),
//             Constraint::DistancePointToLine(p, line) => todo!(),
//             Constraint::Angle(line, angle) => todo!(),
//             Constraint::Coincident(p0, p1) => todo!(),
//             Constraint::Vertical(p0, p1) => todo!(),
//             Constraint::Horizontal(p0, p1) => todo!(),
//             Constraint::Symmetric(line, p0, p1) => todo!(),
//         }
//     }
// }
