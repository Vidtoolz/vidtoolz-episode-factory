# ROJEKTI — DaVinci Resolve Handoff (Pilot Phase 3)

How the cockpit hands off staged video clips to Resolve via ROJEKTI, the DaVinci Resolve Project Server.

> **ROJEKTI's role:** Project Server only (PostgreSQL-backed). Not an editing machine (underpowered). Clients (VIDNUX, PRESTO, VIDLAP2) open projects from ROJEKTI and edit against media on VIDNAS.

## Box facts (verified 2026-06-14)

| Thing | Value |
|---|---|
| Host | ROJEKTI — 192.168.50.199 / `rojekti.local` |
| SSH | `ssh rojekti` (user `rojekti\mjp77`\*) — PowerShell shell |
| OS | Windows (underpowered, not for editing) |
| DaVinci Resolve Project Server | PostgreSQL on port 5432 (PID 15244) |
| Local Resolve cache | `C:\Users\mjp77\AppData\Roaming\Blackmagic Design\DaVinci Resolve\Support\Resolve Project Library\` |
| VIDNAS on ROJEKTI | **Not mounted** (ROJEKTI only hosts project DBs) |
| Transfer inbox | `C:\Users\mjp77\vidnux-transfer\` ↔ vidnux `~/rojekti-inbox` |

\* SSH shell is PowerShell, not bash. Use PowerShell syntax. For file transfers, SCP to `mjp77:vidnux-transfer\<file>` then run from there.

## Architecture

```
cockpit (vidnux:8010)
  ↓ staged MP4s
VIDNAS (192.168.61.186:/mnt/vidnas_public/VIDTOOLZ/aigen/...)
  ↑ media access (NFS/SMB)
Resolve clients (VIDNUX, PRESTO, VIDLAP2)
  ↓ project DB requests
ROJEKTI (192.168.50.199:5432) ← PostgreSQL project server
```

**Key point:** ROJEKTI does NOT need VIDNAS access. It only stores project databases. The Resolve clients on the editing machines connect to ROJEKTI for projects AND to VIDNAS for media.

## Handoff flow (manual, pilot Phase 3)

### 1. Stage video clips on VIDNAS

Cockpit already stages to:
```
VIDNAS:/mnt/vidnas_public/VIDTOOLZ/aigen/<package>/videos/mp4/*.mp4
```

Example:
```bash
# From vidnux, verify staging
ls -1 /mnt/vidnas_public/VIDTOOLZ/aigen/2026-06-14-demo/videos/mp4/
```

### 2. Open Resolve on an editing machine

On **VIDNUX**, **PRESTO**, or **VIDLAP2** (any of the Resolve clients):
- Launch DaVinci Resolve
- Connect to ROJEKTI project server: `192.168.50.199`
- Open or create a project for the package

### 3. Import media into the timeline

In Resolve (on the editing machine):
- **Media Pool:** Add media from VIDNAS mount point
  - VIDNUX: `/mnt/vidnas_public/VIDTOOLZ/aigen/<package>/videos/mp4/`
  - PRESTO: `C:\mnt\vidnas_public\VIDTOOLZ\aigen\<package>\videos\mp4\`
  - VIDLAP2: `\\vidnas\Public\VIDTOOLZ\aigen\<package>\videos\mp4\` (UNC path)
- **Edit page:** Drag clips to timeline per `assembly-plan.md` (see below)

### 4. Follow the assembly plan

The cockpit generates `docs/assembly-plan.md` per package:
```
VIDNAS:/mnt/vidnas_public/VIDTOOLZ/aigen/<package>/docs/assembly-plan.md
```

This contains:
- Timeline structure (intro, main, outro)
- Clip order and timing
- Transition notes
- Audio/music placement

Edit manually in Resolve following that plan.

### 5. Export final video

From Resolve (on the editing machine):
- **Deliver page:** Export to VIDNAS
```
// For VIDLAP2:
\\vidnas\Public\VIDTOOLZ\aigen\<package>\videos\final\
```

## Pilot verification checklist

- [ ] **SSH to ROJEKTI works:** `ssh rojekti` from vidnux → PowerShell prompt
- [ ] **PostgreSQL running:** `netstat -ano | findstr 5432` on ROJEKTI → LISTENING
- [ ] **Resolve client connects to ROJEKTI:** Open Resolve on VIDNUX → Project Server: `192.168.50.199`
- [ ] **Staged clips exist on VIDNAS:** `ls /mnt/vidnas_public/VIDTOOLZ/aigen/<package>/videos/mp4/`
- [ ] **Resolve client sees VIDNAS media:** Drag a clip from the VIDNAS path into Media Pool
- [ ] **Assembly plan readable:** Open `assembly-plan.md` in a text editor
- [ ] **Final export to VIDNAS:** Export renders to `videos/final/` on VIDNAS

## Gotchas

### SSH is PowerShell, not bash
```powershell
# ✅ Works
ssh rojekti
PS C:\> dir
PS C:\> cd C:\Users\mjp77\vidnux-transfer

# ❌ Does NOT work
ssh rojekti "ls -la"  # ls is Unix syntax
```

### SCP paths are Windows-style
```bash
# ✅ Correct (Windows path, no spaces in filename)
scp localfile.txt rojekti:mjp77:vidnux-transfer/

# ❌ Wrong (forward slashes work, but destination is Windows)
scp localfile.txt rojekti:/c/Users/mjp77/  # Unix path doesn't work
```

### No VIDNAS on ROJEKTI
ROJEKTI cannot access VIDNAS. That's intentional — it's only a project server. Don't try to NFS-mount VIDNAS on ROJEKTI.

### Resolve clients need BOTH connections
Each editing machine must:
1. Connect to ROJEKTI for project DB (`192.168.50.199`)
2. Mount VIDNAS for media (paths above)

If Resolve says "Media Offline," check the VIDNAS mount on that machine, not ROJEKTI.

---

**Status:** Draft written 2026-06-14. Ready for review. No commits yet.
