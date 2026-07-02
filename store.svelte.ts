import { onMount } from "svelte";
import { debounce } from "lodash-es";

export interface Region {
  id: string;
  surfaceId: string; // Parent page ID
  x: number;
  y: number;
  width: number;
  height: number;
  pageId: string; // The region's unique content ID (matches the file name in regions/)
  locked?: boolean;
  paperType?: string;
  layerBucket?: string;
}

export interface PlacedImage {
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

export interface StickerPack {
  id: string;
  name: string;
  stickers: string[];
}

export interface MetaState {
  version?: number;
  currentP: number;
  pageOrder: string[];
  stickers: string[];
  stickerPacks: StickerPack[];
  activePackId: string;
  scrolls?: number[];
}

export interface PageState {
  regions: Region[];
  placedImages: PlacedImage[];
}

export interface LoadedSticker {
  id: string;
  src: string;
}

export const CONFIG = {
  SAVE_TIMEOUT_MS: 500,
  LAYERS: ["background", "paper", "sticker", "floating", "focus"],
  OPACITIES: [1, 0.75, 0.5, 0.25],
  SCALES: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3],
  PAPER_TYPES: ["blank", "dot", "ruled", "graph"],
  MIN_REGION_SIZE: 50,
};

const api = (window as any).electronAPI;
const memFs = new Map<string, any>();
export const FileSystemAPI = {
  readJson: async (p: string) => api ? await api.readJson(p) : (memFs.get(p) ?? null),
  readText: async (p: string) => api ? await api.readText(p) : (memFs.get(p) ?? null),
  writeJsonAtomic: async (p: string, d: any) => api ? await api.writeJsonAtomic(p, d) : memFs.set(p, d),
  writeTextAtomic: async (p: string, d: string) => api ? await api.writeTextAtomic(p, d) : memFs.set(p, d),
  writeImageBase64: async (p: string, d: string) => api ? await api.writeImageBase64(p, d) : memFs.set(p, d),
  trashJson: async (p: string) => api ? await api.trashJson(p) : memFs.delete(p)
};

export const Utils = {
  generateId: () => crypto.randomUUID(),
  clamp: (v: number, m: number, x: number) => Math.max(m, Math.min(x, v)),
  calcRectOffset: (cX: number, cY: number, r: DOMRect) => ({ x: cX - r.left, y: cY - r.top }),
  qsa: (s: string) => document.querySelectorAll(s)
};

function getExtensionFromBase64(b64: string): string {
  const m = b64.match(/data:image\/(\w+);base64,/);
  return m ? m[1] : 'png';
}

class BujoStore {
  meta = $state<MetaState>({
    version: 5,
    currentP: 0,
    pageOrder: [],
    stickers: [],
    stickerPacks: [],
    activePackId: "all"
  });

  loadedPages = $state<Record<string, PageState>>({});
  loadedRegionMarkdown = $state<Record<string, string>>({});
  loadedImages = $state<Record<string, string>>({});
  pageTransforms = $state<Record<string, { zoom: number; pan: { x: number; y: number } }>>({});

  getTransform(pId: string) {
    return this.pageTransforms[pId] || { zoom: 1, pan: { x: 0, y: 0 } };
  }

  // Centralized UI states to avoid invalid state exports in Svelte 5
  loadedStickers = $state<LoadedSticker[]>([]);
  draggingStickerId = $state<string | null>(null);
  stickerDrawerOpen = $state(false);
  pointerX = $state(0);
  pointerY = $state(0);
  isDrawingRegion = $state(false);
  tempRegion = $state({ x: 0, y: 0, w: 0, h: 0, surfaceId: "" as string | null });

  dirtyPages = new Set<string>();
  dirtyRegions = new Set<string>();
  isSaving = false;
  needsSave = false;

  requestSave = debounce(() => this.executeSave(), CONFIG.SAVE_TIMEOUT_MS);

  async init() {
    let m = await FileSystemAPI.readJson("meta.json");
    if (!m) {
      m = {
        version: 5,
        currentP: 0,
        pageOrder: [],
        stickers: [],
        stickerPacks: [],
        activePackId: "all"
      };
    }

    if (!m.pageOrder.length) {
      m.pageOrder.push(`page-${Utils.generateId()}`, `page-${Utils.generateId()}`);
      await FileSystemAPI.writeJsonAtomic("meta.json", m);
    }

    this.meta = m;

    // Load active and adjacent pages (currentP, currentP-1, currentP+1)
    await this.loadActiveAndAdjacentPages();
  }

  async loadPage(pageId: string) {
    if (this.loadedPages[pageId]) return;
    const pageData = await FileSystemAPI.readJson(`pages/${pageId}.json`);
    const regions = pageData?.regions || [];
    const placedImages = pageData?.placedImages || [];
    this.loadedPages[pageId] = { regions, placedImages };

    // Load region contents on demand
    for (const r of regions) {
      if (this.loadedRegionMarkdown[r.pageId] === undefined) {
        let raw = await FileSystemAPI.readText(`regions/${r.pageId}.md`);
        this.loadedRegionMarkdown[r.pageId] = raw || "";
      }
    }

    // Load images
    for (const img of placedImages) {
      await this.renderImage(img);
    }
  }

  unloadPage(pageId: string) {
    const page = this.loadedPages[pageId];
    if (!page) return;

    // Remove region markdown from memory
    for (const r of page.regions) {
      delete this.loadedRegionMarkdown[r.pageId];
    }

    // Remove images from memory
    for (const img of page.placedImages) {
      delete this.loadedImages[img.id];
    }

    delete this.loadedPages[pageId];
  }

  async loadActiveAndAdjacentPages() {
    const currentIdx = this.meta.currentP;
    const pageOrder = this.meta.pageOrder;
    if (!pageOrder.length) return;

    const activeIndices = new Set<number>();
    activeIndices.add(currentIdx);
    if (currentIdx > 0) activeIndices.add(currentIdx - 1);
    if (currentIdx < pageOrder.length - 1) activeIndices.add(currentIdx + 1);

    const activePageIds = new Set<string>();
    for (const idx of activeIndices) {
      const pId = pageOrder[idx];
      activePageIds.add(pId);
      await this.loadPage(pId);
    }

    // Memory cleanup: Unload any pages that are no longer active or adjacent
    for (const loadedPageId of Object.keys(this.loadedPages)) {
      if (!activePageIds.has(loadedPageId)) {
        this.unloadPage(loadedPageId);
      }
    }
  }

  async executeSave() {
    if (this.isSaving) return (this.needsSave = true);
    this.isSaving = true;
    this.needsSave = false;
    try {
      await this.cleanEmptySpreads();
      
      // Save global meta.json
      await FileSystemAPI.writeJsonAtomic("meta.json", $state.snapshot(this.meta));

      // Save dirty pages under pages/
      for (const p of Array.from(this.dirtyPages)) {
        const pageData = this.loadedPages[p];
        if (pageData) {
          await FileSystemAPI.writeJsonAtomic(`pages/${p}.json`, $state.snapshot(pageData));
        }
      }
      this.dirtyPages.clear();

      // Save dirty regions under regions/
      for (const rId of Array.from(this.dirtyRegions)) {
        const markdown = this.loadedRegionMarkdown[rId];
        if (markdown !== undefined) {
          await FileSystemAPI.writeTextAtomic(`regions/${rId}.md`, markdown);
        }
      }
      this.dirtyRegions.clear();
    } catch (e) {
      console.error(e);
    } finally {
      this.isSaving = false;
      if (this.needsSave) this.executeSave();
    }
  }

  async cleanEmptySpreads() {
    let c = false;
    const pageOrder = this.meta.pageOrder;
    for (let i = pageOrder.length - 1; i > this.meta.currentP; i--) {
      const pId = pageOrder[i];
      const pageData = this.loadedPages[pId] || await FileSystemAPI.readJson(`pages/${pId}.json`);
      const hasImages = pageData?.placedImages?.length > 0;
      const hasRegions = pageData?.regions?.length > 0;
      
      if (!hasImages && !hasRegions) {
        this.unloadPage(pId);
        pageOrder.splice(i, 1);
        this.meta.scrolls?.splice(i, 1);
        await FileSystemAPI.trashJson(`pages/${pId}.json`);
        c = true;
      }
    }
    if (this.meta.currentP >= pageOrder.length) {
      this.meta.currentP = Math.max(0, pageOrder.length - 1);
      c = true;
    }
    return c;
  }

  async ensureEnoughPages() {
    if (this.meta.currentP >= this.meta.pageOrder.length) {
      const newPageId = `page-${Utils.generateId()}`;
      this.meta.pageOrder.push(newPageId);
      await FileSystemAPI.writeJsonAtomic(`pages/${newPageId}.json`, { regions: [], placedImages: [] });
      await FileSystemAPI.writeJsonAtomic("meta.json", $state.snapshot(this.meta));
      return true;
    }
    return false;
  }

  async changePage(d: number, isR = true) {
    const nP = isR ? this.meta.currentP + d : d;
    if (nP < 0) return;
    this.meta.currentP = nP;
    await this.ensureEnoughPages();
    await this.loadActiveAndAdjacentPages();
    window.scrollTo({ top: 0, behavior: "smooth" });
    await this.executeSave();
  }

  async spawnImage(src: string, cX?: number, cY?: number, targetPageId?: string) {
    const ext = getExtensionFromBase64(src);
    const id = `${Utils.generateId()}.${ext}`;
    await FileSystemAPI.writeImageBase64(`images/${id}`, src);
    
    const pageId = targetPageId || this.meta.pageOrder[this.meta.currentP];
    const img: PlacedImage = {
      id,
      pageId,
      left: cX !== undefined ? cX - 50 : 100,
      top: cY !== undefined ? cY - 50 : 100,
      layerBucket: "sticker"
    };

    if (this.loadedPages[pageId]) {
      this.loadedPages[pageId].placedImages.push(img);
    }
    this.dirtyPages.add(pageId);
    await this.executeSave();
    this.renderImage(img);
  }

  async renderImage(d: PlacedImage) {
    this.loadedImages[d.id] = `bujo://images/${d.id}`;
  }

  restoreActiveImages() {
    const activePageIds = new Set<string>();
    const currentIdx = this.meta.currentP;
    const pageOrder = this.meta.pageOrder;

    if (pageOrder[currentIdx]) activePageIds.add(pageOrder[currentIdx]);
    if (currentIdx > 0 && pageOrder[currentIdx - 1]) activePageIds.add(pageOrder[currentIdx - 1]);
    if (currentIdx < pageOrder.length - 1 && pageOrder[currentIdx + 1]) activePageIds.add(pageOrder[currentIdx + 1]);

    for (const pId of activePageIds) {
      const page = this.loadedPages[pId];
      if (page) {
        page.placedImages.forEach((d) => this.renderImage(d));
      }
    }
  }

  async removeImage(id: string) {
    const pageId = this.meta.pageOrder[this.meta.currentP];
    const page = this.loadedPages[pageId];
    if (!page) return;

    const idx = page.placedImages.findIndex((i) => i.id === id);
    if (idx !== -1) {
      page.placedImages.splice(idx, 1);
      this.dirtyPages.add(pageId);
      await this.executeSave();
      delete this.loadedImages[id];
      await FileSystemAPI.trashJson(`images/${id}`);
    }
  }

  async removeRegion(id: string) {
    const pageId = this.meta.pageOrder[this.meta.currentP];
    const page = this.loadedPages[pageId];
    if (!page) return;

    const idx = page.regions.findIndex((r) => r.id === id);
    if (idx !== -1) {
      const r = page.regions[idx];
      page.regions.splice(idx, 1);
      this.dirtyPages.add(pageId);
      delete this.loadedRegionMarkdown[r.pageId];
      this.dirtyRegions.delete(r.pageId);
      await this.executeSave();
      await FileSystemAPI.trashJson(`regions/${r.pageId}.md`);
    }
  }
}

export const store = new BujoStore();

export const StickerBookManager = {
  async update(fn: () => void) {
    fn();
    await store.executeSave();
    await this.render();
  },
  async saveSticker(b64: string) {
    const ext = getExtensionFromBase64(b64);
    const id = `${Utils.generateId()}.${ext}`;
    await FileSystemAPI.writeImageBase64(`stickers/${id}`, b64);
    this.update(() => {
      store.meta.stickers = [...(store.meta.stickers || []), id];
      if (store.meta.activePackId !== "all") store.meta.stickerPacks?.forEach((p) => {
        if (p.id === store.meta.activePackId) p.stickers = [...(p.stickers || []), id];
      });
    });
  },
  async removeSticker(id: string) {
    this.update(() => {
      store.meta.stickers = store.meta.stickers?.filter((s) => s !== id);
      store.meta.stickerPacks?.forEach((p) => (p.stickers = p.stickers?.filter((s) => s !== id)));
    });
    await FileSystemAPI.trashJson(`stickers/${id}`);
  },
  async loadSticker(id: string) {
    const src = `bujo://stickers/${id}`;
    return { id, src };
  },
  async render() {
    const packed = new Set(store.meta.stickerPacks?.flatMap((p) => p.stickers || []) || []);
    const l = store.meta.activePackId === "all"
      ? store.meta.stickers?.filter(id => !packed.has(id))
      : store.meta.stickerPacks?.find((p) => p.id === store.meta.activePackId)?.stickers;
    store.loadedStickers = (await Promise.all((l || []).map((id) => this.loadSticker(id)))).filter(Boolean) as LoadedSticker[];
  },
  async createPack(name: string) {
    if (!name?.trim()) return;
    const id = `pack-${Utils.generateId()}`;
    this.update(() => {
      store.meta.stickerPacks = [...(store.meta.stickerPacks || []), { id, name: name.trim(), stickers: [] }];
      store.meta.activePackId = id;
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
      if (store.meta.activePackId === pId) store.meta.activePackId = "all";
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
    const sIdx = store.loadedStickers.findIndex((x) => x.id === sId), tIdx = store.loadedStickers.findIndex((x) => x.id === tId);
    if (sIdx > -1 && tIdx > -1) {
      const [m] = store.loadedStickers.splice(sIdx, 1);
      store.loadedStickers.splice(tIdx, 0, m);
      store.loadedStickers = [...store.loadedStickers];
      const arr = store.meta.activePackId === "all" ? store.meta.stickers : store.meta.stickerPacks?.find((p) => p.id === store.meta.activePackId)?.stickers;
      if (arr) {
        arr.splice(arr.indexOf(sId), 1);
        arr.splice(arr.indexOf(tId), 0, sId);
      }
      store.requestSave();
    }
  }
};

export const RegionManager = {
  startX: 0,
  startY: 0,
  surfaceId: null as string | null,
  start(e: PointerEvent) {
    const w = (e.target as HTMLElement).closest(".page-wrapper") as HTMLElement;
    if (!w) return;
    store.isDrawingRegion = true;
    document.body.style.userSelect = "none";
    this.surfaceId = w.dataset.pageId || null;
    const rect = w.getBoundingClientRect();
    const transform = store.getTransform(this.surfaceId!);
    const x = (e.clientX - rect.left - transform.pan.x) / transform.zoom;
    const y = (e.clientY - rect.top - transform.pan.y) / transform.zoom;
    this.startX = x;
    this.startY = y;
    store.tempRegion = { x, y, w: 0, h: 0, surfaceId: this.surfaceId };
  },
  draw(e: PointerEvent) {
    if (!store.isDrawingRegion) return;
    const w = ([...Utils.qsa(".page-wrapper")] as HTMLElement[]).find((w) => w.dataset.pageId === this.surfaceId);
    if (!w) return;
    const rect = w.getBoundingClientRect();
    const transform = store.getTransform(this.surfaceId!);
    const x = (e.clientX - rect.left - transform.pan.x) / transform.zoom;
    const y = (e.clientY - rect.top - transform.pan.y) / transform.zoom;
    store.tempRegion = {
      ...store.tempRegion,
      x: Math.min(this.startX, x),
      y: Math.min(this.startY, y),
      w: Math.abs(x - this.startX),
      h: Math.abs(y - this.startY)
    };
  },
  async stop() {
    if (!store.isDrawingRegion) return;
    store.isDrawingRegion = false;
    document.body.style.userSelect = "";
    if (store.tempRegion.surfaceId && store.tempRegion.w > CONFIG.MIN_REGION_SIZE && store.tempRegion.h > CONFIG.MIN_REGION_SIZE) {
      const rId = Utils.generateId();
      const pId = `regions-${Utils.generateId()}`; // unique region text content ID
      
      const newRegion: Region = {
        id: rId,
        surfaceId: store.tempRegion.surfaceId,
        x: store.tempRegion.x,
        y: store.tempRegion.y,
        width: store.tempRegion.w,
        height: store.tempRegion.h,
        pageId: pId,
        paperType: "blank",
        layerBucket: "paper"
      };

      const parentPageId = store.tempRegion.surfaceId;
      if (store.loadedPages[parentPageId]) {
        store.loadedPages[parentPageId].regions.push(newRegion);
      }
      store.loadedRegionMarkdown[pId] = "";
      
      store.dirtyPages.add(parentPageId);
      store.dirtyRegions.add(pId);
      await store.executeSave();
    }
  }
};

export function customDraggable(node: HTMLElement, params: { left: number; top: number; locked?: boolean; onDrag: (left: number, top: number) => void; onDragEnd?: () => void }) {
  let active = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;
  let currentParams = params;

  const onPointerDown = (e: PointerEvent) => {
    if (currentParams.locked || e.button !== 0) return;
    
    // If it is a region box and the target isn't the drag handle, don't drag
    const target = e.target as HTMLElement;
    if (node.classList.contains("region-box") && !target.closest(".region-drag-handle")) {
      return;
    }

    active = true;
    node.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    initialLeft = currentParams.left;
    initialTop = currentParams.top;
    
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!active) return;
    if (currentParams.locked) return;
    const pageWrapper = node.closest(".page-wrapper") as HTMLElement;
    const pageId = pageWrapper?.dataset.pageId;
    const zoom = pageId ? store.getTransform(pageId).zoom : 1;
    const dx = (e.clientX - startX) / zoom;
    const dy = (e.clientY - startY) / zoom;
    currentParams.onDrag(initialLeft + dx, initialTop + dy);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!active) return;
    active = false;
    node.releasePointerCapture(e.pointerId);
    currentParams.onDragEnd?.();
  };

  node.addEventListener("pointerdown", onPointerDown);
  node.addEventListener("pointermove", onPointerMove);
  node.addEventListener("pointerup", onPointerUp);
  node.addEventListener("pointercancel", onPointerUp);

  return {
    update(newParams: typeof params) {
      currentParams = newParams;
    },
    destroy() {
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", onPointerUp);
      node.removeEventListener("pointercancel", onPointerUp);
    }
  };
}

export function customResizable(node: HTMLElement, params: { width: number; height: number; locked?: boolean; onResize: (w: number, h: number) => void; onResizeEnd?: () => void }) {
  let active = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let currentParams = params;

  const onPointerDown = (e: PointerEvent) => {
    if (currentParams.locked || e.button !== 0) return;
    
    active = true;
    node.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    startWidth = currentParams.width;
    startHeight = currentParams.height;
    
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!active) return;
    const pageWrapper = node.closest(".page-wrapper") as HTMLElement;
    const pageId = pageWrapper?.dataset.pageId;
    const zoom = pageId ? store.getTransform(pageId).zoom : 1;
    const dx = (e.clientX - startX) / zoom;
    const dy = (e.clientY - startY) / zoom;
    currentParams.onResize(
      Math.max(CONFIG.MIN_REGION_SIZE, startWidth + dx),
      Math.max(CONFIG.MIN_REGION_SIZE, startHeight + dy)
    );
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!active) return;
    active = false;
    node.releasePointerCapture(e.pointerId);
    currentParams.onResizeEnd?.();
  };

  node.addEventListener("pointerdown", onPointerDown);
  node.addEventListener("pointermove", onPointerMove);
  node.addEventListener("pointerup", onPointerUp);
  node.addEventListener("pointercancel", onPointerUp);

  return {
    update(newParams: typeof params) {
      currentParams = newParams;
    },
    destroy() {
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", onPointerUp);
      node.removeEventListener("pointercancel", onPointerUp);
    }
  };
}

const contextMenuCallbacks = new Map<string, () => void>();

export function openCtx(e: MouseEvent, items: any[]) {
  e.preventDefault();
  e.stopPropagation();
  
  contextMenuCallbacks.clear();
  
  function processItems(menuItems: any[]): any[] {
    return menuItems.map((item, index) => {
      if (item.type === 'separator') {
        return { type: 'separator' };
      }
      
      const id = `item-${index}-${Math.random().toString(36).substring(2, 11)}`;
      
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

export function initContextMenuListener() {
  if (api?.onContextMenuClick) {
    api.onContextMenuClick((itemId: string) => {
      if (contextMenuCallbacks.has(itemId)) {
        contextMenuCallbacks.get(itemId)!();
      }
    });
  }
}
