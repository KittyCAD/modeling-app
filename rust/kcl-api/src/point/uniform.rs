use super::{Point2d, Point3d, Point4d};

macro_rules! impl_uniform {
    ($typ:ident, $($i:ident),*) => {
        impl<T> $typ<T>
        where
            T: Copy,
        {
            /// Set all components to the same value.
            pub const fn uniform(value: T) -> Self {
                Self {
                    $(
                        $i: value,
                    )*
                }
            }
        }
    };
}

impl_uniform!(Point2d, x, y);
impl_uniform!(Point3d, x, y, z);
impl_uniform!(Point4d, x, y, z, w);
