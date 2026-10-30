//! Snapshot one stack and its arena as a unit so restored references all share
//! the same memory. Callers must quiesce execution before taking a snapshot.

use serde::Deserialize;
use serde::Deserializer;
use serde::Serialize;
use serde::Serializer;

use super::*;
use crate::execution::memory::snapshot;

const FORMAT_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StackSnapshot {
    version: u32,
    id: u32,
    #[serde(with = "snapshot")]
    current_env: EnvironmentRef,
    #[serde(with = "snapshot")]
    call_stack: Vec<EnvironmentRef>,
    #[serde(with = "snapshot")]
    std: Option<EnvironmentRef>,
    epoch: u32,
    next_stack_id: u32,
    #[serde(with = "snapshot")]
    environments: Vec<Environment>,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "Environment")]
struct EnvironmentSnapshot {
    #[serde(with = "snapshot")]
    bindings: IndexMap<String, (usize, KclValue)>,
    #[serde(with = "snapshot")]
    parent: Option<EnvironmentRef>,
    might_be_refed: bool,
    parent_pin: ParentPin,
    owner: usize,
}
snapshot::snapshot_type!(Environment, EnvironmentSnapshot);

impl Serialize for Stack {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::Error;
        fn portable(value: usize) -> Result<u32, &'static str> {
            u32::try_from(value)
                .ok()
                .filter(|v| *v < u32::MAX)
                .ok_or("memory snapshot exceeds the wasm32 index range")
        }
        let envs = self
            .memory
            .read_env_table("serializing memory")
            .map_err(S::Error::custom)?;
        let environments = envs
            .iter()
            .enumerate()
            .map(|(index, env)| {
                let env = self
                    .memory
                    .read_env(env, index, "serializing memory")
                    .map_err(S::Error::custom)?;
                if env.owner != 0 && env.owner != self.id {
                    return Err(S::Error::custom("cannot snapshot memory owned by another active stack"));
                }
                Ok(Environment {
                    bindings: env.bindings.clone(),
                    parent: env.parent,
                    might_be_refed: env.might_be_refed,
                    parent_pin: env.parent_pin,
                    owner: env.owner,
                })
            })
            .collect::<Result<Vec<_>, S::Error>>()?;
        StackSnapshot {
            version: FORMAT_VERSION,
            id: portable(self.id).map_err(S::Error::custom)?,
            current_env: self.current_env,
            call_stack: self.call_stack.clone(),
            std: self.memory.std.get().copied(),
            epoch: portable(self.memory.epoch.load(Ordering::Relaxed)).map_err(S::Error::custom)?,
            next_stack_id: portable(self.memory.next_stack_id.load(Ordering::Relaxed)).map_err(S::Error::custom)?,
            environments,
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Stack {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        let value = StackSnapshot::deserialize(deserializer)?;
        value.validate().map_err(D::Error::custom)?;
        let memory = Arc::new(ProgramMemory {
            std: once_lock_copy(value.std),
            stats: MemoryStats::default(),
            next_stack_id: AtomicUsize::new(value.next_stack_id as usize),
            epoch: AtomicUsize::new(value.epoch as usize),
            environments: RwLock::new(
                value
                    .environments
                    .into_iter()
                    .map(|env| Arc::new(RwLock::new(env)))
                    .collect(),
            ),
        });
        Ok(Self {
            memory,
            id: value.id as usize,
            current_env: value.current_env,
            call_stack: value.call_stack,
        })
    }
}

impl StackSnapshot {
    fn validate(&self) -> Result<(), &'static str> {
        if self.version != FORMAT_VERSION {
            return Err("unsupported memory snapshot version");
        }
        if self.id == 0
            || self.next_stack_id <= self.id
            || self.next_stack_id == u32::MAX
            || self.epoch == 0
            || self.epoch == u32::MAX
        {
            return Err("invalid memory snapshot counters");
        }
        let check = |env: EnvironmentRef| {
            if env == EnvironmentRef::dummy() {
                return Ok(());
            }
            if env.index() >= self.environments.len()
                || env.epoch() == 0
                || (env.epoch() != usize::MAX && env.epoch() > self.epoch as usize)
            {
                return Err("memory snapshot contains an invalid environment reference");
            }
            Ok(())
        };
        check(self.current_env)?;
        for env in &self.call_stack {
            check(*env)?;
        }
        if let Some(env) = self.std {
            if !env.is_regular() {
                return Err("invalid prelude environment");
            }
            check(env)?;
        }
        for env in &self.environments {
            if env.owner != 0 && env.owner != self.id as usize {
                return Err("memory snapshot contains a foreign stack owner");
            }
            if let Some(parent) = env.parent {
                if !parent.is_regular() {
                    return Err("invalid parent environment");
                }
                check(parent)?;
            }
            for (epoch, value) in env.bindings.values() {
                if *epoch == 0 || *epoch > self.epoch as usize {
                    return Err("invalid binding epoch");
                }
                check_value_refs(value, &check)?;
            }
        }
        // Parent cycles would make a missing-name lookup loop forever.
        let mut visited = vec![false; self.environments.len()];
        for start in 0..self.environments.len() {
            let mut path = Vec::new();
            let mut index = Some(start);
            while let Some(current) = index {
                if visited[current] {
                    break;
                }
                if path.contains(&current) {
                    return Err("cyclic snapshot environments");
                }
                path.push(current);
                index = self.environments[current].parent.map(|parent| parent.index());
            }
            for index in path {
                visited[index] = true;
            }
        }
        Ok(())
    }
}

fn check_value_refs(
    value: &KclValue,
    check: &impl Fn(EnvironmentRef) -> Result<(), &'static str>,
) -> Result<(), &'static str> {
    match value {
        KclValue::Function { value, .. } => {
            if let crate::execution::kcl_value::FunctionBody::Kcl(env) = value.body {
                if !env.is_regular() {
                    return Err("invalid closure environment");
                }
                check(env)?;
            }
        }
        KclValue::Tuple { value, .. } | KclValue::HomArray { value, .. } => {
            for value in value {
                check_value_refs(value, check)?;
            }
        }
        KclValue::Object { value, .. } => {
            let mut keys = value.keys().collect::<Vec<_>>();
            keys.sort();
            for key in keys {
                check_value_refs(&value[key], check)?;
            }
        }
        _ => {}
    }
    Ok(())
}
