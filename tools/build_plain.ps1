# Build the HC007 plain save test ROM (patcher target).
#
#   pwsh -File tools/build_plain.ps1
#   pwsh -File tools/build_plain.ps1 -Cart mbc5
#   pwsh -File tools/build_plain.ps1 -Clean
#
# Outputs roms/plain-mbc1.gb, -mbc3.gb, -mbc5.gb.
# 512 KiB image, 8 KiB SRAM header, no flash journal (the patcher adds it).

[CmdletBinding()]
param(
    [ValidateSet('all', 'mbc1', 'mbc3', 'mbc5')]
    [string]$Cart = 'all',
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$gbdk = Join-Path $PSScriptRoot 'gbdk'
$lcc = Join-Path $gbdk 'bin\lcc.exe'
$srcDir = Join-Path $root 'testrom'
$src = Join-Path $srcDir 'plain.c'
$roms = Join-Path $root 'roms'

if (-not (Test-Path $lcc)) { throw "GBDK lcc not found at $lcc" }
if (-not (Test-Path $src)) { throw "source not found at $src" }
New-Item -ItemType Directory -Force -Path $roms | Out-Null

$cartBytes = @{
    mbc1 = '0x03'
    mbc3 = '0x13'
    mbc5 = '0x1B'
}

$targets = if ($Cart -eq 'all') { @('mbc1', 'mbc3', 'mbc5') } else { @($Cart) }

if ($Clean) {
    Get-ChildItem -Path $roms -Filter 'plain-*' -File -ErrorAction SilentlyContinue |
        Remove-Item -Force
}

foreach ($name in $targets) {
    $out = Join-Path $roms "plain-$name.gb"
    Write-Host "CC  plain-$name ($($cartBytes[$name]))"
    & $lcc `
        '-msm83:gb' `
        '-Wm-ynPLAINSAVE' `
        "-Wl-yt$($cartBytes[$name])" `
        '-Wl-yo32' `
        '-Wl-ya1' `
        '-Wl-j' `
        '-Wl-w' `
        '-Wf--opt-code-speed' `
        "-I$srcDir" `
        '-Wl-m' `
        '-o' $out `
        $src
    if ($LASTEXITCODE -ne 0) { throw "lcc failed for $name (exit $LASTEXITCODE)" }

    $b = [System.IO.File]::ReadAllBytes($out)
    Write-Host ("OK  {0}  size={1}  147={2:X2} 148={3:X2} 149={4:X2}" -f `
        $out, $b.Length, $b[0x147], $b[0x148], $b[0x149])
}
