<script lang="ts">
  import {
    store,
    StickerBookManager,
    openCtx
  } from "./store.svelte";

  const showPromptDialog = (t: string, d: string, cb: (v: string) => void) => {
    const val = prompt(t, d);
    if (val !== null) {
      cb(val);
    }
  };

  const tDrop = (e: PointerEvent, on: number) => {
    if (store.draggingStickerId && store.draggingStickerId !== "all") {
      (e.currentTarget as HTMLElement).classList[on ? "add" : "remove"](
        "!bg-zinc-800",
        "!text-white",
        "scale-105",
        "!border-zinc-800"
      );
    }
  };

  const packBtnClass = (pId: string) =>
    `px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 active:scale-95 border ${
      store.meta.activePackId === pId
        ? "bg-zinc-900 text-white border-zinc-900 shadow-sm"
        : "bg-zinc-50 hover:bg-zinc-100 text-zinc-600 border-zinc-200/50"
    }`;
</script>

<button
  class="fixed top-6 right-6 w-12 h-12 bg-white text-zinc-800 border border-zinc-200 rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.12)] text-2xl z-[60] hover:scale-110 active:scale-95 transition-all duration-300 flex items-center justify-center select-none"
  onclick={() => store.stickerDrawerOpen = !store.stickerDrawerOpen}
>
  🎒
</button>

<div
  class="fixed top-0 right-0 w-[340px] h-screen bg-white/90 backdrop-blur-lg shadow-[-10px_0_40px_rgba(0,0,0,0.04)] z-[50] transform transition-transform duration-500 ease-out border-l border-zinc-200/60 p-6 overflow-y-auto {store.stickerDrawerOpen
    ? 'translate-x-0'
    : 'translate-x-full'} flex flex-col"
>
  <div class="flex items-center justify-between mb-2 mt-16">
    <h2 class="text-2xl font-extrabold text-zinc-800 tracking-tight">Stickers 🌟</h2>
    <span class="text-xs font-semibold px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-full border border-zinc-200/60 shadow-sm">
      {store.loadedStickers.length}
    </span>
  </div>
  
  <p class="text-xs text-zinc-500 mb-5 leading-relaxed">
    Upload images here to turn them into stickers! 👇 💡 <b>Drag stickers onto tabs</b> to organize them. Paste anywhere to add quickly! ✨
  </p>

  <div class="flex flex-wrap gap-1.5 items-center mb-6 pb-2 border-b border-zinc-100">
    <button
      class={packBtnClass("all")}
      onclick={() => {
        store.meta.activePackId = "all";
        store.requestSave();
      }}
      onpointerenter={(e) => tDrop(e, 1)}
      onpointerleave={(e) => tDrop(e, 0)}
      onpointerup={(e) => {
        tDrop(e, 0);
        store.draggingStickerId = null;
      }}
    >
      All
    </button>
    
    {#each store.meta.stickerPacks || [] as pack (pack.id)}
      <button
        class={packBtnClass(pack.id)}
        onclick={() => {
          store.meta.activePackId = pack.id;
          store.requestSave();
        }}
        onpointerenter={(e) => tDrop(e, 1)}
        onpointerleave={(e) => tDrop(e, 0)}
        onpointerup={(e) => {
          tDrop(e, 0);
          if (store.draggingStickerId) {
            StickerBookManager.moveStickerToPack(store.draggingStickerId, pack.id);
            store.draggingStickerId = null;
          }
        }}
        oncontextmenu={(e) =>
          openCtx(e, [
            {
              label: "Rename",
              action: () =>
                showPromptDialog("Rename Sticker Pack ✏️", pack.name, (n) =>
                  StickerBookManager.renamePack(pack.id, n)
                ),
            },
            {
              label: "Delete",
              danger: true,
              action: () => StickerBookManager.deletePack(pack.id),
            },
          ])}
        title="Right-click to rename/delete. Drag stickers here to add."
      >
        {pack.name}
      </button>
    {/each}

    <button
      class="w-7 h-7 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-700 flex items-center justify-center text-sm font-bold border border-zinc-200/60 active:scale-95 transition-all duration-200"
      onclick={() =>
        showPromptDialog("Create New Sticker Pack 📁", "", (n) =>
          StickerBookManager.createPack(n)
        )}
      title="Create New Sticker Pack"
    >
      ＋
    </button>
  </div>

  <label class="block w-full cursor-pointer bg-zinc-900 text-white hover:bg-zinc-800 text-center py-3 rounded-xl font-medium text-sm mb-4 transition-all duration-300 hover:shadow-md active:scale-[0.98] border border-transparent">
    ➕ Upload Sticker
    <input
      type="file"
      accept="image/*,image/gif,.gif"
      class="hidden"
      onchange={(e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) {
          const r = new FileReader();
          r.onload = (ev) =>
            StickerBookManager.saveSticker(ev.target?.result as string);
          r.readAsDataURL(f);
        }
      }}
    />
  </label>

  <div class="flex-1 overflow-y-auto pr-1">
    <div class="grid grid-cols-2 gap-4 pb-12">
      {#if !store.loadedStickers.length}
        <div class="col-span-2 text-center text-sm text-zinc-400 mt-4">
          No stickers saved yet! 😿
        </div>
      {/if}
      
      {#each store.loadedStickers as s (s.id)}
        <div
          class="relative cursor-grab active:cursor-grabbing group flex items-center justify-center p-3 bg-white/60 hover:bg-white rounded-2xl shadow-sm border border-zinc-200/50 transition-all duration-300 {store.draggingStickerId ===
          s.id
            ? 'opacity-40 scale-95'
            : 'hover:-translate-y-0.5'}"
          onpointerdown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            store.draggingStickerId = s.id;
          }}
          onpointerenter={() => {
            if (store.draggingStickerId && store.draggingStickerId !== s.id) {
              StickerBookManager.reorderSticker(store.draggingStickerId, s.id);
            }
          }}
          oncontextmenu={(e) =>
            openCtx(e, [
              ...(store.meta.activePackId !== "all"
                ? [
                    {
                      label: `Remove from Pack ❌`,
                      action: () =>
                        StickerBookManager.removeStickerFromPack(
                          s.id,
                          store.meta.activePackId
                        ),
                    },
                  ]
                : []),
              {
                label: "Delete",
                danger: true,
                action: () => StickerBookManager.removeSticker(s.id),
              },
            ])}
        >
          <img
            src={s.src}
            draggable="false"
            class="max-w-full max-h-24 object-contain filter drop-shadow-sm group-hover:drop-shadow-md"
            alt="sticker"
          />
        </div>
      {/each}
    </div>
  </div>
</div>
