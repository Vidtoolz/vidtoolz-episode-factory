#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test, tests } = require("./_helpers.js");

const LAUNCHERS = path.join(__dirname, "..", "ops", "music-creator-launchers");
const OPEN = path.join(LAUNCHERS, "open-episode-factory-page");
const OPEN_MUSIC = path.join(LAUNCHERS, "open-music-creator");
const ENSURE = path.join(LAUNCHERS, "ensure-cockpit.sh");
const MUSIC3 = path.join(LAUNCHERS, "vidtoolz-music3");

function executable(file, body) {
  fs.writeFileSync(file, `#!/usr/bin/env bash\nset -u\n${body}\n`, { mode: 0o755 });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "music-launcher-"));
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  executable(path.join(bin, "notify-send"), "exit 0");
  executable(path.join(bin, "sleep"), "exit 0");
  executable(path.join(bin, "browser"), 'printf "%s\\n" "$*" >> "$BROWSER_LOG"');
  executable(path.join(bin, "page-launcher"), 'printf "%s\\n" "$*" >> "$PAGE_LOG"; exit "${PAGE_RC:-0}"');
  executable(path.join(bin, "music3-status"), 'printf "%s\\n" "$*" >> "$STATUS_LOG"; exit "${STATUS_RC:-0}"');
  executable(path.join(bin, "ensure"), `
printf "%s\\n" "$*" >> "$ENSURE_LOG"
if [ "\${ENSURE_MODE:-ok}" = fail ]; then exit 1; fi
touch "$READY_MARKER"
`);
  executable(path.join(bin, "curl"), `
case "\${CURL_MODE:-ready}" in
  ready|devices) [ "\${CURL_MODE:-ready}" = devices ] && printf '{"devices":[]}' ; exit 0 ;;
  never) exit 22 ;;
  after-start) [ -f "$READY_MARKER" ] && exit 0 || exit 22 ;;
  api-only) case "$*" in *music-creator.html*) exit 22;; *) exit 0;; esac ;;
esac
`);
  executable(path.join(bin, "ss"), '[ "${SS_LISTENER:-0}" = 1 ] && printf "LISTEN 0 1 127.0.0.1:${TEST_PORT:-8010} 0.0.0.0:*\\n"; exit 0');
  executable(path.join(bin, "systemctl"), `
printf "%s\\n" "$*" >> "$SYSTEMCTL_LOG"
if [ "\${SYSTEMCTL_MODE:-ok}" = fail ]; then exit 1; fi
case "$*" in *start*) touch "$READY_MARKER";; esac
exit 0
`);
  executable(path.join(bin, "ssh"), `
printf "%s\\n" "$*" >> "$SSH_LOG"
cmd="\${!#}"
case "\${SSH_MODE:-healthy}" in
  unreachable) exit 255 ;;
  timeout) /bin/sleep 2; exit 0 ;;
esac
case "$cmd" in
  *"echo OK"*) exit 0 ;;
  *"Get-Process Resolve"*) [ "\${SSH_MODE:-healthy}" = resolve ] && printf '1\\r\\n' || printf '0\\r\\n'; exit 0 ;;
  *"curl.exe"*) [ "\${SSH_MODE:-healthy}" = healthy ] && printf '{"devices":[]}' || printf '{}'; exit 0 ;;
  *"Get-NetTCPConnection"*) [ "\${SSH_MODE:-healthy}" = occupied ] && printf 'OCCUPIED pid=77 process=other\\r\\n' || printf 'FREE\\r\\n'; exit 0 ;;
  *"Start-Music3.ps1"*) [ "\${SSH_MODE:-healthy}" = start_resolve ] && exit 2 || exit 0 ;;
esac
exit 0
`);
  executable(path.join(bin, "pgrep"), "exit 1");
  executable(path.join(bin, "pkill"), 'printf "called\\n" >> "$PKILL_LOG"; exit 0');
  const files = {
    root, bin,
    browser: path.join(root, "browser.log"),
    ensure: path.join(root, "ensure.log"),
    marker: path.join(root, "ready"),
    ssh: path.join(root, "ssh.log"),
    systemctl: path.join(root, "systemctl.log"),
    pkill: path.join(root, "pkill.log"),
    page: path.join(root, "page.log"),
    status: path.join(root, "status.log"),
  };
  return files;
}

function run(script, args, f, extra = {}) {
  return spawnSync(script, args, {
    encoding: "utf8",
    timeout: 5000,
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH}`,
      HOME: f.root,
      BROWSER_LOG: f.browser,
      ENSURE_LOG: f.ensure,
      READY_MARKER: f.marker,
      SSH_LOG: f.ssh,
      SYSTEMCTL_LOG: f.systemctl,
      PKILL_LOG: f.pkill,
      PAGE_LOG: f.page,
      STATUS_LOG: f.status,
      TEST_PORT: "8010",
      VIDTOOLZ_LAUNCHER_LOG_DIR: path.join(f.root, "logs"),
      VIDTOOLZ_CURL_BIN: path.join(f.bin, "curl"),
      VIDTOOLZ_SS_BIN: path.join(f.bin, "ss"),
      VIDTOOLZ_BROWSER_BIN: path.join(f.bin, "browser"),
      VIDTOOLZ_NOTIFY_BIN: path.join(f.bin, "notify-send"),
      VIDTOOLZ_ENSURE_COCKPIT: path.join(f.bin, "ensure"),
      VIDTOOLZ_SYSTEMCTL_BIN: path.join(f.bin, "systemctl"),
      VIDTOOLZ_SLEEP_BIN: path.join(f.bin, "sleep"),
      MUSIC3_BROWSER_BIN: path.join(f.bin, "browser"),
      MUSIC3_NOTIFY_BIN: path.join(f.bin, "notify-send"),
      VIDTOOLZ_PAGE_LAUNCHER: path.join(f.bin, "page-launcher"),
      VIDTOOLZ_MUSIC3_LAUNCHER: path.join(f.bin, "music3-status"),
      MUSIC3_LOCAL_PORT: "18189",
      MUSIC3_SSH_COMMAND_TIMEOUT: "0.15",
      MUSIC3_SSH_START_TIMEOUT: "0.3",
      ...extra,
    },
  });
}

function content(file) { return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""; }

test("ready Episode Factory opens the browser once without a restart", () => {
  const f = fixture();
  const r = run(OPEN, ["music-creator.html", "8010"], f, { CURL_MODE: "ready", SS_LISTENER: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(content(f.browser).trim(), "http://127.0.0.1:8010/music-creator.html");
  assert.equal(content(f.ensure), "");
  assert.equal(content(f.ssh), "", "local Music Creator launch must not auto-start MiniMax");
});

test("stopped Episode Factory starts through the authority then opens", () => {
  const f = fixture();
  const r = run(OPEN, ["music-creator.html", "8010"], f, { CURL_MODE: "after-start" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(content(f.ensure), /8010/);
  assert.equal(content(f.browser).trim(), "http://127.0.0.1:8010/music-creator.html");
});

test("service-start failure is non-zero and browser stays closed", () => {
  const f = fixture();
  const r = run(OPEN, ["music-creator.html", "8010"], f, { CURL_MODE: "never", ENSURE_MODE: "fail" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /failed to start/i);
  assert.equal(content(f.browser), "");
});

test("API-ready but missing page blocks browser launch", () => {
  const f = fixture();
  const r = run(OPEN, ["music-creator.html", "8010"], f, { CURL_MODE: "api-only", SS_LISTENER: "1" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /page|music-creator\.html|not reachable/i);
  assert.equal(content(f.browser), "");
});

test("unexpected local port owner is never killed or replaced", () => {
  const f = fixture();
  const r = run(OPEN, ["music-creator.html", "8010"], f, { CURL_MODE: "never", SS_LISTENER: "1" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /occupied/);
  assert.equal(content(f.ensure), "");
  assert.equal(content(f.pkill), "");
});

test("ensure-cockpit propagates systemd start failure", () => {
  const f = fixture();
  const r = run(ENSURE, ["8010"], f, { CURL_MODE: "never", SYSTEMCTL_MODE: "fail", VIDTOOLZ_READY_ATTEMPTS: "1" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /service start failed/i);
});

test("ensure-cockpit waits for HTTP readiness after systemd start", () => {
  const f = fixture();
  const r = run(ENSURE, ["8010"], f, { CURL_MODE: "after-start", VIDTOOLZ_READY_ATTEMPTS: "2" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(content(f.systemctl), /start vidtoolz-cockpit\.service/);
});

test("healthy MiniMax is reused and browser opens once", () => {
  const f = fixture();
  const r = run(MUSIC3, [], f, { SSH_MODE: "healthy", CURL_MODE: "devices", SS_LISTENER: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /already running/);
  assert.equal(content(f.browser).trim(), "http://127.0.0.1:18189");
  assert.doesNotMatch(content(f.ssh), /Start-Music3\.ps1/);
});

test("MiniMax status-only healthy path starts nothing and opens nothing", () => {
  const f = fixture();
  const r = run(MUSIC3, ["--status-only"], f, { SSH_MODE: "healthy", CURL_MODE: "devices" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /READY: MiniMax is healthy/);
  assert.equal(content(f.browser), "");
  assert.doesNotMatch(content(f.ssh), /Start-Music3\.ps1/);
});

test("MiniMax status-only offline path requests manual start without starting", () => {
  const f = fixture();
  const r = run(MUSIC3, ["--status-only"], f, { SSH_MODE: "start_success", CURL_MODE: "devices" });
  assert.equal(r.status, 12);
  assert.match(r.stdout, /READY_WITH_MINIMAX_MANUAL_START_REQUIRED/);
  assert.doesNotMatch(content(f.ssh), /Start-Music3\.ps1/);
});

test("MiniMax status-only preserves Resolve and SSH classifications", () => {
  let f = fixture();
  let r = run(MUSIC3, ["--status-only"], f, { SSH_MODE: "resolve", CURL_MODE: "devices" });
  assert.equal(r.status, 11);
  assert.match(r.stdout, /BLOCKED_RESOLVE_RUNNING/);
  f = fixture();
  r = run(MUSIC3, ["--status-only"], f, { SSH_MODE: "unreachable", CURL_MODE: "devices" });
  assert.equal(r.status, 10);
  assert.match(r.stdout, /BLOCKED_VIDLAP2_UNREACHABLE/);
});

test("Music Creator stays successful when optional MiniMax needs manual start", () => {
  const f = fixture();
  const r = run(OPEN_MUSIC, [], f, { STATUS_RC: "12" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(content(f.page).trim(), "music-creator.html 8010");
  assert.equal(content(f.status).trim(), "--status-only");
});

test("operator-initiated offline MiniMax uses the one remote launcher exactly once", () => {
  const f = fixture();
  const r = run(MUSIC3, [], f, { SSH_MODE: "start_success", CURL_MODE: "devices", SS_LISTENER: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Starting Music 3/);
  assert.equal((content(f.ssh).match(/Start-Music3\.ps1/g) || []).length, 1);
  assert.equal(content(f.browser).trim(), "http://127.0.0.1:18189");
});

test("Resolve-running status remains exit 2 and prevents MiniMax start", () => {
  const f = fixture();
  const r = run(MUSIC3, [], f, { SSH_MODE: "resolve", CURL_MODE: "devices" });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /Resolve is running/);
  assert.doesNotMatch(content(f.ssh), /Start-Music3\.ps1/);
});

test("remote launcher exit 2 survives without shell-negation loss", () => {
  const f = fixture();
  const r = run(MUSIC3, [], f, { SSH_MODE: "start_resolve", CURL_MODE: "devices" });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /VIDLAP2 refused/);
});

test("unhealthy unexpected remote port occupant prevents duplicate start", () => {
  const f = fixture();
  const r = run(MUSIC3, [], f, { SSH_MODE: "occupied", CURL_MODE: "devices" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /occupied but MiniMax health failed/);
  assert.doesNotMatch(content(f.ssh), /Start-Music3\.ps1/);
});

test("every SSH call is bounded and unreachable transport returns promptly", () => {
  const f = fixture();
  const started = Date.now();
  const r = run(MUSIC3, [], f, { SSH_MODE: "timeout", CURL_MODE: "devices" });
  assert.equal(r.status, 1);
  assert.ok(Date.now() - started < 1500, `elapsed ${Date.now() - started}ms`);
  const calls = content(f.ssh).trim().split("\n").filter(Boolean);
  assert.ok(calls.length >= 1);
  for (const call of calls) {
    assert.match(call, /BatchMode=yes/);
    assert.match(call, /ConnectTimeout=5/);
    assert.match(call, /ConnectionAttempts=1/);
    assert.match(call, /ServerAliveCountMax=1/);
  }
});

if (require.main === module) {
  (async () => {
    let passed = 0;
    for (const item of tests) {
      try { await item.fn(); passed += 1; console.log(`ok - ${item.name}`); }
      catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; }
    }
    console.log(`${passed}/${tests.length} launcher tests passed`);
  })();
}
