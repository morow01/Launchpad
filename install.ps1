# Launchpad installer. One command per computer, in PowerShell:
#
#   irm https://raw.githubusercontent.com/morow01/Launchpad/main/install.ps1 | iex
#
# - New computer: downloads Launchpad to your user folder (git clone, or a ZIP if Git isn't
#   installed) and tells you how to load it into Brave.
# - Computer that already has Launchpad: keeps its folder as it is.
# - Both: switches on automatic updates — a background task that runs update.ps1 every hour.
#
# Turn automatic updates off again with:
#   Unregister-ScheduledTask -TaskName 'Launchpad auto-update' -Confirm:$false
#
# For testing: $env:LAUNCHPAD_DIR overrides the folder, $env:LAUNCHPAD_NO_TASK = '1' skips the task.

$ErrorActionPreference = 'Stop'
$repo = 'morow01/Launchpad'
$taskName = 'Launchpad auto-update'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Test-Launchpad([string]$path) {
    try { (Get-Content (Join-Path $path 'manifest.json') -Raw | ConvertFrom-Json).name -eq 'Launchpad' } catch { $false }
}

# 1. Find an existing copy, or download one
$dir = $null
$candidates = if ($env:LAUNCHPAD_DIR) { @($env:LAUNCHPAD_DIR) } else { @((Join-Path $HOME 'Launchpad'), (Join-Path $HOME 'BraveNewTab')) }
foreach ($c in $candidates) { if (Test-Launchpad $c) { $dir = $c; break } }

$fresh = $false
if ($dir) {
    Write-Host "Found Launchpad in $dir" -ForegroundColor Green
}
else {
    $dir = $candidates[0]
    $fresh = $true
    if (Test-Path $dir) { throw "$dir already exists but isn't Launchpad. Move it away, or set `$env:LAUNCHPAD_DIR to another folder." }
    Write-Host "Downloading Launchpad to $dir ..." -ForegroundColor Cyan
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $ErrorActionPreference = 'Continue'
        & git clone --quiet "https://github.com/$repo.git" $dir 2>$null
        $cloneExit = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
        if ($cloneExit -ne 0) { throw "git clone failed (exit $cloneExit)." }
    }
    else {
        $tmp = Join-Path ([IO.Path]::GetTempPath()) ("launchpad-" + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $tmp | Out-Null
        try {
            $zip = Join-Path $tmp 'launchpad.zip'
            Invoke-WebRequest "https://github.com/$repo/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing
            Expand-Archive -Path $zip -DestinationPath $tmp
            $source = Get-ChildItem $tmp -Directory | Select-Object -First 1
            New-Item -ItemType Directory -Path $dir | Out-Null
            Copy-Item (Join-Path $source.FullName '*') $dir -Recurse -Force
        }
        finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
    }
    if (-not (Test-Launchpad $dir)) { throw "The download didn't produce a Launchpad folder in $dir." }
}

# 2. Bring it up to date now (also fetches update.ps1 for copies made before it existed)
$updater = Join-Path $dir 'update.ps1'
if (-not (Test-Path $updater)) {
    if ((Test-Path (Join-Path $dir '.git')) -and (Get-Command git -ErrorAction SilentlyContinue)) {
        $ErrorActionPreference = 'Continue'
        & git -C $dir pull --ff-only --quiet 2>$null | Out-Null
        $ErrorActionPreference = 'Stop'
    }
    if (-not (Test-Path $updater)) {
        Invoke-WebRequest "https://raw.githubusercontent.com/$repo/main/update.ps1" -OutFile $updater -UseBasicParsing
    }
}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updater

# 3. Automatic updates: run the updater every hour, without a window popping up
if ($env:LAUNCHPAD_NO_TASK -eq '1') {
    Write-Host 'Skipped the scheduled task (LAUNCHPAD_NO_TASK).' -ForegroundColor Yellow
}
else {
    $arguments = "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$updater`""
    $action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1)
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
        -Description 'Keeps the Launchpad new tab page up to date from GitHub (runs update.ps1 hourly).' -Force | Out-Null
    Write-Host 'Automatic updates are on (checked every hour).' -ForegroundColor Green
}

# 4. What's left for you to do
Write-Host ''
if ($fresh) {
    try { Set-Clipboard -Value $dir } catch {}
    Write-Host 'Two steps left:' -ForegroundColor Cyan
    Write-Host '  1. In Brave open  brave://extensions , turn on Developer mode, click "Load unpacked"'
    Write-Host "     and choose this folder (its path is on your clipboard):  $dir"
    Write-Host '  2. Open a new tab > Settings > Sync and data > paste your token > Connect.'
}
else {
    Write-Host 'Nothing else to do. New versions now arrive by themselves;' -ForegroundColor Cyan
    Write-Host 'Settings > About in Launchpad shows when it last checked.'
}
