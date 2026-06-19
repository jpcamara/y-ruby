// Convenience codecs for transports that carry binary frames as base64 strings
// (e.g. ActionCable's JSON envelope). Optional -- a binary WebSocket transport
// sends the raw frames directly and never needs these.

/** @param {Uint8Array} bytes */
export const toBase64 = (bytes) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));

/** @param {string} str */
export const fromBase64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
