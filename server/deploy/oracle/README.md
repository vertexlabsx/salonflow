# Oracle Always Free Backend Deployment

This folder contains non-secret deployment support for running the existing Solastio backend on an Oracle Cloud Always Free Ampere A1 VM.

Render remains the fallback. Do not delete or modify Render during Oracle validation.

## Oracle VM Requirements

- Ubuntu Linux image
- Shape: Ampere A1 `VM.Standard.A1.Flex`
- OCPU: `2`
- Memory: `12 GB`
- Public IPv4 enabled
- Open only TCP `22`, `80`, `443`
- Do not expose Node port `4000` publicly
- Do not create paid load balancers, paid disks, paid databases, or upgraded resources

## First-Time VM Bootstrap

Copy `bootstrap-ubuntu.sh` to the VM and run:

```bash
sudo bash bootstrap-ubuntu.sh
```

## Deploy Code

```bash
sudo mkdir -p /opt/salonflow
sudo chown -R ubuntu:ubuntu /opt/salonflow
git clone https://github.com/vertexlabsx/salonflow.git /opt/salonflow
cd /opt/salonflow/server
npm ci
npm run build
```

## Environment

Create the env file on the VM only:

```bash
sudo mkdir -p /etc/salonflow
sudo cp /opt/salonflow/server/deploy/oracle/salonflow.env.example /etc/salonflow/salonflow.env
sudo nano /etc/salonflow/salonflow.env
sudo chmod 600 /etc/salonflow/salonflow.env
```

Do not print, commit, or paste secrets into logs.

Use the same production Atlas database. Do not seed duplicate production data.

Run validation:

```bash
cd /opt/salonflow/server
set -a
. /etc/salonflow/salonflow.env
set +a
npm run prod:check
```

## Start With PM2

```bash
sudo cp /opt/salonflow/server/deploy/oracle/ecosystem.config.cjs /opt/salonflow/server/ecosystem.config.cjs
set -a
. /etc/salonflow/salonflow.env
set +a
pm2 start /opt/salonflow/server/ecosystem.config.cjs --update-env
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

Run the command printed by `pm2 startup` with `sudo`.

## Nginx + HTTPS

Point your DNS `A` record to the Oracle public IP first.

Then replace `ORACLE_BACKEND_DOMAIN` in the Nginx template:

```bash
DOMAIN=api.example.com
sudo sed "s/ORACLE_BACKEND_DOMAIN/${DOMAIN}/g" /opt/salonflow/server/deploy/oracle/salonflow-api.nginx.conf | sudo tee /etc/nginx/sites-available/salonflow-api >/dev/null
sudo ln -sf /etc/nginx/sites-available/salonflow-api /etc/nginx/sites-enabled/salonflow-api
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d "$DOMAIN"
sudo nginx -t
sudo systemctl reload nginx
```

## Verification

```bash
curl -i https://api.example.com/api/v1/health
curl -i https://api.example.com/api/v1/ready
```

Meta webhook verification, using the configured verify token:

```bash
curl -i "https://api.example.com/webhook?hub.mode=subscribe&hub.verify_token=<VERIFY_TOKEN>&hub.challenge=oracle-ok"
```

Expected response body: `oracle-ok`.

## Cutover Rules

Do not switch production automatically.

Only after full verification and explicit approval:

- update Vercel frontend API URL if required
- update Meta webhook callback URL if required
- update Shopify app URL/callback/webhook URL if required
- keep Render available for rollback until deletion is explicitly approved
