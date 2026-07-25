// utils/urlBase64ToUint8Array.ts
// Converts the base64url-encoded VAPID public key into the Uint8Array that
// PushManager.subscribe() expects as applicationServerKey. Standard recipe
// from the web-push docs.

const urlBase64ToUint8Array = (base64String: string): Uint8Array<ArrayBuffer> => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  // Explicit ArrayBuffer so the return type is Uint8Array<ArrayBuffer> —
  // PushManager.subscribe's BufferSource rejects the default ArrayBufferLike.
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export { urlBase64ToUint8Array };
