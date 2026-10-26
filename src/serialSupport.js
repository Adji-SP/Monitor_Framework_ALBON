// Feature checks only: never prompt for permission or open a port on mount.
export function serialSupport({ secureContext, serial, policy }) {
  if (!secureContext) return { supported: false, reason: 'USB serial is blocked on this insecure page. Open http://localhost:3000 on the USB-connected computer, or use HTTPS, in desktop Chrome or Edge.' };
  if (typeof serial?.requestPort !== 'function') return { supported: false, reason: 'This browser does not provide Web Serial. Open the dashboard directly in desktop Chrome or Edge on localhost or HTTPS.' };
  try {
    if (policy?.allowsFeature && !policy.allowsFeature('serial')) {
      return { supported: false, reason: 'Serial access is blocked by this page or embedded preview. Open the dashboard in its own Chrome/Edge tab; the site must allow the serial Permissions Policy.' };
    }
  } catch { /* Older browsers may not expose this policy check. */ }
  return { supported: true, reason: null };
}
