[CmdletBinding()]
param(
    [switch]$Local
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SqlPath = Join-Path $PSScriptRoot "product-metrics.sql"
$Wrangler = Join-Path $RepoRoot "node_modules\.bin\wrangler.cmd"
$Target = if ($Local) { "--local" } else { "--remote" }
$Sql = (Get-Content $SqlPath) -join " "

$Output = & $Wrangler d1 execute seibi-to $Target --json --command $Sql
if ($LASTEXITCODE -ne 0) {
    throw "D1 metrics query failed with exit code $LASTEXITCODE"
}

$Payload = ($Output -join [Environment]::NewLine) | ConvertFrom-Json
$Row = $Payload[0].results[0]
if (-not $Row) {
    throw "D1 metrics query returned no result"
}

function Get-Percent {
    param([int]$Numerator, [int]$Denominator)
    if ($Denominator -eq 0) { return $null }
    return [Math]::Round(($Numerator / $Denominator) * 100, 1)
}

$Users = [int]$Row.users
$Creators = [int]$Row.vehicle_creators
$Recorders = [int]$Row.recorders

[ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    service = "seibi-to"
    environment = if ($Local) { "local" } else { "production" }
    funnel = [ordered]@{
        users = $Users
        vehicle_creators = $Creators
        recorders = $Recorders
        reminder_users = [int]$Row.reminder_users
        printers = [int]$Row.printers
        exporters = [int]$Row.exporters
        importers = [int]$Row.importers
        returned = [int]$Row.returned
        recorders_7d = [int]$Row.recorders_7d
        reminder_users_7d = [int]$Row.reminder_users_7d
    }
    rates = [ordered]@{
        create_percent = Get-Percent $Creators $Users
        record_percent = Get-Percent $Recorders $Creators
        reminder_percent = Get-Percent ([int]$Row.reminder_users) $Recorders
        carry_out_percent = Get-Percent ([Math]::Max([int]$Row.printers, [int]$Row.exporters)) $Recorders
    }
} | ConvertTo-Json -Depth 4
