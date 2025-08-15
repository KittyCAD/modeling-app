use indexmap::IndexSet;
use kittycad_modeling_cmds::shared::Angle;

use crate::{datatypes::*, equations::*};

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

#[derive(Default)]
#[cfg_attr(test, derive(Debug))]
pub struct System {
    equations: Vec<Equation>,
    variables: IndexSet<Label>,
}

impl std::ops::Add for System {
    type Output = Self;

    fn add(mut self, rhs: Self) -> Self::Output {
        self.equations.extend(rhs.equations);
        self.variables.extend(rhs.variables);
        self
    }
}

impl std::ops::AddAssign for System {
    fn add_assign(&mut self, rhs: Self) {
        self.equations.extend(rhs.equations);
        self.variables.extend(rhs.variables);
    }
}

impl FromIterator<System> for System {
    fn from_iter<T: IntoIterator<Item = System>>(iter: T) -> Self {
        let mut system = System::default();
        for sys in iter {
            system += sys;
        }
        system
    }
}

impl Constraint {
    pub fn into_system(self, system: &mut System) {
        // For now, just for ease of debugging, use strings.
        // When we are ready to actually measure performance, change to numeric IDs.
        match self {
            Constraint::Distance(p0, p1) => todo!(),
            Constraint::DistancePointToLine(p, line) => todo!(),
            Constraint::Angle(line, angle) => todo!(),
            Constraint::Coincident(p0, p1) => {
                system
                    .variables
                    .extend([p1.label_y(), p0.label_y(), p1.label_x(), p0.label_x()]);
                system.equations.extend([
                    Equation::single_variable(p1.label_y()) - Equation::single_variable(p0.label_y()),
                    Equation::single_variable(p1.label_x()) - Equation::single_variable(p0.label_x()),
                ]);
            }
            Constraint::Vertical(p0, p1) => {
                system.variables.extend([p1.label_x(), p0.label_x()]);
                system
                    .equations
                    .push(Equation::single_variable(p1.label_x()) - Equation::single_variable(p0.label_x()));
            }
            Constraint::Horizontal(p0, p1) => {
                system.variables.extend([p1.label_y(), p0.label_y()]);
                system
                    .equations
                    .push(Equation::single_variable(p1.label_y()) - Equation::single_variable(p0.label_y()));
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
        let mut system = System::default();
        for constraint in constraints {
            constraint.into_system(&mut system);
        }
        dbg!(&system);
    }
}
