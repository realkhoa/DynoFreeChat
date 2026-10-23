/**
 * Browser-visible unread badges: the favicon counter (works in every tab-based
 * browser) and the App Badging API (taskbar / dock, for installed PWAs).
 */
export function badgeLabel(count: number): string {
  if (Number.isNaN(count)) return "";
  if (!Number.isFinite(count)) return count > 0 ? "99+" : "";
  if (count <= 0) return "";
  if (count > 99) return "99+";
  return String(Math.floor(count));
}

const BASE = { size: 64, bg: "#2d2d30", accent: "#007acc", dim: "#9d9d9d", badge: "#d13438" };

function paintFavicon(label: string): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = BASE.size;
  canvas.height = BASE.size;

  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;

  // Base icon: same shape as the inline SVG in index.html.
  ctx.fillStyle = BASE.bg;
  ctx.fillRect(0, 0, BASE.size, BASE.size);

  ctx.strokeStyle = BASE.accent;
  ctx.lineWidth = 5;
  ctx.strokeRect(16, 14, 20, 36);

  ctx.strokeStyle = BASE.dim;
  ctx.beginPath();
  ctx.moveTo(44, 24);
  ctx.lineTo(44, 40);
  ctx.stroke();

  if (label.length === 0) return canvas.toDataURL("image/png");

  // Badge: filled circle with the count, bottom-right so it clears the icon.
  const radius = label.length > 2 ? 20 : 18;
  const cx = BASE.size - radius - 2;
  const cy = BASE.size - radius - 2;

  ctx.fillStyle = BASE.badge;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${label.length > 2 ? 22 : 26}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy + 1);

  return canvas.toDataURL("image/png");
}

/** Draws the unread count onto the tab icon. `0` restores the plain icon. */
export function applyFaviconBadge(count: number, doc: Document = document): void {
  const label = badgeLabel(count);
  const href = paintFavicon(label);
  if (href === null) return;

  let link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link === null) {
    link = doc.createElement("link");
    link.rel = "icon";
    doc.head.append(link);
  }
  link.href = href;
}

interface BadgingApi {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/** Taskbar/dock badge where the browser supports it; silent no-op elsewhere. */
export function applyAppBadge(count: number, nav: BadgingApi | null = null): void {
  const target = nav ?? (typeof navigator === "undefined" ? null : (navigator as unknown as BadgingApi));
  if (target === null) return;

  try {
    if (count > 0) void target.setAppBadge?.(count)?.catch(() => undefined);
    else void target.clearAppBadge?.()?.catch(() => undefined);
  } catch {
    // Unsupported or blocked: the favicon badge still carries the count.
  }
}

/** Everything the browser can show about unread messages. */
export function applyBrowserBadges(count: number): void {
  applyFaviconBadge(count);
  applyAppBadge(count);
}
