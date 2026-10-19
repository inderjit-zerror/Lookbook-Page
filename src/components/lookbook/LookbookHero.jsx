"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import GarmentLayer from "./GarmentLayer";
import Playground from "./Playground";
import { CollectionDialog, ProjectDialog } from "./Dialogs";
import { IDENTITY, LOCATIONS, LOOKS, NAME_LINES } from "./data";

gsap.registerPlugin(useGSAP);

const RAIN_ORDER = LOOKS.map((_, i) => i);

/** Decodes a garment image into a GPU texture + an alpha mask for picking. */
function loadAsset(look) {
  const image = new Image();
  image.decoding = "async";
  // `load` (not decode()) — decode() can stall forever in background tabs
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });
  image.src = look.rain ?? look.src;
  return loaded.then(() => {
    const maskW = Math.min(256, image.naturalWidth);
    const maskH = Math.max(1, Math.round((maskW * image.naturalHeight) / image.naturalWidth));
    const c = document.createElement("canvas");
    c.width = maskW;
    c.height = maskH;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(image, 0, 0, maskW, maskH);

    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.premultiplyAlpha = true;
    texture.anisotropy = 8;
    texture.needsUpdate = true;

    return {
      texture,
      aspect: image.naturalHeight / image.naturalWidth,
      alpha: g.getImageData(0, 0, maskW, maskH).data,
      maskW,
      maskH,
    };
  });
}

function Clocks() {
  const [now, setNow] = useState(null);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    const first = setTimeout(() => setNow(new Date()), 0);
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
  }, []);

  return LOCATIONS.map((loc) => (
    <div key={loc.label} className="flex gap-2.5 whitespace-nowrap" title={loc.active ? "Here now" : "Other location"}>
      <span aria-hidden className={`beacon mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${loc.active ? "" : "away"}`} />
      <div className="text-left">
        <span className="max-[650px]:hidden">{loc.label}</span>
        <span className="hidden max-[650px]:inline">{loc.short}</span>
        <br className="max-[650px]:hidden" />
        <span className="tabular-nums text-muted max-[650px]:hidden">
          {now
            ? new Intl.DateTimeFormat("en-GB", {
                timeZone: loc.timeZone,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }).format(now)
            : "--:--:--"}
        </span>
      </div>
    </div>
  ));
}

export default function LookbookHero() {
  const stageRef = useRef(null);
  const worldRef = useRef(null);
  const nameRef = useRef(null);
  const dropRef = useRef(null);
  const dropActionRef = useRef(null);
  const dropTitleRef = useRef(null);
  const guideRef = useRef(null);

  const playground = useRef(null);
  const assets = useRef([]);
  const pointerStart = useRef(null);
  const dialogOpen = useRef(false);
  const hint = useRef({ shown: false, interacted: false, lastCheck: 0, timer: 0, reduced: false });

  const [nameReady, setNameReady] = useState(false);
  const [dialog, setDialog] = useState(null);

  /* ------------------------------------------- DOM helpers (no re-render) */
  const hideDrop = () => {
    dropRef.current?.classList.remove("visible", "ready");
    stageRef.current?.classList.remove("is-dragging");
  };

  const hideHint = () => {
    if (guideRef.current) guideRef.current.hidden = true;
    clearTimeout(hint.current.timer);
  };
  const dismissHint = () => {
    hint.current.interacted = true;
    hideHint();
  };
  const resetHint = () => {
    hideHint();
    hint.current.shown = false;
  };

  /* ------------------------------------------------- setup & measuring */
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    hint.current.reduced = reduced;
    const pg = new Playground({ reduced });
    playground.current = pg;
    assets.current = LOOKS.map(loadAsset);
    assets.current.forEach((p) => p.catch(() => {}));

    // size the name so its widest line spans the stage, then put the floor on its baseline
    const measure = () => {
      const stage = stageRef.current;
      const name = nameRef.current;
      if (!stage || !name) return;
      const W = Math.round(stage.clientWidth);
      const H = Math.round(stage.clientHeight);
      let size = W * 0.23;
      name.style.fontSize = `${size}px`;
      const widest = Math.max(...[...name.children].map((s) => s.getBoundingClientRect().width));
      size *= (W - (W < 650 ? 30 : 56)) / widest;
      size = Math.min(size, (H * 0.5) / 1.62);
      name.style.fontSize = `${size}px`;

      const cs = getComputedStyle(name);
      const g = document.createElement("canvas").getContext("2d");
      g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = g.measureText(name.lastElementChild.textContent);
      const line = parseFloat(cs.lineHeight);
      const box = name.getBoundingClientRect();
      const baseline =
        box.bottom - line + (line - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 + m.fontBoundingBoxAscent;
      const surface = Math.min(H - 24, baseline + m.actualBoundingBoxDescent - stage.getBoundingClientRect().top);
      pg.resize(W, H, surface);
    };

    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      measure();
      setNameReady(true);
    });

    let timer;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        pg.release();
        hideDrop();
        hideHint();
        measure();
      }, 160);
    };
    window.addEventListener("resize", onResize);

    // touch: only garments capture the finger, empty space still scrolls the page
    const world = worldRef.current;
    const onTouchStart = (e) => {
      const t = e.touches[0];
      const r = world.getBoundingClientRect();
      if (pg.hitTest(t.clientX - r.left, t.clientY - r.top)) e.preventDefault();
    };
    world.addEventListener("touchstart", onTouchStart, { passive: false });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      world.removeEventListener("touchstart", onTouchStart);
      pg.dispose();
    };
  }, []);

  /* ------------------------------------------------------------ rain */
  const rain = () => {
    resetHint();
    hideDrop();
    worldRef.current?.classList.remove("grabbing");
    playground.current?.rain(RAIN_ORDER, (i) => assets.current[i]);
  };

  // the name settles in first, then the garments start to fall
  useGSAP(
    () => {
      if (!nameReady) return;
      if (hint.current.reduced) return rain();
      gsap.fromTo(
        nameRef.current.children,
        { opacity: 0, filter: "blur(4px)", y: -9 },
        { opacity: 1, filter: "blur(0px)", y: 0, duration: 0.45, ease: "power1.out", onComplete: rain }
      );
    },
    { dependencies: [nameReady] }
  );

  /* ------------------------------------------------------- drop zone */
  const relPoint = (e) => {
    const r = worldRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const overDrop = (p) => {
    const r = dropRef.current.getBoundingClientRect();
    const c = worldRef.current.getBoundingClientRect();
    return p.x >= r.left - c.left && p.x <= r.right - c.left && p.y >= r.top - c.top && p.y <= r.bottom - c.top;
  };

  const updateDrop = (p) => {
    const ready = overDrop(p);
    dropRef.current.classList.toggle("ready", ready);
    dropActionRef.current.textContent = ready ? "Release to view project" : "Drop to view project";
  };

  const release = () => {
    playground.current?.release();
    hideDrop();
    worldRef.current?.classList.remove("grabbing");
  };

  /* ---------------------------------------------------------- pointer */
  const onPointerDown = (e) => {
    dismissHint();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const pg = playground.current;
    if (!pg || dialogOpen.current) return;
    const p = relPoint(e);
    const fabric = pg.pick(p.x, p.y);
    pointerStart.current = { ...p, moved: false };
    if (!fabric) return;
    worldRef.current.setPointerCapture(e.pointerId);
    worldRef.current.classList.add("grabbing");
    dropTitleRef.current.textContent = LOOKS[fabric.index].title;
    dropRef.current.classList.add("visible");
    stageRef.current.classList.add("is-dragging");
    updateDrop(p);
  };

  const onPointerMove = (e) => {
    const pg = playground.current;
    if (!pg || (!pg.grab && !pointerStart.current)) return;
    const p = relPoint(e);
    const s = pointerStart.current;
    if (s && Math.hypot(p.x - s.x, p.y - s.y) > 7) s.moved = true;
    if (pg.grab) {
      pg.moveTo(p.x, p.y);
      updateDrop(p);
    }
  };

  const onPointerUp = (e) => {
    const pg = playground.current;
    if (!pg || (!pg.grab && !pointerStart.current)) return;
    const p = relPoint(e);
    const project = pg.grab && pointerStart.current?.moved && overDrop(p) ? pg.grab.fabric.index : null;
    release();
    pointerStart.current = null;
    if (project !== null) openProject(project);
  };

  const onPointerCancel = () => {
    release();
    pointerStart.current = null;
  };

  /* ---------------------------------------------------------- dialogs */
  const openProject = (index, origin = "playground") => setDialog({ type: "project", index, origin });
  const closeDialog = () => setDialog(null);

  useEffect(() => {
    dialogOpen.current = !!dialog;
    if (playground.current) playground.current.paused = !!dialog;
    document.documentElement.style.overflow = dialog ? "hidden" : "";
    if (dialog) hideHint();
  }, [dialog]);

  /* ------------------------------------------------------ pickup hint */
  // once the pile settles, a hand shows how to carry a piece to the drop box
  const updateHint = (time) => {
    const h = hint.current;
    const pg = playground.current;
    if (!pg || !guideRef.current) return;
    if (dialogOpen.current || pg.grab) return hideHint();
    if (h.shown || h.interacted || h.reduced || window.scrollY > 25 || time - h.lastCheck < 300) return;
    h.lastCheck = time;
    if (pg.fabrics.length < LOOKS.length || pg.active) return;

    let best = null;
    for (const f of pg.fabrics) {
      const b = f.bounds();
      if (b.bottom < 0 || b.top > pg.H) continue;
      const d = Math.abs((b.left + b.right) / 2 - pg.W / 2);
      if (!best || d < best.d) best = { f, b, d };
    }
    if (!best) return;
    const { f, b } = best;
    const cx = (b.left + b.right) / 2;
    const cy = b.top + (b.bottom - b.top) * 0.35;
    let origin = null;
    for (let i = 0; i < f.n; i++) {
      if (!f.solid[i]) continue;
      const x = f.x[i], y = f.projectedY(i);
      const d = Math.hypot(x - cx, y - cy);
      if (!origin || d < origin.d) origin = { x, y, d };
    }
    if (!origin) return;

    const frame = dropRef.current.getBoundingClientRect();
    const box = stageRef.current.getBoundingClientRect();
    const tx = frame.left + frame.width / 2 - box.left;
    const ty = frame.top + frame.height / 2 - box.top;
    const curve = `M ${origin.x} ${origin.y} Q ${(origin.x + tx) / 2 + 40} ${Math.min(origin.y, ty) - 32} ${tx} ${ty}`;

    const guide = guideRef.current;
    const trail = guide.querySelector("svg");
    trail.setAttribute("viewBox", `0 0 ${pg.W} ${pg.H}`);
    trail.querySelector("path").setAttribute("d", curve);
    guide.querySelector(".guide-hand").style.offsetPath = `path('${curve}')`;
    h.shown = true;
    guide.hidden = false;
    h.timer = setTimeout(hideHint, 4800);
  };

  const scrollOn = () => {
    dismissHint();
    const next = stageRef.current.nextElementSibling;
    if (next) next.scrollIntoView({ behavior: "smooth", block: "start" });
    else window.scrollBy({ top: window.innerHeight, behavior: "smooth" });
  };

  /* ------------------------------------------------------------ view */
  return (
    <>
      <section
        ref={stageRef}
        className="relative h-svh min-h-[540px] overflow-hidden bg-paper text-ink max-[650px]:min-h-[500px]"
      >
        <header className="absolute inset-x-[38px] top-[34px] z-[4] grid grid-cols-3 text-[12px] leading-[1.4] max-[650px]:inset-x-[22px] max-[650px]:top-[22px] max-[650px]:grid-cols-[1fr_auto] max-[650px]:gap-y-5 max-[650px]:text-[11.5px]">
          <div className="pr-4 max-[650px]:pr-3">
            {IDENTITY.map((line, i) => (
              <span key={i}>
                {line}
                {i < IDENTITY.length - 1 && <br />}
              </span>
            ))}
          </div>
          <nav className="justify-self-center max-[650px]:col-start-2 max-[650px]:row-start-1 max-[650px]:justify-self-end">
            <button onClick={() => setDialog({ type: "collection" })} className="hover:underline">
              Full Collection
            </button>
          </nav>
          <div className="flex gap-6 justify-self-end max-[650px]:col-span-2 max-[650px]:row-start-2 max-[650px]:gap-4">
            <Clocks />
          </div>
        </header>

        <div className="play-note pointer-events-none absolute left-1/2 top-[28%] z-[4] flex w-max max-w-[calc(100%-40px)] -translate-x-1/2 -translate-y-1/2 items-center gap-[15px] text-[12px] leading-[1.6] max-[650px]:top-[40%] max-[650px]:text-[11.5px]">
          <button
            onClick={rain}
            aria-label="Replay falling garments"
            className="pointer-events-auto relative grid min-h-11 min-w-11 place-items-center"
          >
            <span aria-hidden className="block text-[28px] leading-none max-[650px]:text-[24px]">
              ↻
            </span>
          </button>
          <p className="m-0">Pick up a piece to view the full look.</p>
        </div>

        <div
          ref={dropRef}
          aria-hidden="true"
          className="drop-zone pointer-events-none absolute left-1/2 top-[28%] z-[3] flex h-[170px] w-[280px] flex-col items-center justify-center gap-[5px] text-[12px] max-[650px]:top-[40%] max-[650px]:h-[145px] max-[650px]:w-[220px]"
        >
          <span ref={dropActionRef}>Drop to view project</span>
          <span ref={dropTitleRef} />
        </div>

        <h1
          ref={nameRef}
          className={`hero-name pointer-events-none absolute bottom-[45px] left-[28px] m-0 font-name text-[18vw] font-normal leading-[0.81] tracking-[-0.045em] [font-synthesis:none] max-[650px]:bottom-[27px] max-[650px]:left-[15px] ${
            nameReady ? "ready" : ""
          }`}
        >
          {NAME_LINES.map((line) => (
            <span key={line} className="block w-max">
              {line}
            </span>
          ))}
        </h1>

        <button
          onClick={scrollOn}
          aria-label="Scroll down"
          className="scroll-cue absolute bottom-2 left-1/2 z-[4] grid h-8 w-11 -translate-x-1/2 place-items-center text-muted"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="h-[22px] w-[22px]">
            <path d="m6 8 6 6 6-6" />
            <path d="m6 13 6 6 6-6" />
          </svg>
        </button>

        <div
          ref={worldRef}
          className="world absolute inset-0 z-[2]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <Canvas
            flat
            dpr={[1, 2]}
            gl={{ antialias: true, alpha: true, premultipliedAlpha: true }}
            style={{ position: "absolute", inset: 0 }}
          >
            <GarmentLayer playground={playground} onFrame={updateHint} />
          </Canvas>
        </div>

        <div ref={guideRef} hidden aria-hidden="true" className="pointer-events-none absolute inset-0 z-[4] overflow-hidden">
          <svg className="guide-trail absolute inset-0 h-full w-full" fill="none">
            <path stroke="#929292" strokeWidth="1" strokeDasharray="2 3" strokeLinecap="round" />
          </svg>
          <span className="guide-hand absolute left-0 top-0 h-4 w-4 text-muted">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-full w-full"
            >
              <path d="M8 13V4a2 2 0 0 1 4 0v7M12 9a2 2 0 0 1 4 0v3M16 10a2 2 0 0 1 4 0v6c0 4-2 6-6 6h-2c-2 0-3-1-4-3l-4-6a2 2 0 0 1 3-2l1 2" />
            </svg>
          </span>
        </div>
      </section>

      {dialog?.type === "project" && (
        <ProjectDialog
          key={dialog.index}
          index={dialog.index}
          origin={dialog.origin}
          onClose={() => (dialog.origin === "collection" ? setDialog({ type: "collection" }) : closeDialog())}
          onCollection={() => setDialog({ type: "collection" })}
        />
      )}
      {dialog?.type === "collection" && (
        <CollectionDialog onClose={closeDialog} onOpen={(i) => openProject(i, "collection")} />
      )}
    </>
  );
}
