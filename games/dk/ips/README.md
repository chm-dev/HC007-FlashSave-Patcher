# Donkey Kong (GB) HC007 patches

Apply to **Donkey Kong (Japan, USA) (SGB Enhanced).gb** (SHA-1 `6ed661bd1d6d8cdd48e1c10f8ca4e8dcba49128e`).
Both patches are full images (the appended banks are written explicitly), so any IPS tool reproduces the exact output.

| Patch | Output | Use |
|---|---|---|
| `dk-hc007.ips` | MBC5, 1 MiB, flash journal | normal build |
| `dk-hc007-noflash.ips` | same hooks, never programs/erases flash | isolate hook/stack/bank problems on hardware |

Verify: applying the patch must give the SHA-1 in `manifest.json`.

Status: **emulator-tested only** (NOR-flash model).  Not yet hardware-tested.
Hardware test plan: `games/dk/README.md`.
