param(
  [switch]$Release,
  [string]$EnvFile = "NEW SOLASTIO APP/app/.env"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root $EnvFile

if (Test-Path $envPath) {
  Get-Content $envPath | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
      return
    }

    $name, $value = $line.Split("=", 2)
    $name = $name.Trim()
    $value = $value.Trim().Trim('"').Trim("'")
    if ($name) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

if (-not $env:MONGODB_DATABASE) {
  $env:MONGODB_DATABASE = "aura_saas"
}

$manifest = Join-Path $root "NEW SOLASTIO APP/app/Cargo.toml"
$args = @("run", "-p", "solastio-api", "--manifest-path", $manifest)
if ($Release) {
  $args = @("run", "-p", "solastio-api", "--release", "--manifest-path", $manifest)
}

& cargo @args
exit $LASTEXITCODE
