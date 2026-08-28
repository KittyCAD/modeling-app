use super::{Point2d, Point3d, Point4d};

impl Point2d<f64> {
    /// Set all components to zero.
    pub const fn zero() -> Self {
        Self::uniform(0.0)
    }
}

impl Point3d<f64> {
    /// Set all components to zero.
    pub const fn zero() -> Self {
        Self::uniform(0.0)
    }
}

impl Point4d<f64> {
    /// Set all components to zero.
    pub const fn zero() -> Self {
        Self::uniform(0.0)
    }
}
