# Music Creator launcher source authority

This directory is the canonical, version-controlled source for the Music Creator operator launch chain. `/home/vidtoolz/bin/` and `/home/vidtoolz/Desktop/23-Music-Creator.desktop` are deployed copies, not source files.

The copied-deployment model keeps production stable while repository changes are reviewed and tested. It also avoids making the desktop launcher depend directly on a dirty or moved working tree.

Deploy or restore the complete launcher set:

```sh
./ops/deploy-music-launchers.sh --deploy
```

Check live files for byte or executable-mode drift without modifying them:

```sh
./ops/deploy-music-launchers.sh --check
```

Edit launchers here, run `node tests/music-launcher.test.js` and `node tests/music-launcher-deployment.test.js`, then deploy. Do not make lasting edits directly in `~/bin`; if that happens, `--check` reports the affected file and the deploy command restores the canonical set.

The desktop entry is part of the same transaction and continues to execute `/home/vidtoolz/bin/open-music-creator`. Deployment does not start or restart Episode Factory or MiniMax.
