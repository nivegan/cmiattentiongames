"use client";
// SendFeedbackModal.tsx
// Retro modal opened from the "Send Feedback" item in the Clerk UserButton
// dropdown. Collects an NPS-style recommend rating, a combined improvement
// rating, and optional free-text comments, then persists them to user_feedback
// via the saveUserFeedback server action. Toasts (Sonner) report the result.

import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useDeviceId } from "@/hooks/useDeviceId";
import { saveUserFeedback } from "@/utils/saveUserFeedback";
import { StarRating } from "@/components/StarRating";

const SendFeedbackModal = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  const deviceIdRef = useDeviceId();
  const [nps, setNps] = useState(0);
  const [improvement, setImprovement] = useState(0);
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Both ratings are required; comments are optional (the column is nullable).
  const canSubmit = nps > 0 && improvement > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await saveUserFeedback(
        nps,
        improvement,
        comments,
        deviceIdRef.current ?? "",
      );
      if (res.success) {
        toast.success("Thanks for the feedback!");
        // Reset so a reopened modal starts fresh.
        setNps(0);
        setImprovement(0);
        setComments("");
        onClose();
      } else {
        toast.error("Couldn't save your feedback. Please try again.");
      }
    } catch {
      toast.error("Couldn't save your feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#232323]/60 flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative bg-[#FAF6F0] border border-[#232323] shadow-[4px_4px_0px_#232323] font-mono w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#232323]/20 px-5 py-4">
          <h2 className="text-lg font-bold tracking-[0.15em] uppercase text-[#232323]">
            Send Feedback
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-[#232323] cursor-pointer active:translate-x-0.5 active:translate-y-0.5 transition-all"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-6">
          {/* Q1 — NPS / recommend */}
          <div>
            <p className="text-sm font-bold text-[#232323] mb-2">
              How likely are you to recommend Kalari to a friend?
            </p>
            <StarRating value={nps} onChange={setNps} />
          </div>

          {/* Q2 — combined improvement */}
          <div>
            <p className="text-sm font-bold text-[#232323] mb-2">
              How much is this improving your logic, clarity & awareness?
            </p>
            <StarRating value={improvement} onChange={setImprovement} />
          </div>

          {/* Q3 — free text */}
          <div>
            <p className="text-sm font-bold text-[#232323] mb-2">
              Any other comments?
            </p>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Optional…"
              rows={4}
              className="w-full bg-[#FBF8F2] border border-[#232323]/30 px-3 py-2 text-sm text-[#232323] font-mono outline-none focus:border-[#8B2626] resize-none placeholder:text-[#232323]/40"
            />
          </div>

          {/* Submit */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full py-3 bg-[#8B2626] text-[#FAF6F0] font-bold text-sm tracking-[0.15em] uppercase ring-1 ring-inset ring-[#FAF6F0]/60 shadow-[0_3px_0_#5e1919] active:translate-y-0.5 active:shadow-[0_1px_0_#5e1919] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:active:translate-y-0 disabled:active:shadow-[0_3px_0_#5e1919] cursor-pointer"
          >
            {submitting ? "Sending…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
};

export { SendFeedbackModal };
