#!/usr/bin/env sh

if [ -f "$HOME/.cargo/env" ]; then
  . "$HOME/.cargo/env"
elif [ -f "/rust/env" ]; then
  . "/rust/env"
fi
