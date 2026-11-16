"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

export function CardToggle({ expanded, onToggle, controls, label, language }: {
  expanded: boolean;
  onToggle: () => void;
  controls: string;
  label: string;
  language: "zh" | "en";
}) {
  const text = expanded ? (language === "en" ? "Collapse" : "收起") : (language === "en" ? "Expand" : "展开");
  return <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={controls}
    aria-label={`${text} ${label}`}
    className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-3 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
    {text}{expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
  </button>;
}
