# Build the injectable journal blob (code at 0x2000 in bank 0).
#
#   pwsh -File patcher/journal/build_blob.ps1
#
# Output: roms/journal-blob.gb / .noi / .map
# The patcher copies 0x2000..0x3FFF from this image into the target ROM.

[CmdletBinding()]
param(
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$gbdk = Join-Path $root 'tools\gbdk'
$lcc = Join-Path $gbdk 'bin\lcc.exe'
$src = Join-Path $PSScriptRoot 'journal.c'
$roms = Join-Path $root 'roms'
$out = Join-Path $roms 'journal-blob.gb'

if (-not (Test-Path $lcc)) { throw "GBDK lcc not found at $lcc" }
if (-not (Test-Path $src)) { throw "source not found at $src" }
New-Item -ItemType Directory -Force -Path $roms | Out-Null

if ($Clean) {
    Get-ChildItem -Path $roms -Filter 'journal-blob.*' -File -ErrorAction SilentlyContinue |
        Remove-Item -Force
}

& $lcc `
    '-msm83:gb' `
    '-Wm-ynJOURNAL' `
    '-Wl-yo2' `
    '-Wl-ya1' `
    '-Wl-j' `
    '-Wl-w' `
    '-Wf--opt-code-size' `
    '-Wl-b_CODE=0x2000' `
    '-Wl-m' `
    '-o' $out `
    $src
if ($LASTEXITCODE -ne 0) { throw "lcc failed (exit $LASTEXITCODE)" }

$b = [System.IO.File]::ReadAllBytes($out)
Write-Host ("OK  {0}  size={1}  147={2:X2} 148={3:X2} 149={4:X2}" -f `
    $out, $b.Length, $b[0x147], $b[0x148], $b[0x149])

$noi = [System.IO.Path]::ChangeExtension($out, '.noi')
Select-String -Path $noi -Pattern 'DEF _(j_boot|j_vblank|j_restore|j_tick|j_boot_default|j_vblank_stub)\b' |
    ForEach-Object { $_.Line }

& (Join-Path $gbdk 'bin\romusage.exe') $noi 2>&1 | Select-String 'ROM_0 ' | ForEach-Object { $_.Line }
