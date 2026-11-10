# Build the HC007 batteryless-save test ROM.
#
#   pwsh -File tools/build_testrom.ps1
#   pwsh -File tools/build_testrom.ps1 -Cart mbc1
#   pwsh -File tools/build_testrom.ps1 -Clean
#
# Outputs roms/testrom-mbc1.gb, -mbc3.gb, -mbc5.gb.
# 512 KiB image (bank 0x18 is inside the declared ROM), 8 KiB SRAM header.
# The flash log is at chip 0x62000 (bank 0x18, CPU 0x6000).

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
$sources = @(
    (Join-Path $srcDir 'testrom.c'),
    (Join-Path $srcDir 'flashlib.c')
)
$roms = Join-Path $root 'roms'

if (-not (Test-Path $lcc)) { throw "GBDK lcc not found at $lcc" }
foreach ($src in $sources) {
    if (-not (Test-Path $src)) { throw "source not found at $src" }
}
New-Item -ItemType Directory -Force -Path $roms | Out-Null

$cartBytes = @{
    mbc1 = '0x03'   # MBC1 + RAM + battery
    mbc3 = '0x13'   # MBC3 + RAM + battery
    mbc5 = '0x1B'   # MBC5 + RAM + battery
}

$targets = if ($Cart -eq 'all') { @('mbc1', 'mbc3', 'mbc5') } else { @($Cart) }

if ($Clean) {
    Get-ChildItem -Path $roms -Filter 'testrom-*' -File -ErrorAction SilentlyContinue |
        Remove-Item -Force
}

foreach ($name in $targets) {
    $out = Join-Path $roms "testrom-$name.gb"
    Write-Host "CC  testrom-$name ($($cartBytes[$name]))"
    & $lcc `
        '-msm83:gb' `
        '-Wm-ynSAVETEST' `
        "-Wl-yt$($cartBytes[$name])" `
        '-Wl-yo32' `
        '-Wl-ya1' `
        '-Wl-j' `
        '-Wl-w' `
        '-Wf--opt-code-speed' `
        "-I$srcDir" `
        '-Wl-m' `
        '-o' $out `
        @sources
    if ($LASTEXITCODE -ne 0) { throw "lcc failed for $name (exit $LASTEXITCODE)" }

    $b = [System.IO.File]::ReadAllBytes($out)
    Write-Host ("OK  {0}  size={1}  147={2:X2} 148={3:X2} 149={4:X2}" -f `
        $out, $b.Length, $b[0x147], $b[0x148], $b[0x149])
}
