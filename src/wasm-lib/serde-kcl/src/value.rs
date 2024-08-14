use crate::Object;

pub(crate) mod ser;

#[derive(Debug, PartialEq)]
pub enum Value {
    /// A value to use when the specific value isn't really important.
    /// For example, this is the return type of functions that don't return
    /// any other value.
    ///
    /// Don't worry about it too much.
    ///
    /// Kind of like 'null' in other languages, but it doesn't have the
    /// connotation that nothing was missing. It probably means nothing was
    /// required, not nothing was found.
    Unit,
    /// Either true or false.
    Boolean(bool),
    /// Text.
    String(String),
    /// Whole numbers (positive, negative or zero).
    Integer(i64),
    /// Numbers with a fractional part.
    Float(f64),
    /// A list of other values.
    Array(Vec<Value>),
    /// A set of properties. Each property has a name (aka "key") and a value.
    Object(Object),
    /// Binary data
    Bytes(Vec<u8>),
}

macro_rules! impl_as {
    ($name:ident, $variant:ident, $return_type:ty) => {
        pub fn $name(&self) -> Option<&$return_type> {
            match self {
                Self::$variant(x) => Some(x),
                _ => None,
            }
        }
    };
}

macro_rules! impl_from {
    ($variant:ident, $t:ty) => {
        impl From<$t> for Value {
            fn from(t: $t) -> Self {
                Self::$variant(t.into())
            }
        }
    };
}

impl Value {
    impl_as!(as_boolean, Boolean, bool);
    impl_as!(as_string, String, String);
    impl_as!(as_integer, Integer, i64);
    impl_as!(as_float, Float, f64);
    impl_as!(as_array, Array, Vec<Value>);
    impl_as!(as_object, Object, Object);
    impl_as!(as_binary, Bytes, Vec<u8>);
    pub fn as_unit(&self) -> Option<()> {
        match self {
            Self::Unit => Some(()),
            _ => None,
        }
    }
}
impl_from!(String, String);
impl_from!(Boolean, bool);
impl_from!(Integer, i64);
impl_from!(Integer, i32);
impl_from!(Integer, u32);
impl_from!(Integer, u8);
impl_from!(Integer, i8);
impl_from!(Float, f64);
impl_from!(Float, f32);
impl_from!(Bytes, Vec<u8>);

impl From<()> for Value {
    fn from(_: ()) -> Self {
        Self::Unit
    }
}
