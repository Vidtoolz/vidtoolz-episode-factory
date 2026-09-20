"""Transport: HTTP over loopback. 'local' -> 127.0.0.1:port on this host; 'ssh' -> 127.0.0.1:local_port, which an
SSH session (see tunnel.py) forwards to the remote worker's loopback port. No LAN-facing socket exists at either end."""
import http.client, json
from .errors import VrcError
from .protocol import auth_headers
def send(target, secret, env, connect_timeout=5.0):
    port = target["port"] if target["transport"] == "local" else target["local_port"]
    body = json.dumps(env).encode(); path = "/v1/op"
    try:
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=connect_timeout + env.get("deadline_ms", 20000) / 1000)
        c.request("POST", path, body, auth_headers(secret, "POST", path, body)); r = c.getresponse(); data = json.loads(r.read() or b"{}")
    except (OSError, ValueError, http.client.HTTPException) as e:
        raise VrcError("WORKER_OFFLINE", f"{target['host_id']} worker unreachable on 127.0.0.1:{port}", {"cause": repr(e)[:200]})
    if r.status == 401: raise VrcError("AUTHENTICATION_FAILED", (data.get("error") or {}).get("message", ""))
    return data
