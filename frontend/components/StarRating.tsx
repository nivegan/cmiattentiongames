"use client";
// StarRating.tsx
// A reusable 1–10 star rating control used by the Send Feedback modal.
// Controlled component: the parent owns the `value`; this only renders + reports
// the chosen star via onChange. Hover state is local (preview highlight only).

import { useState } from "react";
import { Star } from "lucide-react";

const StarRating = ({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) => {
  const [hover, setHover] = useState(0);
  // The number of stars to show as "lit": the hover preview takes priority while
  // the pointer is over the row, otherwise the committed value.
  const active = hover || value;

  return (
    <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`Rate ${n} out of 10`}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          className="p-0.5 cursor-pointer transition-transform active:scale-90"
        >
          <Star
            className={
              n <= active
                ? "w-5 h-5 fill-[#8B2626] text-[#8B2626]"
                : "w-5 h-5 text-[#232323]/30"
            }
            strokeWidth={2}
          />
        </button>
      ))}
    </div>
  );
};

export { StarRating };
