"use client";
// useDeviceId.ts
// Custom React hook that gives any component a stable reference to the
// anonymous device ID stored in localStorage.
//
// WHY DO WE NEED AN ANONYMOUS DEVICE ID?
// Not all users are signed in. To let anonymous users build a game history
// (and check their daily lock), we generate a UUID the first time they visit
// and persist it in localStorage under "meta_mind_global_device_id".
// On future visits, the same UUID is retrieved, keeping their history linked.
//
// WHY A REF (useRef) INSTEAD OF STATE (useState)?
// If we used useState, loading the ID from localStorage would call `setState`,
// which triggers a re-render. That re-render would fire every downstream
// useEffect that depends on the ID — including the daily-lock check — creating
// an unnecessary second call. Using useRef stores the value without causing
// any re-renders.
//
// WHY DOES THIS STILL WORK?
// React guarantees that effects inside a hook run before the effects in the
// component that called the hook. So by the time the game page's own useEffect
// (which reads `deviceIdRef.current`) runs, this hook's useEffect has already
// populated it.

import { useRef, useEffect } from "react";

const useDeviceId = () => {
  // useRef("") creates a mutable box whose .current starts as an empty string.
  // Updating .current never triggers a re-render.
  const ref = useRef("");

  useEffect(() => {
    // localStorage is browser-only — this block must live inside useEffect so
    // it never runs during server-side rendering (where localStorage is undefined).
    let id = localStorage.getItem("meta_mind_global_device_id");
    if (!id) {
      // First visit: generate a new UUID and persist it for future visits.
      id = window.crypto.randomUUID();
      localStorage.setItem("meta_mind_global_device_id", id);
    }
    ref.current = id; // make it available to the calling component's effects
  }, []); // [] = run once on mount, never again

  // Return the ref object itself. Callers read ref.current to get the ID string.
  return ref;
};

export { useDeviceId };
