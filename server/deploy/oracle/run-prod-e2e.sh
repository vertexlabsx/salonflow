#!/usr/bin/env bash
set -euo pipefail
set -a
. /etc/salonflow/salonflow.env
set +a
cd /opt/salonflow/server
export WA_WEBHOOK_SECRET="$META_WEBHOOK_APP_SECRET"
echo "secret_len=${#META_WEBHOOK_APP_SECRET}"
echo "== reset realistic test tenant (fresh schedules/services) =="
npx tsx src/jobs/seed-realistic-salon.ts
echo "== signed prod e2e against live API on 127.0.0.1:4000 =="
npx tsx test-whatsapp-e2e.ts
echo "E2E_PROD_OK"