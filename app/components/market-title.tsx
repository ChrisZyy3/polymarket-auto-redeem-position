"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

interface MarketTitleProps {
  title: string;
  outcome: string;
  marketUrl: string | null;
  language: "zh" | "en";
}

/**
 * Desktop: show the entire market question with natural wrapping.
 * Mobile: clamp at three lines and offer a separate button only if the
 * question actually overflows. The title link always navigates to Polymarket.
 */
export function MarketTitle({ title, outcome, marketUrl, language }: MarketTitleProps) {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);
  const textId = useId();
  const isEnglish = language === "en";

  useEffect(() => {
    const text = textRef.current;
    if (!text) return;

    const checkOverflow = () => {
      // Desktop always shows the full title; the mobile toggle is hidden.
      if (window.matchMedia("(min-width: 768px)").matches || expanded) return;
      const overflowing = text.scrollHeight > text.clientHeight + 1;
      setCanExpand(previous => previous === overflowing ? previous : overflowing);
    };

    checkOverflow();
    // Observing the title element catches horizontal viewport changes and
    // late font layout without attaching one window event handler per row.
    const observer = typeof ResizeObserver === "undefined"
      ? null : new ResizeObserver(checkOverflow);
    observer?.observe(text);
    return () => observer?.disconnect();
  }, [title, expanded]);

  const fullName = `${title} - ${outcome}`;
  const titleContent = (
    <>
      <span
        id={textId}
        ref={textRef}
        className={`min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere] text-sm font-semibold leading-5 text-slate-200 transition-colors group-hover:text-cyan-400 ${
          expanded ? "" : "line-clamp-3 md:line-clamp-none"
        }`}
      >
        {title}
      </span>
      {marketUrl ? (
        <ExternalLink
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500 transition-colors group-hover:text-cyan-400"
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  return (
    <div className="min-w-0 flex-1">
      {marketUrl ? (
        <a
          href={marketUrl}
          target="_blank"
          rel="noreferrer"
          title={fullName}
          aria-label={`${isEnglish ? "Open market on Polymarket" : "打开 Polymarket 市场"}: ${fullName}`}
          className="group flex min-w-0 items-start gap-1.5 rounded-sm outline-none hover:text-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          {titleContent}
        </a>
      ) : (
        <div
          title={fullName}
          className="flex min-w-0 items-start gap-1.5"
        >
          {titleContent}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="hidden rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 md:inline-flex">
          {isEnglish ? "Outcome" : "持有方向"}
        </span>
        <span className="min-w-0 break-words text-xs font-semibold text-cyan-400 [overflow-wrap:anywhere]">
          {outcome}
        </span>
        {canExpand ? (
          <button
            type="button"
            onClick={() => setExpanded(value => !value)}
            aria-expanded={expanded}
            aria-controls={textId}
            className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-500/10 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 md:hidden"
          >
            {expanded ? (
              <>
                {isEnglish ? "Show less" : "收起标题"}
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              </>
            ) : (
              <>
                {isEnglish ? "Show full title" : "展开全文"}
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              </>
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}
