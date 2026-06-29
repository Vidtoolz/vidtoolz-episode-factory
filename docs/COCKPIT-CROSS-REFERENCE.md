# VIDTOOLZ Cockpit Cross-Reference

Two separate web interfaces serve the VIDTOOLZ production system. This document maps their roles, ports, and relationships.

## Cockpit 1: Episode Factory Cockpit (port 8010)

- **Repo:** /home/vidtoolz/vidtoolz-episode-factory
- **Server:** package-engine-server.js (Node.js)
- **Port:** 8010 (default)
- **Scope:** Full episode production lifecycle — topic ideas, package runs, gate management, script review, capture checklists, evidence review, export checklists, newsletter, archive.
- **Pages:** mission-control.html, package-engine.html, package-runs-dashboard.html
- **Tests:** run `scripts/verify.sh` for the current count; GitHub Actions CI enabled (.github/workflows/verify.yml)
- **State:** package-runs/ directory with STATUS.md per run

## Cockpit 2: AIGEN Review View (port 8099)

- **Repo:** /home/vidtoolz/work/aigen-edit (local working copy, now git-tracked)
- **Server:** review-view/server.py (Python, ThreadingHTTPServer)
- **Port:** 8099 (default)
- **Scope:** Narrow — serves the aigen script-packages directory with a browser-based review UI for image selection. Single write endpoint: selected-images.json PUT.
- **Page:** review-view/index.html
- **Write scope:** Only `script-packages/*/selected-images.json` can be written via PUT. All other writes return 403.
- **State:** /mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/script-packages/

## Relationship

The Episode Factory cockpit manages the full production lifecycle. The AIGEN review view is a focused tool for the image selection step within that lifecycle.

Typical flow:
1. Episode Factory cockpit creates a package run (Gate 1-3: topic, script, production plan)
2. AIGEN pipeline generates FLUX images on vidnux → images land in script-packages/<pkg>/images/flux-local/
3. AIGEN review view (8099) serves those images for Mikko to review and select
4. Selected images written to script-packages/<pkg>/selected-images.json
5. Wan2.2 video generation on PRESTO uses selected images as source frames
6. Episode Factory cockpit tracks Gate 4-5 progress (video gen, assembly edit)

## Key difference

The Episode Factory cockpit is the authoritative production tracker. The AIGEN review view is a utility tool within the image selection step. They share the VIDNAS filesystem but do not share state files — the cockpit reads STATUS.md and package-run artifacts, the review view reads manifest.json and selected-images.json.

## Launch commands

```bash
# Episode Factory cockpit
cd /home/vidtoolz/vidtoolz-episode-factory
node scripts/package-engine-server.js  # serves on :8010

# AIGEN review view
cd /home/vidtoolz/work/aigen-edit
python3 review-view/server.py --port 8099  # serves on :8099
```
