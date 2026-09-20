CODES = ("TARGET_REQUIRED", "TARGET_UNKNOWN", "TARGET_MISMATCH", "WORKER_OFFLINE", "WORKER_STALE", "WORKER_GENERATION_MISMATCH",
         "RESOLVE_UNAVAILABLE", "RESOLVE_SESSION_CHANGED", "PROJECT_NOT_OPEN", "PROJECT_IDENTITY_MISMATCH", "TIMELINE_NOT_FOUND",
         "TIMELINE_IDENTITY_MISMATCH", "UNSUPPORTED_OPERATION", "READ_ONLY_MODE", "TIMEOUT", "TRANSPORT_ERROR", "AUTHENTICATION_FAILED")
class VrcError(Exception):
    def __init__(self, code, message="", detail=None):
        assert code in CODES, code
        super().__init__(f"{code}: {message}"); self.code, self.message, self.detail = code, message, detail
    def to_dict(self): return {"code": self.code, "message": self.message, "detail": self.detail}
