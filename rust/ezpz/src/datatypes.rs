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
/// their human-friendly ids for debugging. No runtime cost, conditionally compiled
/// only for test mode.
#[derive(Clone, Copy, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct Id([char; 10]);

impl std::fmt::Display for Id {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for ch in self.0 {
            write!(f, "{ch}")?;
        }
        Ok(())
    }
}
impl std::fmt::Debug for Id {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for ch in self.0 {
            write!(f, "{ch}")?;
        }
        Ok(())
    }
}

/// 1D distance.
pub type Distance = f64;

/// 2D point.
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
        self.id.clone()
    }

    /// Id for the X component of the point.
    pub fn id_x(&self) -> Id {
        let mut s = self.id;
        s.0[9] = 'x';
        s
    }

    /// Id for the Y component of the point.
    pub fn id_y(&self) -> Id {
        let mut s = self.id;
        s.0[9] = 'y';
        s
    }
}

/// Line of infinite length.
pub struct DatumLine {
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
pub struct LineSegment {
    id: Id,
    pub p0: DatumPoint,
    pub p1: DatumPoint,
}

/// A circle.
pub struct Circle {
    id: Id,
    pub center: DatumPoint,
    pub radius: Distance,
}

/// Arc on the perimeter of a circle.
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
