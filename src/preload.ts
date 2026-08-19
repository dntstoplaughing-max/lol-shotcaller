// Bridge between the main process and the overlay renderer. The renderer is
// sandboxed (contextIsolation on); it only ever receives events, never gets
// Node or LCU access.

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("shotcaller", {
  onEvent: (callback: (evt: unknown) => void) => {
    ipcRenderer.on("sc-event", (_event, payload) => callback(payload));
  },
  onUi: (callback: (msg: unknown) => void) => {
    ipcRenderer.on("sc-ui", (_event, payload) => callback(payload));
  },
});
