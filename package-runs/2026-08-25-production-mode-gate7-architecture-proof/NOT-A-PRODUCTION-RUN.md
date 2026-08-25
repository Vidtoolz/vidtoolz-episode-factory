# NOT A PRODUCTION RUN

This directory is architecture evidence for the run-level production mode model
and the gate-7 capture ownership decision. It is not a package run, has no
lifecycle position, and will never ship.

The three mode canaries it records were executed in isolated temporary roots
against the real evaluators, then their outputs were captured here. They were
deliberately not created under `package-runs/` as runnable runs, so the package
index and the 14-gate engine never see fabricated production state.
