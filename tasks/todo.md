# Dev desktop fidelity

- [x] Trace the React warning and theme persistence in the dev window.
- [x] Fix the warning at its source and seed desktop preferences into the isolated dev profile.
- [x] Verify the dev window after reload, run relevant checks, and commit.

## Review

Verified actual installed profile export and isolated Electron startup on a new Metro origin. All seven copied preference records match (layout compared by selected fields); fresh reload has no console errors. Five profile tests pass, including real Electron persistence/refresh and daemon-setting isolation. Unistyles regression and dev-runner tests pass. Formatting, lint and typecheck pass. Main app and daemon were not restarted.
