# MiniMax idle resource-release policy

MiniMax Music 3 intentionally keeps its models cached after generation. On the 16 GB VIDLAP2 GPU that leaves roughly 11.7 GB free, below the existing 15 GB music-generation admission floor. The floor remains unchanged: resource lifecycle, not weaker admission, is the repair.

After every real MiniMax request reaches durable completed or failed state, Episode Factory keeps its local generation lock, verifies that both its local candidate set and ComfyUI's real queue are idle, and then calls ComfyUI's supported `/free` operation with model-unload and free-memory flags. A second queue read immediately before `/free` prevents unloading if new remote work appeared. Multi-candidate requests drain completely before one release, avoiding unload/reload churn between consecutive candidates.

Release is bounded and idempotent. It is skipped for deterministic adapters, local Scorecraft work, busy queues, or already-sufficient free VRAM. Failure or unavailability is recorded separately and never changes the candidate's generation result. The runtime remains running; no Python process is killed or restarted.

If automatic release cannot be verified, the operator fallback remains the same supported ComfyUI `/free` request after confirming that `/queue` is empty. Compute authority may continue to block until free VRAM again satisfies the 15 GB policy.
