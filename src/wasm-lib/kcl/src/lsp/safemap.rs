//! A map type that is safe to use in a concurrent environment.
//! But also in wasm.
//! Previously, we used `dashmap::DashMap` for this purpose, but it doesn't work in wasm.

use std::{borrow::Borrow, collections::HashMap, hash::Hash, sync::Arc};

use tokio::sync::RwLock;

/// A thread-safe map type.
#[derive(Clone, Debug)]
pub struct SafeMap<K: Eq + Hash + Clone, V: Clone>(Arc<RwLock<HashMap<K, V>>>);

impl<K: Eq + Hash + Clone, V: Clone> SafeMap<K, V> {
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

    /// Get a reference to the value associated with the given key.
    pub async fn get<Q>(&self, key: &Q) -> Option<V>
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        self.0.read().await.get(key).cloned()
    }

    /// Remove the key-value pair associated with the given key.
    pub async fn remove(&self, key: &K) -> Option<V> {
        self.0.write().await.remove(key)
    }

    /// Get a reference to the underlying map.
    pub async fn inner(&self) -> HashMap<K, V> {
        self.0.read().await.clone()
    }
}

impl<K: Eq + Hash + Clone, V: Clone> Default for SafeMap<K, V> {
    fn default() -> Self {
        SafeMap::new()
    }
}
