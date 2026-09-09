# Diary conventions

- Preserve the single-owner privacy model and all 20 outline sections.
- Never commit real writing, passwords, attachments, Tailscale state, or tokens.
- Preserve UNRAID.md fixes: port 3000, shell-safe exec-form commands, root initialization for Unraid's Tailscale hook followed by a non-root app.
- Persist /data; keep /data/journal separate from /data/.tailscale_state. Never recursively chown /data.
- Keep XML, Dockerfile, Compose, docs, and workflow consistent. Default host port 8083. Serve uses 3000; Funnel stays disabled.
- Run node --test and the package build script for code changes. Validate container changes with Docker or GitHub Actions.
- Do not seed personal claims. Use temporary synthetic data for tests.
