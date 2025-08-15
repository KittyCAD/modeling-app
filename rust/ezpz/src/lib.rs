use crate::datatypes::*;
use crate::equations::*;
use kittycad_modeling_cmds::shared::Angle;

pub mod datatypes;
pub mod equations;
pub mod solver;

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

impl Constraint {
    pub fn into_equations(self) -> Vec<Equation> {
        // For now, just for ease of debugging, use strings.
        // When we are ready to actually measure performance, change to numeric IDs.
        match self {
            Constraint::Distance(p0, p1) => todo!(),
            Constraint::DistancePointToLine(p, line) => todo!(),
            Constraint::Angle(line, angle) => todo!(),
            Constraint::Coincident(p0, p1) => {
                vec![
                    Equation::single_variable(format!("{}y", p1.label()))
                        - Equation::single_variable(format!("{}y", p0.label())),
                    Equation::single_variable(format!("{}x", p1.label()))
                        - Equation::single_variable(format!("{}x", p0.label())),
                ]
            }
            Constraint::Vertical(p0, p1) => {
                vec![
                    Equation::single_variable(format!("{}x", p1.label()))
                        - Equation::single_variable(format!("{}x", p0.label())),
                ]
            }
            Constraint::Horizontal(p0, p1) => {
                vec![
                    Equation::single_variable(format!("{}y", p1.label()))
                        - Equation::single_variable(format!("{}y", p0.label())),
                ]
            }
            Constraint::Symmetric(line, p0, p1) => todo!(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_into_equations() {
        let constraints = vec![Constraint::Coincident(
            DatumPoint::new("p".to_owned()),
            DatumPoint::new("q".to_owned()),
        )];
        let equations: Vec<_> = constraints.into_iter().flat_map(|c| c.into_equations()).collect();
        dbg!(&equations);
    }
}
