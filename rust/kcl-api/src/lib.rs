//! An API for controlling the KCL interpreter from the frontend.

pub trait Lifecycle {}

pub struct Error {
    pub msg: String,
}

pub type Result<T> = std::result::Result<T, Error>;
