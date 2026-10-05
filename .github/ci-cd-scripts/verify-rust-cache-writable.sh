#!/usr/bin/env bash

set -euo pipefail

target_dir="${CARGO_TARGET_DIR:-rust/target}"
mkdir -p "${target_dir}"

probe="${target_dir}/.write-probe-${GITHUB_RUN_ID:-local}-${GITHUB_JOB:-local}-$$"
trap 'rm -f "${probe}"' EXIT
: > "${probe}"
rm "${probe}"
trap - EXIT

shopt -s nullglob
for cache_path in "${target_dir}" "${target_dir}"/*; do
  if [[ -d "${cache_path}" && ! -w "${cache_path}" ]]; then
    ls -ldn "${cache_path}"
    echo "::error file=${cache_path}::Rust cache directory is not writable by uid $(id -u)"
    exit 1
  fi
done

for lock_file in "${target_dir}"/*/.cargo-lock "${target_dir}"/*/.cargo-*-lock; do
  if [[ -f "${lock_file}" && ! -w "${lock_file}" ]]; then
    ls -ldn "${lock_file}"
    echo "::error file=${lock_file}::Rust cache lock is not writable by uid $(id -u)"
    exit 1
  fi
done

ls -ldn "${target_dir}"
echo "Rust cache is writable by uid $(id -u), gid $(id -g): ${target_dir}"
