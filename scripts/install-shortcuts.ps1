# Creates the "one icon, zero thinking" entry points:
#   npm run shortcut           -> Desktop "Shotcaller.lnk" (game mode: boost + launch League + overlay)
#                                 + Desktop "Mouse DPI drill.lnk" (tools/mouse-drill; skipped if no Python)
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

# Mouse DPI drill (tools/mouse-drill): a plain Python/tkinter window, launched via pythonw.exe so no
# console appears. Non-fatal on purpose: if Python isn't installed yet, say so and keep the icons above.
$pythonw = $null
foreach ($pattern in @("$env:LOCALAPPDATA\Programs\Python\Python3*\pythonw.exe",       # python.org, per-user
                       "$env:ProgramFiles\Python3*\pythonw.exe",                         # python.org, all users
                       "$env:LOCALAPPDATA\Microsoft\WindowsApps\PythonSoftwareFoundation.Python.3.*\pythonw.exe")) {  # Store
    $found = Get-ChildItem $pattern -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) { $pythonw = $found.FullName; break }
}
if ($pythonw) {
    $drill = Join-Path $repo "tools\mouse-drill"
    $drillLnk = Join-Path $desktop "Mouse DPI drill.lnk"
    $lnk = $shell.CreateShortcut($drillLnk)
    $lnk.TargetPath = $pythonw
    $lnk.Arguments = "`"$(Join-Path $drill 'mouse_drill.py')`""
    $lnk.WorkingDirectory = $drill
    $lnk.IconLocation = "$env:SystemRoot\System32\main.cpl,0"   # the Mouse control-panel icon
    $lnk.Description = "Find the DPI stage you click best on (tools/mouse-drill)"
    $lnk.Save()
    Write-Host "created: $drillLnk  (python: $pythonw)"
} else {
    Write-Host "skipped Mouse DPI drill icon: no pythonw.exe found. Install Python 3 (tools/mouse-drill/README.md), then run npm run shortcut again."
}
