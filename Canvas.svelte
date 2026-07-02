<script lang="ts">
  import type { Action } from "svelte/action";
  import { Crepe } from "@milkdown/crepe";
  import { parserCtx, editorViewCtx } from "@milkdown/core";
  import "@milkdown/crepe/theme/common/style.css";
  import "@milkdown/crepe/theme/frame.css";

  import {
    store,
    CONFIG,
    Utils,
    StickerBookManager,
    RegionManager,
    customDraggable,
    customResizable,
    openCtx
  } from "./store.svelte";

  let zoomedImgId = $state<string | null>(null);

  // 📝 MILKDOWN INTEGRATION
  function milkdownEditor(node: HTMLElement, params: { pageId: string; content: string }) {
    let crepeInstance: Crepe | null = null;

    crepeInstance = new Crepe({
      root: node,
      defaultValue: params.content,
    });

    crepeInstance.create().then(() => {
      if (!crepeInstance) return;
      crepeInstance.on((listener) => {
        listener.markdownUpdated((ctx, markdown) => {
          store.loadedRegionMarkdown[params.pageId] = markdown;
          store.dirtyRegions.add(params.pageId);
          store.requestSave();
        });
      });
    });

    return {
      update(newParams: { pageId: string; content: string }) {
        if (!crepeInstance) return;
        const currentVal = newParams.content || "";
        if (crepeInstance.getMarkdown() !== currentVal) {
          crepeInstance.editor.action((ctx) => {
            const parser = ctx.get(parserCtx);
            const newDoc = parser(currentVal);
            const editorView = ctx.get(editorViewCtx);
            const { tr } = editorView.state;
            editorView.dispatch(tr.replaceWith(0, editorView.state.doc.content.size, newDoc));
          });
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

  // 🖱️ REGION DRAWING POINTER ACTION
  interface PointerActionParams {
    onDown?: (e: PointerEvent) => void;
    onMove?: (e: PointerEvent) => void;
    onUp?: (e: PointerEvent) => void;
    ignore?: (e: PointerEvent) => boolean;
  }

  const pointerAction: Action<HTMLElement, PointerActionParams> = (node, { onDown, onMove, onUp, ignore }) => {
    let active = false;
    const dn = (e: PointerEvent) => {
      if (e.button !== 0 || ignore?.(e)) return;
      active = true;
      node.setPointerCapture(e.pointerId);
      onDown?.(e);
    };
    const mv = (e: PointerEvent) => {
      if (active) onMove?.(e);
    };
    const up = (e: PointerEvent) => {
      if (!active) return;
      active = false;
      node.releasePointerCapture(e.pointerId);
      onUp?.(e);
    };
    const hs = [dn, mv, up, up];
    const evs = ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const;
    evs.forEach((ev, i) => node.addEventListener(ev, hs[i]));
    return { destroy: () => evs.forEach((ev, i) => node.removeEventListener(ev, hs[i])) };
  };
</script>

<div
  class="flex w-full min-h-screen will-change-transform relative items-start transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
  style="transform: translateX(-{store.meta.currentP * 100}vw)"
>
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
        if (store.draggingStickerId) {
          const s = store.loadedStickers.find((st) => st.id === store.draggingStickerId);
          if (s) {
            const r = e.currentTarget.getBoundingClientRect();
            store.spawnImage(
              s.src,
              e.clientX - r.left,
              e.clientY - r.top
            );
          }
          store.draggingStickerId = null;
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

      {#if store.loadedPages[pId]}
        <!-- 📐 REGIONS -->
        {#each store.loadedPages[pId].regions as r (r.id)}
          <div
            class="region-box absolute border transition-colors duration-300 rounded-lg flex flex-col layer-{r.layerBucket || 'paper'} paper-{r.paperType || 'blank'} border-zinc-300 hover:border-zinc-400 shadow-sm"
            data-locked={r.locked}
            style="left:{r.x}px;top:{r.y}px;width:{r.width}px;min-height:{r.height}px;"
            use:customDraggable={{
              left: r.x,
              top: r.y,
              locked: r.locked,
              onDrag: (x, y) => {
                r.x = x;
                r.y = y;
              },
              onDragEnd: () => store.requestSave()
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
                    store.loadedRegionMarkdown[r.pageId] = "";
                    store.dirtyRegions.add(r.pageId);
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
                {#if store.loadedRegionMarkdown[r.pageId] !== undefined}
                  <div
                    use:milkdownEditor={{
                      pageId: r.pageId,
                      content: store.loadedRegionMarkdown[r.pageId],
                    }}
                    class="w-full h-full"
                  ></div>
                {/if}
              </div>
            </div>
            {#if !r.locked}
              <div
                use:customResizable={{
                  width: r.width,
                  height: r.height,
                  locked: r.locked,
                  onResize: (w, h) => {
                    r.width = w;
                    r.height = h;
                  },
                  onResizeEnd: () => store.requestSave()
                }}
                class="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-end justify-end p-1 opacity-0 hover:opacity-100 transition-opacity z-10"
              >
                <div class="w-2 h-2 border-r-2 border-b-2 border-zinc-400 rounded-sm pointer-events-none"></div>
              </div>
            {/if}
          </div>
        {/each}

        <!-- 🖼️ PLACED IMAGES -->
        {#each store.loadedPages[pId].placedImages as img (img.id)}
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
              class="draggable-image layer-{img.layerBucket || 'sticker'}"
              data-locked={img.locked}
              alt="placed"
              style="left:{img.left}px;top:{img.top}px;transform: rotate({img.rotation || 0}deg) scale({(img.scale ?? 1) * (zoomedImgId === img.id ? 1.25 : 1)}); opacity:{img.opacity ?? 1}; transform-origin: center;"
              use:customDraggable={{
                left: img.left,
                top: img.top,
                locked: img.locked,
                onDrag: (x, y) => {
                  img.left = x;
                  img.top = y;
                },
                onDragEnd: () => store.requestSave()
              }}
            />
          {/if}
        {/each}
      {/if}

      <!-- ✏️ DRAWING GHOST REGION -->
      {#if store.isDrawingRegion && store.tempRegion.surfaceId === pId}
        <div
          class="absolute border border-zinc-400 bg-white/20 rounded-lg pointer-events-none layer-focus"
          style="left:{store.tempRegion.x}px;top:{store.tempRegion.y}px;width:{store.tempRegion.w}px;height:{store.tempRegion.h}px"
        ></div>
      {/if}
    </div>
  {/each}
</div>

<!-- 🔴 PAGE DOT INDICATORS -->
<div
  id="page-indicator"
  class="fixed bottom-6 left-1/2 -translate-x-1/2 flex gap-3 z-50 px-6 py-3.5 bg-zinc-100/90 backdrop-blur-md border border-zinc-300 rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.12)] items-center"
  onclick={(e) => {
    const d = (e.target as HTMLElement).closest(".indicator-dot") as HTMLElement;
    if (d) store.changePage(parseInt(d.dataset.idx || "0"), false);
  }}
>
  {#each store.meta.pageOrder as _, i}
    <span
      data-idx={i}
      class="indicator-dot cursor-pointer h-2.5 rounded-full transition-all duration-300 {i === store.meta.currentP
        ? 'w-7 bg-zinc-800'
        : 'w-2.5 bg-zinc-300 hover:bg-zinc-400'}"
    ></span>
  {/each}
</div>

<!-- 👻 GHOST STICKER DURING DRAGGING -->
{#if store.draggingStickerId && store.draggingStickerId !== "all"}
  {@const s = store.loadedStickers.find((st) => st.id === store.draggingStickerId)}
  {#if s}
    <img
      src={s.src}
      class="fixed pointer-events-none z-[9999] opacity-75 scale-110 drop-shadow-lg"
      style="left:{store.pointerX - 50}px;top:{store.pointerY - 50}px;width:100px;height:100px;object-fit:contain"
      alt="ghost"
    />
  {/if}
{/if}

<style>
  .draggable-image {
    position: absolute;
    top: 0;
    left: 0;
    cursor: grab;
    max-width: 300px;
    filter: drop-shadow(0px 8px 12px rgba(0, 0, 0, 0.15));
    user-select: none;
    transition: scale 0.2s ease, rotate 0.2s ease, opacity 0.2s ease;
  }
  .draggable-image:active {
    cursor: grabbing;
  }
  .draggable-image[data-locked="true"] {
    cursor: default;
  }
</style>
