#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root with sudo: sudo bash bootstrap-ubuntu.sh" >&2
  exit 1
fi

apt-get update
apt-get upgrade -y
apt-get install -y ca-certificates curl git nginx ufw build-essential certbot python3-certbot-nginx

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

npm install -g pm2

mkdir -p /opt/salonflow /etc/salonflow /var/log/salonflow
chown -R ubuntu:ubuntu /opt/salonflow /var/log/salonflow || true
chmod 750 /etc/salonflow

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl enable nginx
systemctl restart nginx

echo "Base Oracle Ubuntu setup complete. Next: clone repo, create /etc/salonflow/salonflow.env, build, and start PM2."
