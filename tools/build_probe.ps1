# Build the HC007 mapper/flash probe ROMs.
#
#   pwsh -File tools/build_probe.ps1
#   pwsh -File tools/build_probe.ps1 -Cart mbc1
#   pwsh -File tools/build_probe.ps1 -Clean
#
# Outputs roms/mapperprobe-mbc1.gb, -mbc3.gb, -mbc5.gb.
# The ROM is padded to 512 KiB so bank 0x1C (the flash log window) is inside
# the declared image for every mapper mode.

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
$src = Join-Path $root 'probe\mapperprobe.c'
$roms = Join-Path $root 'roms'

if (-not (Test-Path $lcc)) { throw "GBDK lcc not found at $lcc" }
if (-not (Test-Path $src)) { throw "probe source not found at $src" }
New-Item -ItemType Directory -Force -Path $roms | Out-Null

$cartBytes = @{
    mbc1 = '0x03'   # MBC1 + RAM + battery
    mbc3 = '0x13'   # MBC3 + RAM + battery
    mbc5 = '0x1B'   # MBC5 + RAM + battery
}

$targets = if ($Cart -eq 'all') { @('mbc1', 'mbc3', 'mbc5') } else { @($Cart) }

if ($Clean) {
    Get-ChildItem -Path $roms -Filter 'mapperprobe-*' -File -ErrorAction SilentlyContinue |
        Remove-Item -Force
}

foreach ($name in $targets) {
    $out = Join-Path $roms "mapperprobe-$name.gb"
    Write-Host "CC  mapperprobe-$name ($($cartBytes[$name]))"
    & $lcc `
        '-msm83:gb' `
        '-Wm-ynPROBE' `
        "-Wl-yt$($cartBytes[$name])" `
        '-Wl-yo32' `
        '-Wl-ya4' `
        '-Wl-j' `
        '-Wl-w' `
        '-Wf--opt-code-speed' `
        "-I$(Join-Path $root 'probe')" `
        '-Wl-m' `
        '-o' $out `
        $src
    if ($LASTEXITCODE -ne 0) { throw "lcc failed for $name (exit $LASTEXITCODE)" }

    $b = [System.IO.File]::ReadAllBytes($out)
    Write-Host ("OK  {0}  size={1}  147={2:X2} 148={3:X2} 149={4:X2}" -f `
        $out, $b.Length, $b[0x147], $b[0x148], $b[0x149])
}
