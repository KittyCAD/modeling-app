use kittycad_modeling_cmds::shared::Angle;
use libm::{cos, sin};

/// 1D distance.
pub type Distance = f64;

/// 2D point.
pub type DatumPoint = kittycad_modeling_cmds::shared::Point2d<Distance>;

/// Line of infinite length.
pub struct DatumLine {
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
    pub fn some_point(&self) -> DatumPoint {
        let x = -self.a * sin(self.theta.to_radians());
        let y = self.a * cos(self.theta.to_radians());
        DatumPoint { x, y }
    }
}

/// Finite segment of a line.
pub struct LineSegment(pub DatumPoint, pub DatumPoint);

/// A circle.
pub struct Circle {
    pub center: DatumPoint,
    pub radius: Distance,
}

/// Arc on the perimeter of a circle.
pub struct CircularArc {
    /// Center of the circle
    pub center: DatumPoint,
    /// Lies on the arc.
    /// Distance(A,center) == Distance(B,center)
    pub a: DatumPoint,
    /// Lies on the arc.
    /// Distance(A,center) == Distance(B,center)
    pub b: DatumPoint,
}
