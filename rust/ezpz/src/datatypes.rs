use kittycad_modeling_cmds::shared::Angle;
use libm::{cos, sin};

use crate::id::Id;

/// 1D distance.
pub type Distance = f64;

/// 2D point.
#[derive(Clone, Copy)]
pub struct DatumPoint {
    id: Id,
}

impl DatumPoint {
    pub fn new(id: Id) -> Self {
        Self { id }
    }
}

impl DatumPoint {
    /// Id for this.
    pub fn id(&self) -> Id {
        self.id
    }

    /// Id for the X component of the point.
    pub fn id_x(&self) -> Id {
        self.id.child_x_component()
    }

    /// Id for the Y component of the point.
    pub fn id_y(&self) -> Id {
        self.id.child_y_component()
    }
}

/// Line of infinite length.
#[derive(Clone, Copy)]
pub struct DatumLine {
    #[allow(dead_code)]
    id: Id,
    // Unusual representation of a line using two parameters, theta and A
    theta: Angle,
    a: f64,
}

impl DatumLine {
    /// Get gradient of the line dx/dy.
    pub fn direction(&self) -> f64 {
        let dx = cos(self.theta.to_radians());
        let dy = sin(self.theta.to_radians());
        dx / dy
    }

    /// Get an arbitrary point on this line.
    pub fn some_point(&self) -> kittycad_modeling_cmds::shared::Point2d<f64> {
        let x = -self.a * sin(self.theta.to_radians());
        let y = self.a * cos(self.theta.to_radians());
        kittycad_modeling_cmds::shared::Point2d { x, y }
    }
}

/// Finite segment of a line.
#[derive(Clone, Copy)]
pub struct LineSegment {
    pub id: Id,
    pub p0: DatumPoint,
    pub p1: DatumPoint,
}

/// A circle.
#[allow(dead_code)]
pub struct Circle {
    id: Id,
    pub center: DatumPoint,
    pub radius: Distance,
}

/// Arc on the perimeter of a circle.
#[allow(dead_code)]
pub struct CircularArc {
    id: Id,
    /// Center of the circle
    pub center: DatumPoint,
    /// Lies on the arc.
    /// Distance(A,center) == Distance(B,center)
    pub a: DatumPoint,
    /// Lies on the arc.
    /// Distance(A,center) == Distance(B,center)
    pub b: DatumPoint,
}
