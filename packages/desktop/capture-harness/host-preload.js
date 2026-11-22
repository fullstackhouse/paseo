const { contextBridge, ipcRenderer } = require("electron");

// Mirrors waitForPendingIpc in the production preload (src/preload.ts).
contextBridge.exposeInMainWorld("captureHarnessHost", {
  waitForPendingIpc: () => ipcRenderer.invoke("paseo:browser:wait-for-pending-ipc"),
});
