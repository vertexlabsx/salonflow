# Oracle Rust Backend Deployment

This replaces the legacy Node backend with the new Rust `solastio-api` service.

## Server Layout

- Repo path: `/opt/solastio`
- API app: `/opt/solastio/NEW SOLASTIO APP/app`
- Env file: `/etc/solastio/solastio.env`
- PM2 process: `solastio-api`

## Deploy

```bash
sudo mkdir -p /opt/solastio /etc/solastio /var/log/solastio
sudo chown -R ubuntu:ubuntu /opt/solastio /var/log/solastio
git clone <repo-url> /opt/solastio
cp "/opt/solastio/NEW SOLASTIO APP/app/.env.example" /etc/solastio/solastio.env
nano /etc/solastio/solastio.env
chmod 600 /etc/solastio/solastio.env
set -a
. /etc/solastio/solastio.env
set +a
cargo build --workspace --release --manifest-path "/opt/solastio/NEW SOLASTIO APP/app/Cargo.toml"
pm2 start "/opt/solastio/NEW SOLASTIO APP/app/deploy/oracle/ecosystem.config.cjs" --update-env
pm2 save
```

## Nginx

```bash
DOMAIN=api.your-domain.com
sudo sed "s/ORACLE_BACKEND_DOMAIN/${DOMAIN}/g" "/opt/solastio/NEW SOLASTIO APP/app/deploy/oracle/solastio-api.nginx.conf" | sudo tee /etc/nginx/sites-available/solastio-api >/dev/null
sudo ln -sf /etc/nginx/sites-available/solastio-api /etc/nginx/sites-enabled/solastio-api
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d "$DOMAIN"
```

## Verify

```bash
curl -i https://api.your-domain.com/api/v1/health
curl -i https://api.your-domain.com/api/v1/ready
```
