# Chrome control

Let agents in different Paseo workspaces share your Chrome connection one task at a time. Each task gets its own tab. Other tasks wait until the owner finishes and its tab is closed.

Open Chrome control from the sidebar to see the queue, take over, cancel a task, or return control. Agents can pause for a human to complete a 1Password or passkey login. The plugin stops observations during that handoff and wakes the agent when you Continue. It uses Paseo's ordinary notifications: phone delivery depends on existing presence and notification settings.

This proof of concept requires Paseo 0.15.3 or newer, a separately installed agent-browser 0.43.0 executable, and an explicit local Chrome debugging connection. Configure the executable's absolute path and loopback endpoint in Setup, then enable new tasks. The plugin never launches Chrome or downloads tools. See the README for setup and recovery instructions.

The plugin runs on the Mac hosting Chrome. A phone connected to that Paseo host can use its controls. Agents on another daemon are not routed to this controller. It coordinates only its own tools; other browser or screen tools can bypass it.

Browser snapshots are returned to the requesting agent and can be sent to its model provider. Task titles, initial URLs and ownership state are stored locally; don't put credentials in them. Password/passkey entry belongs to the human. The queue retains control if execution becomes uncertain or the plugin restarts; explicit recovery is then required before another task can use the screen.
