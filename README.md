# Layered2
Cloned from Layered


Layered is a distraction-free desktop bullet journal designed to help you organize your thoughts, tasks, and daily plans with absolute creative freedom. 

Gone are the days of rigid, top-down text editors. Layered gives you a massive, scrollable workspace where you can draw custom text regions, organize blocks of markdown-powered notes, and decorate your pages with a built-in, drag-and-drop sticker book. It is your personal, minimalist canvas for note-taking, stripped of all unnecessary clutter but packed with hidden power.



## ✨ Features

### 📖 Smart Navigation
* **Horizontal Spreads:** Scroll seamlessly left and right through an infinite array of journal pages. 
* **Page Indicators:** Jump directly to specific spreads using the sleek floating navigation dots at the bottom of the screen.

### 📝 Region & Block Engine
* **Draw Custom Regions:** Click and drag anywhere on a page to create floating "regions" exactly where you want them 📦.
* **Custom Paper Types:** Change the background of any region to suit your needs: `blank`, `dot`, `ruled`, or `graph`.
* **Markdown-Powered Blocks:** Type naturally to format your text! Start a line with:
  * `* ` for Tasks (•)
  * `x ` for Completed (✕)
  * `> ` for Migrated (>)
  * `< ` for Scheduled (<)
  * `o ` for Events (○)
  * `- ` for Notes (-)
  * `# ` to `###### ` for Headers!
* **Block Drag & Drop:** Grab the handle next to any bullet point to drag it around or indent/outdent with your keyboard.

### 🎒 The Sticker Book
* **Upload & Organize:** Open the sticker drawer to upload your favorite images and GIFs. Organize them into custom "Packs".
* **Drag, Drop & Paste:** Drag stickers straight from the drawer onto your pages, or paste images directly from your clipboard!
* **Total Image Control:** Right-click any placed sticker to scale it up/down, rotate it, adjust its opacity, or lock it in place.
* **Z-Layering:** Push text regions and stickers back and forth across 5 distinct layers: `background`, `paper`, `sticker`, `floating`, and `focus`.



## 🛠️ Tech Stack

* **Frontend:** Built with [Svelte 5](https://svelte.dev/) 🧡 using highly optimized `$state` runes for a buttery smooth UI.
* **Styling:** [TailwindCSS](https://tailwindcss.com/) 🖌️.
* **Desktop Framework:** [Electron](https://www.electronjs.org/) ⚛️.
* **Local Storage:** All regions, blocks, metadata, and images are saved securely as local JSON and Base64 files using custom Atomic file system APIs 💾.



## 📂 Project Structure

* `index.html` - 🌐 The main interface file loading the application and styling.
* `App.svelte` - 🧩 The massive core engine handling the infinite canvas, RegionManager, EditorEngine, and StickerBookManager.
* `main_electron.js` - ⚙️ The core Electron script managing the secure desktop window and file system operations.
* `preload.js` - 🌉 The secure IPC bridge connecting the frontend UI to the local file system.



## 🚀 Getting Started

### 1️⃣ Prerequisites
Make sure you have Node.js installed on your machine! 📦

### 2️⃣ Installation
Clone the repository and install the dependencies:

```bash
cd layered
npm install
```


### 3️⃣ Running in Development Mode 🛠️

Run the Svelte development server and the Electron wrapper simultaneously:

```bash
# Terminal 1: Build Svelte frontend
npm run dev

# Terminal 2: Launch Electron
npm start

```
