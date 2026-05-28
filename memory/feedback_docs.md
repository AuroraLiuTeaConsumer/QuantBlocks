---
name: feedback-docs-currency
description: Docs must stay current with code; update relevant docs/ files as part of any non-trivial code change
metadata:
  type: feedback
---

Docs must stay current with code. After any non-trivial change, update the relevant file in `docs/` and move resolved items to the Resolved table in `TODO.md`.

**Why:** From HANDOFF.md rule 8. This is a standing rule in the project, not a one-off request.

**How to apply:** Whenever modifying API routes, backtest logic, paper trading flow, or adding new features, also update the matching doc (BACKEND.md, BACKTEST.md, PAPER_TRADING.md, ARCHITECTURE.md, etc.). Move completed TODO items to the Resolved section.
