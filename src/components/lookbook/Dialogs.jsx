"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { LOOKS } from "./data";

/** Fade-in on mount; `close(after)` fades out, then runs `after` (default onClose). */
function useDialog(onClose) {
  const root = useRef(null);
  const closing = useRef(false);

  useGSAP(() => {
    gsap.fromTo(root.current, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "power1.out" });
  });

  const close = (after) => {
    if (closing.current) return;
    closing.current = true;
    gsap.to(root.current, { opacity: 0, duration: 0.2, ease: "power1.in", onComplete: after ?? onClose });
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return { root, close };
}

function Shell({ ref, label, top, children }) {
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label} className="page-dialog">
      <div className="dialog-top">{top}</div>
      <div className="dialog-scroll">{children}</div>
    </div>
  );
}

export function ProjectDialog({ index, origin, onClose, onCollection }) {
  const look = LOOKS[index];
  const { root, close } = useDialog(onClose);

  return (
    <Shell
      ref={root}
      label={look.title}
      top={
        <>
          <button className="glass-button" onClick={() => close()}>
            {origin === "collection" ? "Back" : "Back To Playground"}
          </button>
          {origin !== "collection" && (
            <button className="glass-button" onClick={() => close(onCollection)}>
              Full Collection
            </button>
          )}
        </>
      }
    >
      <div className="px-5 pb-[25px] pt-[50px] md:px-10">
        <h2 className="m-0 text-[clamp(42px,6vw,86px)] font-light leading-none tracking-[-0.055em]">{look.title}</h2>
      </div>
      <div className="mx-auto max-w-[1280px] px-5 pb-[35px] md:px-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={look.src}
          alt={`${look.title} product artwork`}
          className="block h-[clamp(300px,55svh,620px)] w-full object-contain"
        />
      </div>
      <blockquote className="m-0 mx-auto max-w-[1280px] px-5 pb-[65px] pt-[15px] text-[12px] leading-[1.8] md:px-10">
        {look.story?.map((p, i) => (
          <p key={i} className="max-w-[740px]">
            {p}
          </p>
        ))}
        <p className="mt-6 flex gap-6 text-muted">
          <span>{look.category}</span>
          <span>{look.season}</span>
        </p>
      </blockquote>
    </Shell>
  );
}

export function CollectionDialog({ onClose, onOpen }) {
  const { root, close } = useDialog(onClose);

  return (
    <Shell
      ref={root}
      label="Full collection"
      top={
        <>
          <button className="glass-button" onClick={() => close()}>
            Back To Playground
          </button>
          <span>{LOOKS.length} pieces</span>
        </>
      }
    >
      <div className="mx-auto max-w-[1280px] px-5 pb-[45px] pt-[35px] md:px-10">
        <h2 className="m-0 text-[clamp(42px,6vw,84px)] font-light leading-[0.95] tracking-[-0.055em]">
          Full Collection
        </h2>
      </div>
      <div className="mx-auto grid max-w-[1280px] grid-cols-2 gap-[22px] px-5 pb-[35px] md:grid-cols-3 md:gap-[34px] md:px-10 md:pb-[60px]">
        {LOOKS.map((look, i) => (
          <button key={look.id} className="w-full text-left hover:underline" onClick={() => close(() => onOpen(i))}>
            <figure className="m-0 border-b border-black py-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={look.rain}
                alt={look.title}
                loading="lazy"
                className="block h-[160px] w-full object-contain md:h-[260px]"
              />
            </figure>
            <span className="mt-3 flex justify-between gap-2.5 text-[12px] leading-normal">
              <span>{look.title}</span>
              <span className="text-muted">{look.category}</span>
            </span>
          </button>
        ))}
      </div>
    </Shell>
  );
}
