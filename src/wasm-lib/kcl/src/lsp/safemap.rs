//! A map type that is safe to use in a concurrent environment.
//! But also in wasm.
//! Previously, we used `dashmap::DashMap` for this purpose, but it doesn't work in wasm.

use std::{collections::HashMap, hash::Hash, sync::Arc};

use tokio::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

/// A thread-safe map type.
#[derive(Clone, Debug)]
pub struct SafeMap<K: Eq + Hash, V>(Arc<RwLock<HashMap<K, V>>>);

impl<'a, K: 'a + Eq + Hash, V: 'a> SafeMap<K, V> {
    /// Create a new empty map.
    pub fn new() -> Self {
        SafeMap(Arc::new(RwLock::new(HashMap::new())))
    }

    pub async fn len(&self) -> usize {
        self.0.read().await.len()
    }

    pub async fn is_empty(&self) -> bool {
        self.0.read().await.is_empty()
    }

    pub async fn clear(&self) {
        self.0.write().await.clear();
    }

    /// Insert a key-value pair into the map.
    pub async fn insert(&self, key: K, value: V) {
        self.0.write().await.insert(key, value);
    }

    /// Remove the key-value pair associated with the given key.
    pub async fn remove(&self, key: &K) -> Option<V> {
        self.0.write().await.remove(key)
    }

    /// Get a reference to the underlying map.
    pub async fn inner(&'a self) -> RwLockReadGuard<'a, HashMap<K, V>> {
        self.0.read().await
    }

    /// Get a mutable reference to the underlying map.
    pub async fn write(&'a self) -> RwLockWriteGuard<'a, HashMap<K, V>> {
        self.0.write().await
    }
}

impl<K: Eq + Hash, V> Default for SafeMap<K, V> {
    fn default() -> Self {
        SafeMap::new()
    }
}
