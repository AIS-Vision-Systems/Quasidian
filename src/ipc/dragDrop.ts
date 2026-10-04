// Files dragged from the system onto the window (m51). The webview's
// native drag and drop stays enabled — it is what gives real paths,
// so a dropped file can be copied byte for byte and one that already
// lives in the vault can be recognized — and it reports positions in
// physical pixels, converted here to the CSS pixels the page uses.
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { toClientPoint } from "../lib/attachments";

export type FileDropEvent =
  | { type: "over"; point: { x: number; y: number } }
  | { type: "drop"; point: { x: number; y: number }; paths: string[] }
  | { type: "leave" };

/** Subscribes to file drags over this window; resolves to unsubscribe. */
export function onFileDrop(
  handler: (event: FileDropEvent) => void,
): Promise<() => void> {
  return getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload;
    if (payload.type === "leave") {
      handler({ type: "leave" });
      return;
    }
    const point = toClientPoint(payload.position, window.devicePixelRatio);
    if (payload.type === "drop") {
      handler({ type: "drop", point, paths: payload.paths });
    } else {
      handler({ type: "over", point });
    }
  });
}
