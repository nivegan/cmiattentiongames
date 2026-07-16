// lib/richCopy.tsx
// Renders the weekly summary_copy strings, whose text can contain **bold**
// markdown spans (e.g. the blind-spot band bolds the missed game's name).
// Splitting on the capture group leaves plain text at even indices and the
// bold spans at odd ones. Used by WeeklyReviewModal and the History weekly
// cards — without this, users would see literal asterisks.

import type { ReactNode } from "react";

const renderBoldCopy = (text: string): ReactNode[] =>
  text
    .split(/\*\*(.+?)\*\*/g)
    .map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));

export { renderBoldCopy };
