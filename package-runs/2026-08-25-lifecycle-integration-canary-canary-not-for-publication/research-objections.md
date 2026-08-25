# Research Objections

CANARY — NOT FOR PUBLICATION.

| objection/counterexample | why it matters | evidence needed | response plan | status |
| --- | --- | --- | --- | --- |
| A canary run may not exercise the same code paths as real production | If it diverges, the proof is worthless | Run must satisfy isPackageRunDir and appear in the real index and active-state audit | Verified: genuine-run scanner returns true and the audit selects it as the active run | closed |
| Passing gates here might mean the gates are too weak, not that integration works | A weak gate proves nothing | Show at least one gate refusing to advance on artifact presence alone | Recorded: research gate held at PARTIAL until concrete evidence existed | closed |
| Advancing a canary could be mistaken for real production progress | Risk of publishing a test package | Explicit CANARY / NOT_FOR_PUBLICATION marking and parking at end | Marked throughout; will be parked, never completed | open |
