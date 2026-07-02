const { app, BrowserWindow, Menu, ipcMain, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs/promises'); // Use promise-based FS
const writeFileAtomic = require('write-file-atomic');
const { pathToFileURL } = require('url');
const contextMenu = require('electron-context-menu');

// Initialize native context menu fallback for editable fields
const initContextMenu = contextMenu.default || contextMenu;
initContextMenu({
  showLookUpSelection: true,
  showSearchWithGoogle: false,
  showInspectElement: false
});

// 🛡️ SECURITY: Register custom protocol scheme as privileged
protocol.registerSchemesAsPrivileged([
  { scheme: 'bujo', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } }
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 450,
    minHeight: 650,
    backgroundColor: '#d1d5db',
    webPreferences: {
      nodeIntegration: false,      // Keep renderer secure
      contextIsolation: true,      // Isolate context for security
      preload: path.join(__dirname, 'preload.js') // Preload script
    },
    show: false,
    frame: true,                   // Standard window frame
    title: 'Minimal Notebook'
  });

  // Load the HTML file
  win.loadFile(path.join(__dirname, 'dist', 'index.html'));

  // Show window when ready to avoid flicker
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  // Optional: Remove default Electron menu for a cleaner look
  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
    const baseDir = path.join(app.getPath('documents'), 'MinimalBujo');
    const trashDir = path.join(baseDir, 'trash');

    // Create base window
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // 🛡️ SECURITY: Strict Path Resolution
    function getSafePath(relativePath) {
        const targetPath = path.resolve(baseDir, relativePath);
        if (!targetPath.startsWith(path.resolve(baseDir))) {
            console.error(`🚨 SECURITY ALERT: Path Traversal Attempt Blocked: ${relativePath}`);
            throw new Error('Unauthorized path access');
        }
        return targetPath;
    }

    // Register bujo:// protocol handler to serve local assets natively
    protocol.handle('bujo', (request) => {
        try {
            const url = request.url;
            const relativePath = decodeURIComponent(url.replace('bujo://', ''));
            const safePath = getSafePath(relativePath);
            return net.fetch(pathToFileURL(safePath).toString());
        } catch (error) {
            console.error('Custom protocol error:', error);
            return new Response('Not Found', { status: 404 });
        }
    });

    ipcMain.handle('read-json', async (event, relativePath) => {
        try {
            const safePath = getSafePath(relativePath);
            const data = await fs.readFile(safePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') return null;
            return null;
        }
    });

    ipcMain.handle('read-text', async (event, relativePath) => {
        try {
            const safePath = getSafePath(relativePath);
            return await fs.readFile(safePath, 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') return null;
            return null;
        }
    });

    ipcMain.handle('write-json-atomic', async (event, relativePath, data) => {
        try {
            const targetPath = getSafePath(relativePath);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await writeFileAtomic(targetPath, JSON.stringify(data, null, 2), 'utf8');
            return true;
        } catch (error) {
            console.error(`Error writing ${relativePath}:`, error);
            return false;
        }
    });

    ipcMain.handle('write-text-atomic', async (event, relativePath, data) => {
        try {
            const targetPath = getSafePath(relativePath);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await writeFileAtomic(targetPath, data, 'utf8');
            return true;
        } catch (error) {
            console.error(`Error writing text ${relativePath}:`, error);
            return false;
        }
    });

    ipcMain.handle('write-image-base64', async (event, relativePath, base64Data) => {
        try {
            const targetPath = getSafePath(relativePath);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            const base64Content = base64Data.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Content, 'base64');
            await writeFileAtomic(targetPath, buffer);
            return true;
        } catch (error) {
            console.error(`Error writing image ${relativePath}:`, error);
            return false;
        }
    });

    ipcMain.handle('trash-json', async (event, relativePath) => {
        try {
            const targetPath = getSafePath(relativePath);
            await fs.mkdir(trashDir, { recursive: true });
            
            const fileName = path.basename(targetPath);
            const timestamp = Date.now();
            const trashPath = path.join(trashDir, `${timestamp}-${fileName}`);

            await fs.rename(targetPath, trashPath);
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') return true; // Already gone
            console.error(`Error trashing ${relativePath}:`, error);
            return false;
        }
    });

    // 📱 NATIVE CONTEXT MENUS: Handle context menu popup from renderer
    function buildMenu(template, event) {
        return template.map(item => {
            if (item.type === 'separator') {
                return { type: 'separator' };
            }
            const menuItem = {
                label: item.label,
                enabled: !item.disabled,
            };
            if (item.submenu) {
                menuItem.submenu = buildMenu(item.submenu, event);
            } else if (item.id) {
                menuItem.click = () => {
                    event.sender.send('context-menu-click', item.id);
                };
            }
            return menuItem;
        });
    }

    ipcMain.on('show-context-menu', (event, template) => {
        const menuTemplate = buildMenu(template, event);
        const menu = Menu.buildFromTemplate(menuTemplate);
        const win = BrowserWindow.fromWebContents(event.sender);
        menu.popup({ window: win });
    });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});