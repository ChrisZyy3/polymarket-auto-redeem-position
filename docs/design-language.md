# Dashboard visual language (V2.3 UI refresh)

Inspired by the restraint of Magic UI Bento Grid and Magic Card, not by their attention-heavy animation effects.

## Goals
- One primary holdings/SELL table. Navy surfaces, cyan for analysis, indigo for deliberate trade actions.
- Green only after CLOB live-order verification. Amber for uncertain states.
- Compact metrics and history cards, clear focus rings, readable touch targets.
- Respect prefers-reduced-motion. No continuous glow, beam or animated live prices.

## Shared CSS primitives
Defined in app/globals.css: ui-hero, ui-surface, ui-inset, ui-stat-card, ui-input,
ui-button-primary, ui-button-secondary, ui-button-quiet, ui-button-trade,
ui-button-trade-outline, ui-segmented, ui-pill, ui-table, ui-dialog, ui-progress-rail.

## Safety and non-goals
- No changes to CLOB signatures, Safe derivation, GTD/Post-Only, approvals or balance checks.
- ClobAuth remains a manual gas-free authentication step; credentials stay in page memory.
- Do not add animated numbers, canvas particles, large third-party UI libraries or low-contrast statuses.
