const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    readJson: (relativePath) => ipcRenderer.invoke('read-json', relativePath),
    writeJsonAtomic: (relativePath, data) => ipcRenderer.invoke('write-json-atomic', relativePath, data),
    writeImageBase64: (relativePath, base64Data) => ipcRenderer.invoke('write-image-base64', relativePath, base64Data),
    trashJson: (relativePath) => ipcRenderer.invoke('trash-json', relativePath),
    showContextMenu: (template) => ipcRenderer.send('show-context-menu', template),
    onContextMenuClick: (callback) => {
        // Clear existing listeners first to prevent duplicates
        ipcRenderer.removeAllListeners('context-menu-click');
        ipcRenderer.on('context-menu-click', (event, itemId) => callback(itemId));
    }
});
console.log("Preload script loaded (no extra APIs exposed)");
