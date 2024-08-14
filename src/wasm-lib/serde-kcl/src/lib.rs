//! # Serde KCL
//!
//! KCL (KittyCAD Language) has an object model similar to JSON.
//! This crate works similarly to serde_json.
#![deny(missing_docs)]

use serde::Serialize;

pub use crate::{error::Error, object::Object, value::Value};

mod error;
mod object;
mod value;

/// Convert a `T` into `serde_kcl::Value` which is an enum that can represent
/// any valid KCL data.
pub fn to_value<T>(value: T) -> Result<Value, Error>
where
    T: Serialize,
{
    value.serialize(crate::value::ser::Serializer)
}

/// Interpret a `serde_kcl::Value` as an instance of type `T`.
pub fn from_value<T>(value: Value) -> Result<T, Error>
where
    T: serde::de::DeserializeOwned,
{
    T::deserialize(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
    struct Person {
        name: String,
        age: u8,
    }

    impl Person {
        fn adam() -> Self {
            Person {
                name: "Adam".to_owned(),
                age: 32,
            }
        }
    }

    #[test]
    fn roundtrip_person() {
        let before = Person::adam();
        let after = from_value(to_value(&before).unwrap()).unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn deser_struct_from_kcl_object() {
        let serialized = Value::Object(Object {
            properties: std::collections::HashMap::from([
                ("name".to_owned(), Value::from("Adam".to_owned())),
                ("age".to_owned(), Value::from(32)),
            ]),
        });
        let actual: Person = from_value(serialized).unwrap();
        assert_eq!(actual, Person::adam());
    }

    #[test]
    fn ser_struct_into_kcl_object() {
        let val = to_value(Person::adam()).expect("Serializing to KCL object should pass");
        let obj = val.as_object().unwrap();
        let expected = Object {
            properties: std::collections::HashMap::from([
                ("name".to_owned(), Value::from("Adam".to_owned())),
                ("age".to_owned(), Value::from(32)),
            ]),
        };
        assert_eq!(obj.properties, expected.properties);
    }
}
