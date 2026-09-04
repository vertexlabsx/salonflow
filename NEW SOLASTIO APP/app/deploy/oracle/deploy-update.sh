#!/usr/bin/env bash
set -euo pipefail

cd "/opt/solastio"

echo "== pull =="
git pull --ff-only

echo "== build rust api =="
cargo build --workspace --release --manifest-path "NEW SOLASTIO APP/app/Cargo.toml"

echo "== restart pm2 =="
mkdir -p /var/log/solastio
pm2 restart solastio-api --update-env || pm2 start "NEW SOLASTIO APP/app/deploy/oracle/ecosystem.config.cjs" --update-env
pm2 save

echo "DEPLOY_OK"
