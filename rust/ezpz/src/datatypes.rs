use kittycad_modeling_cmds::shared::Angle;
use libm::{cos, sin};

/// TODO: For performance reasons this should be a number not a string.
/// Numeric IDs should allow calculating the IDs of children from parents,
/// e.g. the IDs of a line segment's points should be a pure function
/// of the parent's ID. That way we can calculate IDs easily instead of
/// looking them up in some data structure.
///
/// But for now, let's use strings because they're easy to debug. Soon we can
/// keep a numeric ID and have a Map<Id, String> to look up numeric IDs and find
/// their human-friendly labels for debugging. No runtime cost, conditionally compiled
/// only for test mode.
pub type Label = String;

/// 1D distance.
pub type Distance = f64;

/// 2D point.
pub struct DatumPoint {
    label: Label,
}

impl DatumPoint {
    pub fn new(label: Label) -> Self {
        Self { label }
    }
}

type Id = String;

impl DatumPoint {
    /// Label for this.
    pub fn label(&self) -> Id {
        self.label.clone()
    }

    /// Label for the X component of the point.
    pub fn label_x(&self) -> Id {
        format!("{}x", self.label)
    }

    /// Label for the Y component of the point.
    pub fn label_y(&self) -> Id {
        format!("{}y", self.label)
    }
}

/// Line of infinite length.
pub struct DatumLine {
    label: Label,
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
    label: Label,
    pub p0: DatumPoint,
    pub p1: DatumPoint,
}

/// A circle.
pub struct Circle {
    label: Label,
    pub center: DatumPoint,
    pub radius: Distance,
}

/// Arc on the perimeter of a circle.
pub struct CircularArc {
    label: Label,
    /// Center of the circle
    pub center: DatumPoint,
    /// Lies on the arc.
    /// Distance(A,center) == Distance(B,center)
    pub a: DatumPoint,
    /// Lies on the arc.
    /// Distance(A,center) == Distance(B,center)
    pub b: DatumPoint,
}
