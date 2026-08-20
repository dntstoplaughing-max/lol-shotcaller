# Creates the "one icon, zero thinking" entry points:
#   npm run shortcut           -> Desktop "Shotcaller.lnk" (game mode: boost + launch League + overlay)
#   npm run shortcut:startup   -> also a Startup-folder link (overlay only, NO boost/launch --
#                                 it just waits quietly for League after login)
param([switch]$Startup)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell

function New-ShotcallerShortcut {
    param([string]$Path, [string]$NpmArgs, [string]$Description)
    $lnk = $shell.CreateShortcut($Path)
    $lnk.TargetPath = $env:ComSpec
    $lnk.Arguments = "/c cd /d `"$repo`" && npm start $NpmArgs"
    $lnk.WorkingDirectory = $repo
    $lnk.WindowStyle = 7  # minimized console (it carries the planner logs)
    $lnk.IconLocation = "$env:SystemRoot\System32\shell32.dll,137"
    $lnk.Description = $Description
    $lnk.Save()
    Write-Host "created: $Path"
}

$desktop = [Environment]::GetFolderPath("Desktop")
New-ShotcallerShortcut -Path (Join-Path $desktop "Shotcaller.lnk") `
    -NpmArgs "-- --game-mode" `
    -Description "Boost (per boost.json), launch League, start the overlay"

if ($Startup) {
    $startup = [Environment]::GetFolderPath("Startup")
    New-ShotcallerShortcut -Path (Join-Path $startup "Shotcaller (wait for League).lnk") `
        -NpmArgs "" `
        -Description "Start the Shotcaller overlay at login; waits for League (no boost, no auto-launch)"
}
