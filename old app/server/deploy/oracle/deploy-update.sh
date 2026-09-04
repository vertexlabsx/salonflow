#!/usr/bin/env bash
set -euo pipefail
cd /opt/salonflow/server
echo "== npm ci =="
npm ci
echo "== build =="
npm run build
echo "== restart =="
pm2 restart salonflow-api --update-env
echo "DEPLOY_OK"