"use client";

import { useRef, useEffect } from "react";

// Returns a stable ref to the anonymous device ID stored in localStorage.
// Using a ref (not state) avoids a re-render and the setState-in-effect lint error.
// Effects in hooks run before the calling component's own effects, so the ref
// is always populated before any downstream useEffect that needs it.
export const useDeviceId = () => {
  const ref = useRef("");
  useEffect(() => {
    let id = localStorage.getItem("meta_mind_global_device_id");
    if (!id) {
      id = window.crypto.randomUUID();
      localStorage.setItem("meta_mind_global_device_id", id);
    }
    ref.current = id;
  }, []);
  return ref;
}
