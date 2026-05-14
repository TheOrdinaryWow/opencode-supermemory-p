---
description: Log out from Supermemory and clear credentials
subtask: false
---

# Supermemory Logout

Run this command to log out and clear Supermemory credentials:

```bash
bunx opencode-supermemory-p@latest logout
```

This will remove the saved credentials from ~/.local/share/opencode-supermemory-p/credentials.json.

Inform the user whether logout succeeded and that they'll need to run /supermemory-login to re-authenticate.
