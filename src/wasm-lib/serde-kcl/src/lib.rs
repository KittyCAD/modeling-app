use serde::Serialize;

pub use crate::error::Error;
pub use crate::object::Object;
pub use crate::value::Value;

mod error;
mod object;
mod value;

pub fn to_value<T>(value: T) -> Result<Value, Error>
where
    T: Serialize,
{
    value.serialize(crate::value::ser::Serializer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structs_into_kcl_object() {
        #[derive(serde::Serialize)]
        struct Person {
            name: String,
            age: u8,
        }

        let adam = Person {
            name: "Adam".to_owned(),
            age: 32,
        };
        let val = to_value(&adam).expect("Serializing to KCL object should pass");
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
