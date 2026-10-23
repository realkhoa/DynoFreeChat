/**
 * Text zoom for the chat pane only — the rest of the shell keeps its own size,
 * the way Visual Studio zooms the editor and not the tool windows.
 */
export const ZOOM_STEPS = [80, 90, 100, 110, 125, 150] as const;
export type Zoom = (typeof ZOOM_STEPS)[number];

export const DEFAULT_ZOOM: Zoom = 100;
/** Base log size in px, matching `--log-size`. */
export const BASE_LOG_SIZE = 12.5;

const STORAGE_KEY = "dyno.logzoom";

export function isZoom(value: unknown): value is Zoom {
  return typeof value === "number" && (ZOOM_STEPS as readonly number[]).includes(value);
}

export function loadZoom(storage: Storage | null): Zoom {
  if (storage === null) return DEFAULT_ZOOM;
  try {
    const raw = Number(storage.getItem(STORAGE_KEY));
    return isZoom(raw) ? raw : DEFAULT_ZOOM;
  } catch {
    return DEFAULT_ZOOM;
  }
}

export function saveZoom(storage: Storage | null, zoom: Zoom): Zoom {
  if (storage !== null) {
    try {
      storage.setItem(STORAGE_KEY, String(zoom));
    } catch {
      // Private mode: the zoom simply does not persist.
    }
  }
  return zoom;
}

/** Next step up or down, clamped at the ends. */
export function stepZoom(current: Zoom, direction: 1 | -1): Zoom {
  const index = (ZOOM_STEPS as readonly number[]).indexOf(current);
  const safeIndex = index === -1 ? (ZOOM_STEPS as readonly number[]).indexOf(DEFAULT_ZOOM) : index;
  const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, safeIndex + direction));
  return ZOOM_STEPS[next] as Zoom;
}

/** Font size in px for a zoom step, rounded to a tenth. */
export function zoomToPixels(zoom: Zoom, base = BASE_LOG_SIZE): number {
  return Math.round(base * (zoom / 100) * 10) / 10;
}
