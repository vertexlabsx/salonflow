param(
    [string]$VmHost = "129.159.16.165",
    [string]$VmUser = "ubuntu",
    [string]$SshKey = "ssh-key-2026-08-27.key",
    [switch]$Build = $true,
    [switch]$SkipPushCheck = $false,
    [switch]$Frontend = $false
)

<#
Deploy the solastio backend to the Oracle VM.

Safest flow for the 1GB VM (avoids OOM from running tsc on the box):
  1. Optionally build the server locally with tsc.
  2. Package the compiled dist.
  3. scp the dist tarball to the VM.
  4. Back up the current dist, extract the new one, restart pm2 (preserves env).
  5. Verify the hosted API: login + a new-code endpoint.

Usage:
  npm run deploy                          # build + deploy backend
  npm run deploy:no-build                 # reuse existing local dist
  npm run deploy:frontend                 # also build+ship frontend bundle
#>

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$baseUrl = "https://$VmHost.sslip.io/api/v1"
$sshTarget = "${VmUser}@${VmHost}"

function Invoke-Remote([string]$script) {
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
    & ssh -i "$root\$SshKey" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=45 $sshTarget "echo $b64 | base64 -d | bash"
    if ($LASTEXITCODE -ne 0) { throw "Remote command failed with exit code $LASTEXITCODE" }
}

Write-Host "=== 1/5 git check ===" -ForegroundColor Cyan
if (-not $SkipPushCheck) {
    git -C $root fetch origin main
    $local = git -C $root rev-parse HEAD
    $remote = git -C $root rev-parse origin/main
    Write-Host "local HEAD : $local"
    Write-Host "origin/main: $remote"
    if ($local -ne $remote) {
        Write-Host "WARNING: local HEAD differs from origin/main. Push your commit first if it is not on origin." -ForegroundColor Yellow
    }
}

Write-Host "=== 2/5 server build (local) ===" -ForegroundColor Cyan
if ($Build) {
    npm --prefix "$root\server" run build
    if ($LASTEXITCODE -ne 0) { throw "Server build failed" }
}

if ($Frontend) {
    Write-Host "=== 2b/5 frontend build (local) ===" -ForegroundColor Cyan
    npm --prefix $root run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
}

Write-Host "=== 3/5 package dist ===" -ForegroundColor Cyan
$tar = Join-Path $env:TEMP "opencode\server-dist-deploy.tgz"
if (Test-Path $tar) { Remove-Item $tar -Force }
tar -czf $tar -C "$root\server" dist
Write-Host "packaged: $((Get-Item $tar).Length) bytes"

Write-Host "=== 4/5 upload to VM ===" -ForegroundColor Cyan
& scp -i "$root\$SshKey" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=45 $tar "${sshTarget}:/home/ubuntu/backups/server-dist.tgz"
if ($LASTEXITCODE -ne 0) { throw "scp failed" }

Write-Host "=== 4b/5 swap dist + restart pm2 ===" -ForegroundColor Cyan
Invoke-Remote @'
set -e
cd /opt/salonflow/server
if [ ! -d /home/ubuntu/backups/dist-old ]; then
  cp -r dist /home/ubuntu/backups/dist-old
fi
rm -rf dist
tar xzf /home/ubuntu/backups/server-dist.tgz
ls -la dist/src/modules/whatsapp/whatsapp.routes.js
pm2 restart salonflow-api 2>&1 | tail -4
sleep 6
pm2 jlist 2>/dev/null | node -e "let d=JSON.parse(require('fs').readFileSync(0));console.log('STATUS name='+d[0].name+' status='+d[0].pm2_env.status+' restarts='+d[0].pm2_env.restart_time)"
'@

Write-Host "=== 5/5 verify hosted API ===" -ForegroundColor Cyan
$sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$csrf = (Invoke-WebRequest -Method Get -Uri "$baseUrl/auth/csrf" -WebSession $sess -UseBasicParsing -TimeoutSec 30).Content | ConvertFrom-Json
$envFile = "$root\server\.env"
$ownerLogin = (Get-Content $envFile | Where-Object { $_ -match '^SEED_OWNER_LOGIN=' }) -replace '^SEED_OWNER_LOGIN=', ''
$ownerPass  = (Get-Content $envFile | Where-Object { $_ -match '^SEED_OWNER_PASSWORD=' }) -replace '^SEED_OWNER_PASSWORD=', ''
$loginBody = @{ tenantId = "tenant_aura"; loginId = $ownerLogin; password = $ownerPass } | ConvertTo-Json
$rep = Invoke-WebRequest -Method Post -Uri "$baseUrl/auth/login" -ContentType "application/json" -WebSession $sess -UseBasicParsing -TimeoutSec 30 -Headers @{ "x-csrf-token" = $csrf.data.csrfToken } -Body $loginBody
$body = $rep.Content | ConvertFrom-Json
Write-Host "LOGIN OK role=$($body.data.user.role) tokenLen=$($body.data.accessToken.Length)" -ForegroundColor Green
$tok = $body.data.accessToken
try {
    $intel = Invoke-WebRequest -Method Get -Uri "$baseUrl/owner-console/whatsapp/intelligence" -UseBasicParsing -TimeoutSec 30 -Headers @{ "Authorization" = "Bearer $tok" }
    Write-Host "NEW-CODE CHECK /owner-console/whatsapp/intelligence -> $($intel.StatusCode)" -ForegroundColor Green
} catch {
    throw "New-code endpoint check failed: $($_.Exception.Message)"
}
Write-Host "DEPLOY COMPLETE" -ForegroundColor Green