# Daily Idea Scout — optional systemd timer (NOT enabled)

These units are **scaffolding, left disabled**. Nothing is installed or scheduled by
checking them into the repo. They run **only the research-request prep** — they do not
research the web, call an LLM, score/rank/archive, generate thumbnails, or approve
anything. Generation stays human-in-the-loop via the manual provider.

## What the timer would do (if enabled)
At 07:00 Europe/Helsinki it runs `daily-idea-scout-request.js`, writing that day's brief to
`~/vidtoolz-episode-factory/research-inbox/daily-research-request.md`. You then do the
research/synthesis in your own session and feed results back:

```bash
node scripts/daily-idea-scout-launch.js --provider=manual --input=<your-file>.md --dry-run
node scripts/daily-idea-scout-launch.js --provider=manual --input=<your-file>.md
```

## To enable manually (run these yourself — intentionally not automated)
```bash
mkdir -p ~/.config/systemd/user
cp ops/systemd/daily-idea-scout-request.service ~/.config/systemd/user/
cp ops/systemd/daily-idea-scout-request.timer   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now daily-idea-scout-request.timer
systemctl --user status daily-idea-scout-request.timer
systemctl --user list-timers daily-idea-scout-request.timer
```

## To disable / remove
```bash
systemctl --user disable --now daily-idea-scout-request.timer
rm ~/.config/systemd/user/daily-idea-scout-request.{service,timer}
systemctl --user daemon-reload
```

> A timer that fully auto-generates ideas (live web + LLM + thumbnail generation) is
> **deliberately not provided** — that crosses the "no automated topic generation / no
> hidden automation / human approves durable changes" boundary. This prep-only timer is
> the most automation that fits those rules.
