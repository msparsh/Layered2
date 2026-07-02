<script lang="ts">
  import { onMount } from "svelte";
  import {
    store,
    StickerBookManager,
    initContextMenuListener
  } from "./store.svelte";

  import StickerDrawer from "./StickerDrawer.svelte";
  import Canvas from "./Canvas.svelte";

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

  const globalPaste = (e: ClipboardEvent) => {
    const f = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith("image/"))?.getAsFile();
    if (f) {
      e.preventDefault();
      const r = new FileReader();
      r.onload = (ev) => {
        const b64 = ev.target?.result as string;
        StickerBookManager.saveSticker(b64);
        if (!store.stickerDrawerOpen) {
          store.spawnImage(b64, store.pointerX || window.innerWidth / 2, store.pointerY || window.innerHeight / 2);
        }
      };
      r.readAsDataURL(f);
    }
  };

  onMount(() => {
    let d = false;
    (async () => {
      await store.init();
      if (d) return;
      StickerBookManager.render();
      store.restoreActiveImages();
    })();
    
    initContextMenuListener();

    window.addEventListener("beforeunload", () => {
      store.requestSave.flush();
    });
    return () => (d = true);
  });
</script>

<svelte:window
  onpointermove={(e) => {
    store.pointerX = e.clientX;
    store.pointerY = e.clientY;
  }}
  onkeydown={globalKey}
  onpointerup={() => store.draggingStickerId = null}
  onpaste={globalPaste}
/>

<StickerDrawer />
<Canvas />

<style>
:global(body){overflow-x:hidden;overflow-y:auto;background-color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
:global(::-webkit-scrollbar){display:none}
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