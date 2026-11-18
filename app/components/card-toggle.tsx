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
    className="ui-button-quiet min-h-9 shrink-0 px-3 text-xs">
    {text}{expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
  </button>;
}
