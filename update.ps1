# Launchpad updater. Brings this folder up to date with GitHub.
# Run by the "Launchpad auto-update" scheduled task (set up by install.ps1), or by hand:
#   powershell -ExecutionPolicy Bypass -File "$HOME\Launchpad\update.ps1"
#
# - A git clone is updated with "git pull" (fast-forward only, so local edits are never overwritten).
# - A ZIP install is updated by downloading the ZIP again when GitHub has a different version.
# It writes autoupdate-status.json, which Settings > About reads to show "last checked".

$ErrorActionPreference = 'Stop'
$repo = 'morow01/Launchpad'
$dir = $PSScriptRoot
$statusFile = Join-Path $dir 'autoupdate-status.json'

function Get-LocalVersion {
    try { (Get-Content (Join-Path $dir 'manifest.json') -Raw | ConvertFrom-Json).version } catch { $null }
}

function Save-Status([string]$mode, [bool]$updated, [string]$problem) {
    $previous = $null
    try { $previous = Get-Content $statusFile -Raw | ConvertFrom-Json } catch {}
    $now = (Get-Date).ToUniversalTime().ToString('o')
    $status = [ordered]@{
        checked = $now
        updated = if ($updated) { $now } elseif ($previous) { $previous.updated } else { $null }
        version = Get-LocalVersion
        mode    = $mode
        error   = if ($problem) { $problem } else { $null }
    }
    # UTF-8 without a BOM, so the page can read it as JSON
    [IO.File]::WriteAllText($statusFile, ($status | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
}

$mode = 'zip'
$updated = $false
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $git = Get-Command git -ErrorAction SilentlyContinue
    if ((Test-Path (Join-Path $dir '.git')) -and $git) {
        $mode = 'git'
        $ErrorActionPreference = 'Continue' # git writes progress to stderr; that isn't an error
        $before = (& git -C $dir rev-parse HEAD 2>$null)
        & git -C $dir pull --ff-only --quiet 2>$null | Out-Null
        $pullExit = $LASTEXITCODE
        $after = (& git -C $dir rev-parse HEAD 2>$null)
        $ErrorActionPreference = 'Stop'
        if ($pullExit -ne 0) { throw "git pull didn't complete (exit $pullExit). Local changes or no connection?" }
        $updated = $before -ne $after
    }
    else {
        $remote = (Invoke-RestMethod "https://raw.githubusercontent.com/$repo/main/manifest.json").version
        if ($remote -and $remote -ne (Get-LocalVersion)) {
            $tmp = Join-Path ([IO.Path]::GetTempPath()) ("launchpad-" + [Guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $tmp | Out-Null
            try {
                $zip = Join-Path $tmp 'launchpad.zip'
                Invoke-WebRequest "https://github.com/$repo/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing
                Expand-Archive -Path $zip -DestinationPath $tmp
                $source = Get-ChildItem $tmp -Directory | Select-Object -First 1
                if (-not (Test-Path (Join-Path $source.FullName 'manifest.json'))) { throw 'The downloaded ZIP has no manifest.json.' }
                Copy-Item (Join-Path $source.FullName '*') $dir -Recurse -Force
                $updated = $true
            }
            finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
    Save-Status $mode $updated $null
    if ($updated) { Write-Output "Launchpad updated to $(Get-LocalVersion)." } else { Write-Output "Launchpad is up to date ($(Get-LocalVersion))." }
}
catch {
    Save-Status $mode $false $_.Exception.Message
    Write-Output "Launchpad update failed: $($_.Exception.Message)"
    exit 1
}
