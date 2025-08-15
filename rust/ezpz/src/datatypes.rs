use kittycad_modeling_cmds::shared::Angle;
use libm::{cos, sin};

pub type Label = String;

/// 1D distance.
pub type Distance = f64;

/// 2D point.
pub struct DatumPoint {
    pub label: Label,
    pub point: kittycad_modeling_cmds::shared::Point2d<Distance>,
}

/// Line of infinite length.
pub struct DatumLine {
    pub label: Label,
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
pub struct LineSegment {
    pub label: Label,
    pub p0: DatumPoint,
    pub p1: DatumPoint,
}

/// A circle.
pub struct Circle {
    pub label: Label,
    pub center: DatumPoint,
    pub radius: Distance,
}

/// Arc on the perimeter of a circle.
pub struct CircularArc {
    pub label: Label,
    /// Center of the circle
    pub center: DatumPoint,
    /// Lies on the arc.
    /// Distance(A,center) == Distance(B,center)
    pub a: DatumPoint,
    /// Lies on the arc.
    /// Distance(A,center) == Distance(B,center)
    pub b: DatumPoint,
}
