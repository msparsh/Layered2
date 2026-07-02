<script lang="ts">
import { onMount } from "svelte";
import type { Action } from "svelte/action";
import { Crepe } from "@milkdown/crepe";
import { parserCtx, editorViewCtx } from "@milkdown/core";
import { draggable } from "@neodrag/svelte";
import { debounce } from "lodash-es";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";

interface Region {
  id: string;
  surfaceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageId: string;
  locked?: boolean;
  paperType?: string;
  layerBucket?: string;
}

interface PlacedImage {
  id: string;
  pageId: string;
  left: number;
  top: number;
  layerBucket: string;
  locked?: boolean;
  opacity?: number;
  rotation?: number;
  scale?: number;
}

interface StickerPack {
  id: string;
  name: string;
  stickers: string[];
}

interface MetaState {
  version?: number;
  currentP: number;
  pageOrder: string[];
  stickers: string[];
  placedImages: PlacedImage[];
  regions: Region[];
  stickerPacks: StickerPack[];
  activePackId: string;
  scrolls?: number[];
}

interface LoadedSticker {
  id: string;
  src: string;
}

let zoomedImgId = $state<string | null>(null);
let stickerDrawerOpen = $state(false);
let loadedStickers = $state<LoadedSticker[]>([]);
let isDrawingRegion = $state(false);
let tempRegion = $state({ x: 0, y: 0, w: 0, h: 0, surfaceId: "" as string | null });
let activePackId = $state("all");
let draggingStickerId = $state<string | null>(null);
let pointerX = $state(0);
let pointerY = $state(0);

const StickerCache = new Map<string, string>();
const CONFIG = {
  SAVE_TIMEOUT_MS: 500,
  LAYERS: ["background", "paper", "sticker", "floating", "focus"],
  OPACITIES: [1, 0.75, 0.5, 0.25],
  SCALES: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3],
  PAPER_TYPES: ["blank", "dot", "ruled", "graph"],
  MIN_REGION_SIZE: 50,
};

function blocksToMarkdown(blocks: any[]): string {
  if (!Array.isArray(blocks)) return "";
  return blocks.map(b => {
    let prefix = "";
    if (b.type === "h1") prefix = "# ";
    else if (b.type === "h2") prefix = "## ";
    else if (b.type === "h3") prefix = "### ";
    else if (b.type === "h4") prefix = "#### ";
    else if (b.type === "h5") prefix = "##### ";
    else if (b.type === "h6") prefix = "###### ";
    else if (b.type === "task") prefix = "- [ ] ";
    else if (b.type === "completed") prefix = "- [x] ";
    else if (b.type === "note") prefix = "- ";
    else if (b.type === "migrated") prefix = "> ";
    else if (b.type === "scheduled") prefix = "< ";
    else if (b.type === "event") prefix = "- ";
    
    const indent = "  ".repeat(b.depth || 0);
    return indent + prefix + (b.text || "");
  }).join("\n");
}

function getExtensionFromBase64(b64: string): string {
  const m = b64.match(/data:image\/(\w+);base64,/);
  return m ? m[1] : 'png';
}

class BujoStore {
  meta = $state<MetaState>({
    version: 4,
    currentP: 0,
    pageOrder: [],
    stickers: [],
    placedImages: [],
    regions: [],
    stickerPacks: [],
    activePackId: "all"
  });
  pages = $state<Record<string, string>>({});
  currentP = $state(0);
  loadedImages = $state<Record<string, string>>({});
  dirtyPages = new Set<string>();
  isSaving = false;
  needsSave = false;

  requestSave = debounce(() => this.executeSave(), CONFIG.SAVE_TIMEOUT_MS);

  async init() {
    const m: MetaState = {
      version: 4,
      currentP: 0,
      pageOrder: [],
      stickers: [],
      placedImages: [],
      regions: [],
      stickerPacks: [],
      activePackId: "all",
      ...((await FileSystemAPI.readJson("meta.json")) || {})
    };
    if (!m.pageOrder.length) {
      m.pageOrder.push(`page-${Utils.generateId()}`, `page-${Utils.generateId()}`);
      await FileSystemAPI.writeJsonAtomic("meta.json", m);
    }
    this.meta = m;
    this.currentP = m.currentP || 0;
    await Promise.all(m.regions.map(async (r: Region) => {
      if (this.pages[r.pageId] === undefined) {
        const raw = await FileSystemAPI.readJson(`pages/${r.pageId}.json`);
        let md = "";
        if (raw) {
          if (Array.isArray(raw)) {
            md = blocksToMarkdown(raw);
          } else if (typeof raw === "string") {
            md = raw;
          } else if (raw.markdown !== undefined) {
            md = raw.markdown;
          }
        }
        this.pages[r.pageId] = md;
      }
    }));
  }

  async executeSave() {
    if (this.isSaving) return (this.needsSave = true);
    this.isSaving = true;
    this.needsSave = false;
    try {
      await this.cleanEmptySpreads();
      this.meta.currentP = this.currentP;
      await FileSystemAPI.writeJsonAtomic("meta.json", $state.snapshot(this.meta));
      for (const p of Array.from(this.dirtyPages)) {
        if (this.pages[p] !== undefined) {
          await FileSystemAPI.writeJsonAtomic(`pages/${p}.json`, { markdown: this.pages[p] });
        }
      }
      this.dirtyPages.clear();
    } catch (e) {
      console.error(e);
    } finally {
      this.isSaving = false;
      if (this.needsSave) this.executeSave();
    }
  }

  async cleanEmptySpreads() {
    let c = false;
    for (let i = this.meta.pageOrder.length - 1; i > this.currentP; i--) {
      const pId = this.meta.pageOrder[i];
      if (!this.meta.placedImages.some((img) => img.pageId === pId) && !this.meta.regions.some((r) => r.surfaceId === pId)) {
        delete this.pages[pId];
        this.meta.pageOrder.splice(i, 1);
        this.meta.scrolls?.splice(i, 1);
        c = true;
      }
    }
    if (this.currentP >= this.meta.pageOrder.length) {
      this.currentP = Math.max(0, this.meta.pageOrder.length - 1);
      c = true;
    }
    return c;
  }

  async ensureEnoughPages() {
    if (this.currentP >= this.meta.pageOrder.length) {
      this.meta.pageOrder.push(`page-${Utils.generateId()}`);
      await FileSystemAPI.writeJsonAtomic("meta.json", $state.snapshot(this.meta));
      return true;
    }
    return false;
  }

  async changePage(d: number, isR = true) {
    const nP = isR ? this.currentP + d : d;
    if (nP < 0) return;
    this.currentP = nP;
    await this.ensureEnoughPages();
    window.scrollTo({ top: 0, behavior: "smooth" });
    await this.executeSave();
  }

  async spawnImage(src: string, cX?: number, cY?: number) {
    const ext = getExtensionFromBase64(src);
    const id = `${Utils.generateId()}.${ext}`;
    await FileSystemAPI.writeImageBase64(`images/${id}`, src);
    const img: PlacedImage = {
      id,
      pageId: this.meta.pageOrder[this.currentP],
      left: cX !== undefined ? cX - 50 : 100,
      top: cY !== undefined ? cY - 50 : 100,
      layerBucket: "sticker"
    };
    this.meta.placedImages.push(img);
    await this.executeSave();
    this.renderImage(img);
  }

  async renderImage(d: PlacedImage) {
    if (!d.id.includes('.')) {
      const f = await FileSystemAPI.readJson(`images/${d.id}.json`);
      if (f?.src) this.loadedImages[d.id] = f.src;
    } else {
      this.loadedImages[d.id] = `bujo://images/${d.id}`;
    }
  }

  restoreAllImages() {
    this.meta.placedImages.forEach((d) => this.renderImage(d));
  }

  async removeImage(id: string) {
    const idx = this.meta.placedImages.findIndex((i) => i.id === id);
    if (idx !== -1) {
      this.meta.placedImages.splice(idx, 1);
      await this.executeSave();
      delete this.loadedImages[id];
      if (!id.includes('.')) {
        await FileSystemAPI.trashJson(`images/${id}.json`);
      } else {
        await FileSystemAPI.trashJson(`images/${id}`);
      }
    }
  }

  async removeRegion(id: string) {
    const idx = this.meta.regions.findIndex((r) => r.id === id);
    if (idx !== -1) {
      const r = this.meta.regions[idx];
      this.meta.regions.splice(idx, 1);
      delete this.pages[r.pageId];
      await this.executeSave();
      await FileSystemAPI.trashJson(`pages/${r.pageId}.json`);
    }
  }
}

const store = new BujoStore();

interface PointerActionParams {
  onDown?: (e: PointerEvent) => void;
  onMove?: (e: PointerEvent) => void;
  onUp?: (e: PointerEvent) => void;
  ignore?: (e: PointerEvent) => boolean;
}

const pointerAction: Action<HTMLElement, PointerActionParams> = (node, { onDown, onMove, onUp, ignore }) => {
  let a = false;
  const d = (e: PointerEvent) => {
    if (e.button !== 0 || ignore?.(e)) return;
    a = true;
    node.setPointerCapture(e.pointerId);
    onDown?.(e);
  };
  const m = (e: PointerEvent) => {
    if (a) onMove?.(e);
  };
  const u = (e: PointerEvent) => {
    if (!a) return;
    a = false;
    node.releasePointerCapture(e.pointerId);
    onUp?.(e);
  };
  const hs = [d, m, u, u];
  const evs = ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const;
  evs.forEach((ev, i) => node.addEventListener(ev, hs[i]));
  return { destroy: () => evs.forEach((ev, i) => node.removeEventListener(ev, hs[i])) };
};

interface ResizeBehaviorParams {
  getRegion: () => Region;
}

const resizeBehavior: Action<HTMLElement, ResizeBehaviorParams> = (node, { getRegion }) => {
  let startX: number, startY: number, startWidth: number, startHeight: number;
  let active = false;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const r = getRegion();
    if (!r || r.locked) return;
    active = true;
    node.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    startWidth = r.width;
    startHeight = r.height;
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!active) return;
    const r = getRegion();
    if (r) {
      r.width = Math.max(CONFIG.MIN_REGION_SIZE, startWidth + e.clientX - startX);
      r.height = Math.max(CONFIG.MIN_REGION_SIZE, startHeight + e.clientY - startY);
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!active) return;
    active = false;
    node.releasePointerCapture(e.pointerId);
    store.requestSave();
  };

  node.addEventListener("pointerdown", onPointerDown);
  node.addEventListener("pointermove", onPointerMove);
  node.addEventListener("pointerup", onPointerUp);
  node.addEventListener("pointercancel", onPointerUp);

  return {
    destroy() {
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", onPointerUp);
      node.removeEventListener("pointercancel", onPointerUp);
    }
  };
};

const Utils = {
  generateId: () => crypto.randomUUID(),
  clamp: (v: number, m: number, x: number) => Math.max(m, Math.min(x, v)),
  calcRectOffset: (cX: number, cY: number, r: DOMRect) => ({ x: cX - r.left, y: cY - r.top }),
  qsa: (s: string) => document.querySelectorAll(s)
};

const api = (window as any).electronAPI;
const memFs = new Map<string, any>();
const FileSystemAPI = {
  readJson: async (p: string) => api ? await api.readJson(p) : (memFs.get(p) ?? null),
  writeJsonAtomic: async (p: string, d: any) => api ? await api.writeJsonAtomic(p, d) : memFs.set(p, d),
  writeImageBase64: async (p: string, d: string) => api ? await api.writeImageBase64(p, d) : memFs.set(p, d),
  trashJson: async (p: string) => api ? await api.trashJson(p) : memFs.delete(p)
};

const StickerBookManager = {
  async update(fn: () => void) {
    fn();
    await store.executeSave();
    await this.render();
  },
  async saveSticker(b64: string) {
    for (const [, v] of StickerCache.entries()) if (v === b64) return;
    const ext = getExtensionFromBase64(b64);
    const id = `${Utils.generateId()}.${ext}`;
    await FileSystemAPI.writeImageBase64(`stickers/${id}`, b64);
    const src = `bujo://stickers/${id}`;
    StickerCache.set(id, src);
    this.update(() => {
      store.meta.stickers = [...(store.meta.stickers || []), id];
      if (activePackId !== "all") store.meta.stickerPacks?.forEach((p) => {
        if (p.id === activePackId) p.stickers = [...(p.stickers || []), id];
      });
    });
  },
  async removeSticker(id: string) {
    this.update(() => {
      store.meta.stickers = store.meta.stickers?.filter((s) => s !== id);
      store.meta.stickerPacks?.forEach((p) => (p.stickers = p.stickers?.filter((s) => s !== id)));
    });
    StickerCache.delete(id);
    if (!id.includes('.')) {
      await FileSystemAPI.trashJson(`images/sticker-${id}.json`);
    } else {
      await FileSystemAPI.trashJson(`stickers/${id}`);
    }
  },
  async loadSticker(id: string) {
    if (StickerCache.has(id)) return { id, src: StickerCache.get(id)! };
    if (!id.includes('.')) {
      const f = await FileSystemAPI.readJson(`images/sticker-${id}.json`);
      if (f?.src) {
        StickerCache.set(id, f.src);
        return { id, src: f.src };
      }
      return null;
    }
    const src = `bujo://stickers/${id}`;
    StickerCache.set(id, src);
    return { id, src };
  },
  async render() {
    const packed = new Set(store.meta.stickerPacks?.flatMap((p) => p.stickers || []) || []);
    const l = activePackId === "all"
      ? store.meta.stickers?.filter(id => !packed.has(id))
      : store.meta.stickerPacks?.find((p) => p.id === activePackId)?.stickers;
    loadedStickers = (await Promise.all((l || []).map((id) => this.loadSticker(id)))).filter(Boolean) as LoadedSticker[];
  },
  async createPack(name: string) {
    if (!name?.trim()) return;
    const id = `pack-${Utils.generateId()}`;
    this.update(() => {
      store.meta.stickerPacks = [...(store.meta.stickerPacks || []), { id, name: name.trim(), stickers: [] }];
      store.meta.activePackId = activePackId = id;
    });
  },
  async renamePack(pId: string, name: string) {
    this.update(() => store.meta.stickerPacks?.forEach((p) => {
      if (p.id === pId) p.name = name.trim();
    }));
  },
  async deletePack(pId: string) {
    this.update(() => {
      store.meta.stickerPacks = store.meta.stickerPacks?.filter((p) => p.id !== pId);
      if (activePackId === pId) store.meta.activePackId = activePackId = "all";
    });
  },
  async moveStickerToPack(sId: string, pId: string) {
    this.update(() => {
      store.meta.stickerPacks?.forEach((pack) => {
        if (pack.stickers) pack.stickers = pack.stickers.filter((id) => id !== sId);
      });
      store.meta.stickerPacks?.forEach((pack) => {
        if (pack.id === pId) pack.stickers = [...(pack.stickers || []), sId];
      });
    });
  },
  async removeStickerFromPack(sId: string, pId: string) {
    this.update(() => {
      store.meta.stickerPacks?.forEach((pack) => {
        if (pack.id === pId && pack.stickers) pack.stickers = pack.stickers.filter((id) => id !== sId);
      });
    });
  },
  reorderSticker(sId: string, tId: string) {
    if (sId === tId) return;
    const sIdx = loadedStickers.findIndex((x) => x.id === sId), tIdx = loadedStickers.findIndex((x) => x.id === tId);
    if (sIdx > -1 && tIdx > -1) {
      const [m] = loadedStickers.splice(sIdx, 1);
      loadedStickers.splice(tIdx, 0, m);
      loadedStickers = [...loadedStickers];
      const arr = activePackId === "all" ? store.meta.stickers : store.meta.stickerPacks?.find((p) => p.id === activePackId)?.stickers;
      if (arr) {
        arr.splice(arr.indexOf(sId), 1);
        arr.splice(arr.indexOf(tId), 0, sId);
      }
      store.requestSave();
    }
  }
};

const RegionManager = {
  startX: 0,
  startY: 0,
  surfaceId: null as string | null,
  start(e: PointerEvent) {
    const w = (e.target as HTMLElement).closest(".page-wrapper") as HTMLElement;
    if (!w) return;
    isDrawingRegion = true;
    document.body.style.userSelect = "none";
    this.surfaceId = w.dataset.pageId || null;
    const { x, y } = Utils.calcRectOffset(e.clientX, e.clientY, w.getBoundingClientRect());
    this.startX = x;
    this.startY = y;
    tempRegion = { x, y, w: 0, h: 0, surfaceId: this.surfaceId };
  },
  draw(e: PointerEvent) {
    if (!isDrawingRegion) return;
    const w = ([...Utils.qsa(".page-wrapper")] as HTMLElement[]).find((w) => w.dataset.pageId === this.surfaceId);
    if (!w) return;
    const { x, y } = Utils.calcRectOffset(e.clientX, e.clientY, w.getBoundingClientRect());
    tempRegion = {
      ...tempRegion,
      x: Math.min(this.startX, x),
      y: Math.min(this.startY, y),
      w: Math.abs(x - this.startX),
      h: Math.abs(y - this.startY)
    };
  },
  async stop() {
    if (!isDrawingRegion) return;
    isDrawingRegion = false;
    document.body.style.userSelect = "";
    if (tempRegion.surfaceId && tempRegion.w > CONFIG.MIN_REGION_SIZE && tempRegion.h > CONFIG.MIN_REGION_SIZE) {
      const pId = `page-${Utils.generateId()}`;
      store.meta.regions.push({
        id: Utils.generateId(),
        surfaceId: tempRegion.surfaceId,
        x: tempRegion.x,
        y: tempRegion.y,
        width: tempRegion.w,
        height: tempRegion.h,
        pageId: pId,
        paperType: "blank",
        layerBucket: "paper"
      });
      store.pages[pId] = "";
      store.dirtyPages.add(pId);
      await store.executeSave();
    }
  }
};

function milkdownEditor(node: HTMLElement, params: { pageId: string; content: string }) {
  let crepeInstance: Crepe | null = null;
  let isUpdating = false;

  crepeInstance = new Crepe({
    root: node,
    defaultValue: params.content,
  });

  crepeInstance.create().then(() => {
    if (!crepeInstance) return;
    crepeInstance.on((listener) => {
      listener.markdownUpdated((ctx, markdown) => {
        if (isUpdating) return;
        store.pages[params.pageId] = markdown;
        store.dirtyPages.add(params.pageId);
        store.requestSave();
      });
    });
  });

  return {
    update(newParams: { pageId: string; content: string }) {
      if (!crepeInstance) return;
      const currentVal = newParams.content || "";
      if (crepeInstance.getMarkdown() !== currentVal) {
        isUpdating = true;
        crepeInstance.editor.action((ctx) => {
          const parser = ctx.get(parserCtx);
          const newDoc = parser(currentVal);
          const editorView = ctx.get(editorViewCtx);
          const { tr } = editorView.state;
          editorView.dispatch(tr.replaceWith(0, editorView.state.doc.content.size, newDoc));
        });
        isUpdating = false;
      }
    },
    destroy() {
      if (crepeInstance) {
        crepeInstance.destroy();
        crepeInstance = null;
      }
    }
  };
}

const globalKey = (e: KeyboardEvent) => {
  const activeEl = document.activeElement;
  const isI = activeEl && (
    ["TEXTAREA", "INPUT"].includes(activeEl.tagName) ||
    activeEl.getAttribute("contenteditable") === "true" ||
    activeEl.closest("[contenteditable='true']")
  );
  const l = e.key === "ArrowLeft", r = e.key === "ArrowRight";
  if ((l || r) && (!isI || e.altKey)) {
    e.preventDefault();
    store.changePage(l ? -1 : 1, true);
  }
};

const contextMenuCallbacks = new Map<string, () => void>();

function openCtx(e: MouseEvent, items: any[]) {
  e.preventDefault();
  e.stopPropagation();
  
  contextMenuCallbacks.clear();
  
  function processItems(menuItems: any[]): any[] {
    return menuItems.map((item, index) => {
      if (item.type === 'separator') {
        return { type: 'separator' };
      }
      
      const id = `item-${index}-${Math.random().toString(36).substr(2, 9)}`;
      
      const result: any = {
        label: item.label,
        id
      };
      
      if (item.action) {
        contextMenuCallbacks.set(id, item.action);
      }
      
      if (item.submenu) {
        result.submenu = processItems(item.submenu);
      }
      
      return result;
    });
  }
  
  const serializableTemplate = processItems(items);
  if (api?.showContextMenu) {
    api.showContextMenu(serializableTemplate);
  }
}

const showPromptDialog = (t: string, d: string, cb: (v: string) => void) => {
  // Using native browser/electron prompt input modal
  const val = prompt(t, d);
  if (val !== null) {
    cb(val);
  }
};

const tDrop = (e: PointerEvent, on: number) => {
  if (draggingStickerId && draggingStickerId !== "all") {
    (e.currentTarget as HTMLElement).classList[on ? "add" : "remove"]("!bg-zinc-800", "!text-white", "scale-105", "!border-zinc-800");
  }
};

const packBtnClass = (id: string) => `px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 active:scale-95 border ${activePackId === id ? "bg-zinc-900 text-white border-zinc-900 shadow-sm" : "bg-zinc-50 hover:bg-zinc-100 text-zinc-600 border-zinc-200/50"}`;

const globalPaste = (e: ClipboardEvent) => {
  const f = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith("image/"))?.getAsFile();
  if (f) {
    e.preventDefault();
    const r = new FileReader();
    r.onload = (ev) => {
      const b64 = ev.target?.result as string;
      StickerBookManager.saveSticker(b64);
      if (!stickerDrawerOpen) store.spawnImage(b64, pointerX || window.innerWidth / 2, pointerY || window.innerHeight / 2);
    };
    r.readAsDataURL(f);
  }
};

$effect(() => {
  activePackId;
  StickerBookManager.render();
});

onMount(() => {
  let d = false;
  (async () => {
    await store.init();
    if (d) return;
    activePackId = store.meta.activePackId || "all";
    StickerBookManager.render();
    store.restoreAllImages();
  })();
  
  if (api?.onContextMenuClick) {
    api.onContextMenuClick((itemId: string) => {
      if (contextMenuCallbacks.has(itemId)) {
        contextMenuCallbacks.get(itemId)!();
      }
    });
  }

  window.addEventListener("beforeunload", () => {
    store.requestSave.flush();
  });
  return () => (d = true);
});
</script>

<svelte:window onpointermove={(e)=>{pointerX=e.clientX;pointerY=e.clientY;}} onkeydown={globalKey} onpointerup={()=>(draggingStickerId=null)} onpaste={globalPaste} />
<button class="fixed top-6 right-6 w-12 h-12 bg-white text-zinc-800 border border-zinc-200 rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.12)] text-2xl z-[60] hover:scale-110 active:scale-95 transition-all duration-300 flex items-center justify-center select-none" onclick={()=>stickerDrawerOpen=!stickerDrawerOpen}>🎒</button>
<div class="fixed top-0 right-0 w-[340px] h-screen bg-white/90 backdrop-blur-lg shadow-[-10px_0_40px_rgba(0,0,0,0.04)] z-[50] transform transition-transform duration-500 ease-out border-l border-zinc-200/60 p-6 overflow-y-auto {stickerDrawerOpen?'translate-x-0':'translate-x-full'} flex flex-col"><div class="flex items-center justify-between mb-2 mt-16"><h2 class="text-2xl font-extrabold text-zinc-800 tracking-tight">Stickers 🌟</h2><span class="text-xs font-semibold px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-full border border-zinc-200/60 shadow-sm">{loadedStickers.length}</span></div><p class="text-xs text-zinc-500 mb-5 leading-relaxed">Upload images here to turn them into stickers! 👇 💡 <b>Drag stickers onto tabs</b> to organize them. Paste anywhere to add quickly! ✨</p><div class="flex flex-wrap gap-1.5 items-center mb-6 pb-2 border-b border-zinc-100"><button class={packBtnClass("all")} onclick={()=>{activePackId="all";store.meta.activePackId="all";store.requestSave();}} onpointerenter={(e)=>tDrop(e,1)} onpointerleave={(e)=>tDrop(e,0)} onpointerup={(e)=>{tDrop(e,0);draggingStickerId=null;}}>All</button>{#each store.meta.stickerPacks||[] as pack(pack.id)}<button class={packBtnClass(pack.id)} onclick={()=>{activePackId=pack.id;store.meta.activePackId=pack.id;store.requestSave();}} onpointerenter={(e)=>tDrop(e,1)} onpointerleave={(e)=>tDrop(e,0)} onpointerup={(e)=>{tDrop(e,0);if(draggingStickerId){StickerBookManager.moveStickerToPack(draggingStickerId,pack.id);draggingStickerId=null;}}} oncontextmenu={(e)=>openCtx(e,[{label:"Rename",action:()=>showPromptDialog("Rename Sticker Pack ✏️",pack.name,(n)=>StickerBookManager.renamePack(pack.id,n))},{label:"Delete",danger:true,action:()=>StickerBookManager.deletePack(pack.id)}])} title="Right-click to rename/delete. Drag stickers here to add.">{pack.name}</button>{/each}<button class="w-7 h-7 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-700 flex items-center justify-center text-sm font-bold border border-zinc-200/60 active:scale-95 transition-all duration-200" onclick={()=>showPromptDialog("Create New Sticker Pack 📁","",(n)=>StickerBookManager.createPack(n))} title="Create New Sticker Pack">＋</button></div><label class="block w-full cursor-pointer bg-zinc-900 text-white hover:bg-zinc-800 text-center py-3 rounded-xl font-medium text-sm mb-4 transition-all duration-300 hover:shadow-md active:scale-[0.98] border border-transparent">➕ Upload Sticker<input type="file" accept="image/*,image/gif,.gif" class="hidden" onchange={(e)=>{const f=(e.target as HTMLInputElement).files?.[0];if(f){const r=new FileReader();r.onload=(ev)=>StickerBookManager.saveSticker(ev.target?.result as string);r.readAsDataURL(f);}}} /></label><div class="flex-1 overflow-y-auto pr-1"><div class="grid grid-cols-2 gap-4 pb-12">{#if !loadedStickers.length}<div class="col-span-2 text-center text-sm text-zinc-400 mt-4">No stickers saved yet! 😿</div>{/if}{#each loadedStickers as s(s.id)}<div class="relative cursor-grab active:cursor-grabbing group flex items-center justify-center p-3 bg-white/60 hover:bg-white rounded-2xl shadow-sm border border-zinc-200/50 transition-all duration-300 {draggingStickerId===s.id?'opacity-40 scale-95':'hover:-translate-y-0.5'}" onpointerdown={(e)=>{if(e.button!==0)return;e.preventDefault();draggingStickerId=s.id;}} onpointerenter={()=>{if(draggingStickerId&&draggingStickerId!==s.id)StickerBookManager.reorderSticker(draggingStickerId,s.id);}} oncontextmenu={(e)=>openCtx(e,[...(activePackId!=="all"?[{label:`Remove from Pack ❌`,action:()=>StickerBookManager.removeStickerFromPack(s.id,activePackId)}]:[]),{label:"Delete",danger:true,action:()=>StickerBookManager.removeSticker(s.id)}])}><img src={s.src} draggable="false" class="max-w-full max-h-24 object-contain filter drop-shadow-sm group-hover:drop-shadow-md" alt="sticker" /></div>{/each}</div></div></div>
<div class="flex w-full min-h-screen will-change-transform relative items-start transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]" style="transform: translateX(-{store.currentP*100}vw)">
  {#each store.meta.pageOrder as pId, i (pId)}
    <div
      class="page-wrapper w-[100vw] min-h-screen flex-shrink-0 relative flex justify-center overflow-hidden"
      data-page-id={pId}
      use:pointerAction={{
        ignore: (e) =>
          ["TEXTAREA", "BUTTON"].includes((e.target as HTMLElement).tagName) ||
          (e.target as HTMLElement).classList.contains("bullet-text") ||
          !!(e.target as HTMLElement).closest(".region-box") ||
          !!(e.target as HTMLElement).closest(".draggable-image") ||
          !!(e.target as HTMLElement).closest("#page-indicator") ||
          !!(e.target as HTMLElement).closest(".milkdown") ||
          !!(e.target as HTMLElement).closest("[contenteditable='true']"),
        onDown: (e) => RegionManager.start(e),
        onMove: (e) => RegionManager.draw(e),
        onUp: () => RegionManager.stop(),
      }}
      onpointerup={(e) => {
        if (draggingStickerId) {
          const s = loadedStickers.find((st) => st.id === draggingStickerId);
          if (s) {
            const r = e.currentTarget.getBoundingClientRect();
            store.spawnImage(
              s.src,
              e.clientX - r.left,
              e.clientY - r.top
            );
          }
          draggingStickerId = null;
        }
      }}
      ondragover={(e) => e.preventDefault()}
      ondrop={(e) => {
        e.preventDefault();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const f = Array.from(e.dataTransfer?.files || []).find((x) =>
          x.type.startsWith("image/")
        );
        if (f) {
          const fr = new FileReader();
          fr.onload = (ev) => {
            const b = ev.target?.result as string;
            StickerBookManager.saveSticker(b);
            store.spawnImage(b, e.clientX - r.left, e.clientY - r.top);
          };
          fr.readAsDataURL(f);
        }
      }}
    >
      <div class="absolute bottom-8 left-0 w-full text-center text-zinc-400 text-sm font-mono tracking-widest select-none pointer-events-none">
        {i + 1}
      </div>

      {#each store.meta.regions.filter((r) => r.surfaceId === pId) as r (r.id)}
        <div
          class="region-box absolute border transition-colors duration-300 rounded-lg flex flex-col layer-{r.layerBucket || 'paper'} paper-{r.paperType || 'blank'} border-zinc-300 hover:border-zinc-400 shadow-sm"
          data-locked={r.locked}
          style="left:0px;top:0px;width:{r.width}px;min-height:{r.height}px;"
          use:draggable={{
            position: { x: r.x, y: r.y },
            disabled: r.locked,
            handle: ".region-drag-handle",
            bounds: "parent",
            onDrag: ({ offsetX, offsetY }) => {
              r.x = offsetX;
              r.y = offsetY;
            },
            onDragEnd: () => store.requestSave(),
          }}
          oncontextmenu={(e) =>
            openCtx(e, [
              {
                label: r.locked ? "Unlock" : "Lock",
                action: () => {
                  r.locked = !r.locked;
                  store.requestSave();
                },
              },
              {
                label: `Paper (${r.paperType || "blank"})`,
                submenu: CONFIG.PAPER_TYPES.map((pt) => ({
                  label: pt.charAt(0).toUpperCase() + pt.slice(1),
                  action: () => {
                    r.paperType = pt;
                    store.requestSave();
                  },
                })),
              },
              {
                label: `Layer (${r.layerBucket || "paper"})`,
                submenu: CONFIG.LAYERS.map((l) => ({
                  label: l,
                  action: () => {
                    r.layerBucket = l;
                    store.requestSave();
                  },
                })),
              },
              {
                label: "Clear",
                action: () => {
                  store.pages[r.pageId] = "";
                  store.dirtyPages.add(r.pageId);
                  store.requestSave();
                },
              },
              {
                label: "Delete",
                danger: true,
                action: () => store.removeRegion(r.id),
              },
            ])}
        >
          <div
            class="region-drag-handle h-5 bg-transparent {r.locked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'} rounded-t-lg flex items-center px-2 hover:bg-black/5 transition-colors group"
          ></div>
          <div
            class="flex-1 py-2 px-3 overflow-y-auto cursor-text select-text"
            style="touch-action:pan-y;"
            onclick={(e) => {
              e.stopPropagation();
            }}
          >
            <div class="min-h-full w-full h-full milkdown-container">
              <div
                use:milkdownEditor={{
                  pageId: r.pageId,
                  content: store.pages[r.pageId],
                }}
                class="w-full h-full"
              ></div>
            </div>
          </div>
          {#if !r.locked}
            <div
              use:resizeBehavior={{ getRegion: () => r }}
              class="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-end justify-end p-1 opacity-0 hover:opacity-100 transition-opacity z-10"
            >
              <div class="w-2 h-2 border-r-2 border-b-2 border-zinc-400 rounded-sm pointer-events-none"></div>
            </div>
          {/if}
        </div>
      {/each}

      {#if isDrawingRegion && tempRegion.surfaceId === pId}
        <div
          class="absolute border border-zinc-400 bg-white/20 rounded-lg pointer-events-none layer-focus"
          style="left:{tempRegion.x}px;top:{tempRegion.y}px;width:{tempRegion.w}px;height:{tempRegion.h}px"
        ></div>
      {/if}

      {#each store.meta.placedImages.filter((img) => img.pageId === pId) as img (img.id)}
        {#if store.loadedImages[img.id]}
          <img
            src={store.loadedImages[img.id]}
            draggable="false"
            oncontextmenu={(e) =>
              openCtx(e, [
                {
                  label: img.locked ? "Unlock" : "Lock",
                  action: () => {
                    img.locked = !img.locked;
                    store.requestSave();
                  },
                },
                {
                  label: `Resize (${img.scale ?? 1}x)`,
                  submenu: CONFIG.SCALES.map((s) => ({
                    label: `${s}x`,
                    action: () => {
                      img.scale = s;
                      store.requestSave();
                    },
                  })),
                },
                {
                  label: `Opacity (${Math.round((img.opacity ?? 1) * 100)}%)`,
                  submenu: CONFIG.OPACITIES.map((o) => ({
                    label: `${Math.round(o * 100)}%`,
                    action: () => {
                      img.opacity = o;
                      store.requestSave();
                    },
                  })),
                },
                {
                  label: "Rotate",
                  action: () => {
                    img.rotation = ((img.rotation || 0) + 45) % 360;
                    store.requestSave();
                  },
                },
                {
                  label: `Layer (${img.layerBucket || "sticker"})`,
                  submenu: CONFIG.LAYERS.map((l) => ({
                    label: l,
                    action: () => {
                      img.layerBucket = l;
                      store.requestSave();
                    },
                  })),
                },
                {
                  label: "Delete",
                  danger: true,
                  action: () => store.removeImage(img.id),
                },
              ])}
            class="draggable-image layer-{img.layerBucket || 'sticker'} transition-transform duration-200"
            data-locked={img.locked}
            alt="placed"
            style="left:0px;top:0px;rotate:{img.rotation || 0}deg;opacity:{img.opacity ?? 1};scale:{(img.scale ?? 1) * (zoomedImgId === img.id ? 1.25 : 1)};"
            use:draggable={{
              position: { x: img.left, y: img.top },
              disabled: img.locked,
              bounds: "parent",
              onDrag: ({ offsetX, offsetY }) => {
                img.left = offsetX;
                img.top = offsetY;
              },
              onDragEnd: () => store.requestSave(),
            }}
          />
        {/if}
      {/each}
    </div>
  {/each}
</div>
<div id="page-indicator" class="fixed bottom-6 left-1/2 -translate-x-1/2 flex gap-3 z-50 px-6 py-3.5 bg-zinc-100/90 backdrop-blur-md border border-zinc-300 rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.12)] items-center" onclick={(e)=>{const d=(e.target as HTMLElement).closest(".indicator-dot")as HTMLElement;if(d)store.changePage(parseInt(d.dataset.idx||"0"),false);}}>{#each store.meta.pageOrder as _,i}<span data-idx={i} class="indicator-dot cursor-pointer h-2.5 rounded-full transition-all duration-300 {i===store.currentP?'w-7 bg-zinc-800':'w-2.5 bg-zinc-300 hover:bg-zinc-400'}"></span>{/each}</div>
{#if draggingStickerId&&draggingStickerId!=="all"}{@const s=loadedStickers.find((st)=>st.id===draggingStickerId)}{#if s}<img src={s.src} class="fixed pointer-events-none z-[9999] opacity-75 scale-110 drop-shadow-lg" style="left:{pointerX-50}px;top:{pointerY-50}px;width:100px;height:100px;object-fit:contain" alt="ghost" />{/if}{/if}

<style>
:global(body){overflow-x:hidden;overflow-y:auto;background-color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
:global(::-webkit-scrollbar){display:none}
.draggable-image{position:absolute;top:0;left:0;cursor:grab;max-width:300px;filter:drop-shadow(0px 8px 12px rgba(0,0,0,.15));user-select:none;transition:scale .2s ease,rotate .2s ease,opacity .2s ease}
.draggable-image:active{cursor:grabbing}
.draggable-image[data-locked="true"]{cursor:default}
:global(.layer-background){z-index:10}
:global(.layer-paper){z-index:20}
:global(.layer-sticker){z-index:30}
:global(.layer-floating){z-index:40}
:global(.layer-focus){z-index:50}
:global(.paper-blank){background-color:rgba(250,250,250,.9)}
:global(.paper-dot){background:radial-gradient(#d4d4d8 1.5px,transparent 1.5px) 0 0/24px 24px rgba(250,250,250,.9)}
:global(.paper-ruled){background:repeating-linear-gradient(transparent,transparent 27px,#e4e4e7 27px,#e4e4e7 28px) 0 0/100% 28px rgba(250,250,250,.9)}
:global(.paper-graph){background:repeating-linear-gradient(#e4e4e7 0 1px,transparent 1px 100%) 0 0/24px 24px,repeating-linear-gradient(90deg,#e4e4e7 0 1px,transparent 1px 100%) 0 0/24px 24px rgba(250,250,250,.9)}

/* Milkdown overrides to look premium and transparent */
:global(.milkdown) {
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
  width: 100% !important;
  height: 100% !important;
  font-size: 14px;
}
:global(.milkdown .editor) {
  background: transparent !important;
  padding: 0 !important;
  outline: none !important;
  min-height: 50px;
  color: #27272a;
}
:global(.milkdown .editor p) {
  margin-bottom: 0.5em !important;
  line-height: 1.5;
}
</style>