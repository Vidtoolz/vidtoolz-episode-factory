# PRESTO Wan2.2 image-to-video canonical config

This directory is the **git-tracked source of truth** for the PRESTO
image-to-video generation profiles and their ComfyUI workflow graphs.

At runtime these files live on VIDNAS and are read by the Wan lane dispatcher
`run-production.py` (which loads the workflow JSON, patches only the prompt,
seed, source image and output prefix, and submits the complete graph to PRESTO
ComfyUI over its API — PRESTO keeps no persistent workflow file):

```
/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/image-to-video/profiles.json
/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen/image-to-video/workflows/<workflow>.json
```

`package-engine-server.js` (the cockpit) references profiles only by **name**
and output subdir (`PRESTO_PROFILES` / `PRESTO_PROFILE_OUTPUT_SUBDIRS`); it never
passes width/height/fps/frames on the command line. All video geometry is
therefore owned by the profile's workflow JSON here.

## Canonical vertical spec (recommended / default profile)

Profile `wan22_hq_720p_5s_no_lightx2v` (Super Focus default, output subdir
`mp4-hq-720p`):

```
720 × 1280   (portrait 9:16)
24 fps
97 frames    (Wan length = 4n+1; 97 = 4×24 + 1)
≈ 4.04 s     (97 / 24 = 4.0417 s)
```

The legacy `fast_current` profile (1080×1920 / 30 fps / 81 frames, subdir `mp4`)
is retained for compatibility and is intentionally unchanged.

## Deploy

The runtime copy on VIDNAS is deployed **from** this directory (one-way:
git → VIDNAS). After changing a profile or workflow here and integrating the
commit, copy the files to the VIDNAS paths above and verify sha256 equality.
Only deploy when no PRESTO render is active.
