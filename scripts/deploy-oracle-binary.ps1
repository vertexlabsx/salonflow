param(
  [Parameter(Mandatory = $true)]
  [string]$BinaryArchive,
  [string]$HostName = "129.159.16.165",
  [string]$User = "ubuntu",
  [string]$KeyFile = "old app/ssh-key-2026-08-27.key",
  [string]$Domain = "129.159.16.165.sslip.io"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$keyPath = Join-Path $root $KeyFile
$archivePath = Resolve-Path $BinaryArchive
$target = "$User@$HostName"
$remoteScript = Join-Path $env:TEMP "deploy-solastio-oracle.sh"

$remote = @"
set -euo pipefail
sudo mkdir -p /opt/solastio/bin /etc/solastio /var/log/solastio
sudo chown -R ubuntu:ubuntu /opt/solastio /etc/solastio /var/log/solastio
tar -xzf /tmp/solastio-api-linux-x64.tar.gz -C /opt/solastio/bin
chmod +x /opt/solastio/bin/solastio-api
cat >/opt/solastio/bin/run-solastio-api.cjs <<'NODE'
const { spawn } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');

const env = { ...process.env };
const envFile = '/etc/solastio/solastio.env';
if (existsSync(envFile)) {
  for (const rawLine of readFileSync(envFile, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');
    if (key) env[key] = value;
  }
}

const child = spawn('/opt/solastio/bin/solastio-api', { stdio: 'inherit', env });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
NODE
cat >/opt/solastio/ecosystem.config.cjs <<'PM2'
module.exports = {
  apps: [{
    name: "solastio-api",
    script: "/opt/solastio/bin/run-solastio-api.cjs",
    exec_mode: "fork",
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    error_file: "/var/log/solastio/api-error.log",
    out_file: "/var/log/solastio/api-out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z"
  }]
};
PM2
pm2 delete salonflow-api || true
pm2 start /opt/solastio/ecosystem.config.cjs --update-env
pm2 save
sudo tee /etc/nginx/sites-available/solastio-api >/dev/null <<'NGINX'
server {
    listen 80;
    server_name $Domain;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host `$host;
        proxy_set_header X-Real-IP `$remote_addr;
        proxy_set_header X-Forwarded-For `$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto `$scheme;
    }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/solastio-api /etc/nginx/sites-enabled/solastio-api
sudo nginx -t
sudo systemctl reload nginx
curl -fsS http://127.0.0.1:4000/api/v1/health
"@

$remote | Set-Content -Path $remoteScript -Encoding Ascii

& scp -i $keyPath -o BatchMode=yes $archivePath "$target`:/tmp/solastio-api-linux-x64.tar.gz"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& scp -i $keyPath -o BatchMode=yes $remoteScript "$target`:/tmp/deploy-solastio-oracle.sh"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& ssh -i $keyPath -o BatchMode=yes $target "bash /tmp/deploy-solastio-oracle.sh"
exit $LASTEXITCODE
