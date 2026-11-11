import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MarketTitle } from "../app/components/market-title";

test("long market titles wrap fully on desktop and are clamped only on mobile", () => {
  const question = "Will the Federal Reserve cut interest rates by 50 basis points or more at its December 2026 meeting?";
  const html = renderToStaticMarkup(createElement(MarketTitle, {
    title: question,
    outcome: "No",
    marketUrl: "https://polymarket.com/event/fed-cut-december-2026",
    language: "zh",
  }));
  assert.ok(html.includes(question), "entire market question is present in HTML");
  assert.match(html, /line-clamp-3 md:line-clamp-none/, "3-line mobile clamp is removed on desktop");
  assert.match(html, /whitespace-normal/, "title can wrap instead of being truncated");
  assert.match(html, /overflow-wrap:anywhere/, "long tokens wrap without breaking the table");
  assert.doesNotMatch(html, /text-overflow:ellipsis|\btruncate\b/, "one-line ellipsis must be removed");
  assert.match(html, /href="https:\/\/polymarket\.com\/event\/fed-cut-december-2026"/);
  assert.match(html, /aria-label="打开 Polymarket 市场/);
  assert.match(html, /持有方向/);
  assert.match(html, />No</, "outcome remains visible");
});

test("market title without a URL still displays full question and outcome", () => {
  const question = "Will a lengthy market resolve according to an official source?";
  const html = renderToStaticMarkup(createElement(MarketTitle, {
    title: question, outcome: "Yes", marketUrl: null, language: "en",
  }));
  assert.ok(html.includes(question));
  assert.match(html, /Outcome/);
  assert.match(html, />Yes</);
  assert.doesNotMatch(html, /target="_blank"/, "non-link markets do not get fake navigation");
});

test("expand text is hidden until actual mobile truncation is measured", () => {
  const html = renderToStaticMarkup(createElement(MarketTitle, {
    title: "Short market", outcome: "Yes", marketUrl: null, language: "en",
  }));
  assert.doesNotMatch(html, /Show full title/);
  assert.doesNotMatch(html, /Show less/);
});
