"""SSH-session-bound worker supervision for Windows hosts. One ssh session per target: forwards vidnux loopback
local_port -> remote loopback worker port AND runs the worker as the remote command, so the worker's lifetime is the
session's lifetime (no orphaned LAN service; dying session == OFFLINE). Not a boot service: starting it is an operator act."""
import os, subprocess
def start(target, log_dir=os.path.expanduser("~/.config/vidtoolz-resolve-control/tunnels")):
    os.makedirs(log_dir, exist_ok=True); h = target["host_id"]
    cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "-o", "ExitOnForwardFailure=yes",
           "-L", f"127.0.0.1:{target['local_port']}:127.0.0.1:{target['remote_port']}"]
    if target.get("liveness_port"):   # F-03: remote worker probes this reverse-forwarded port to prove the controlling path is alive
        cmd += ["-R", f"127.0.0.1:{target['liveness_port']}:127.0.0.1:{target.get('controller_liveness_target_port', 22)}"]
    cmd += [target["ssh_alias"], target["remote_command"]]
    log = open(os.path.join(log_dir, f"{h}.log"), "a")
    p = subprocess.Popen(cmd, stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True)
    open(os.path.join(log_dir, f"{h}.pid"), "w").write(str(p.pid)); return p.pid
