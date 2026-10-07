import { useState } from "react";
import {
  browserLayoutStorage,
  clearEyeonHomeLayout,
  defaultEyeonHomeLayout,
  eyeonHomeLayoutKey,
  readEyeonHomeLayout,
  writeEyeonHomeLayout,
  type EyeonHomeLayout,
} from "@/src/features/acme-enhancements/utils/eyeonHomeLayout";

function load(key: string | null): EyeonHomeLayout {
  return key === null
    ? defaultEyeonHomeLayout()
    : readEyeonHomeLayout(browserLayoutStorage(), key);
}

/**
 * ACME (CHG-2026-136, ADR-0028): this person's arrangement of EYEON Home for
 * this project, kept in this browser's localStorage and never sent to the
 * server (the personal theme's precedent, CHG-2026-074).
 *
 * Not the shared useLocalStorage hook: that one keeps the value of the key it
 * mounted with when the key changes (the page stays mounted when moving
 * between projects) and writes on every mount. Here the key's own
 * arrangement is read whenever the person or project changes, and storage is
 * written only when the person changes something, from the event handler.
 */
export function useEyeonHomeLayout(
  projectId: string,
  userId: string | undefined,
) {
  const key = userId ? eyeonHomeLayoutKey(userId, projectId) : null;
  const [state, setState] = useState(() => ({
    key,
    layout: load(key),
    storageRefused: false,
  }));

  let current = state;
  if (state.key !== key) {
    // Another person or project: show its own arrangement.
    current = { key, layout: load(key), storageRefused: false };
    setState(current);
  }

  return {
    layout: current.layout,
    /** True after this browser refused to keep a change. */
    storageRefused: current.storageRefused,
    save: (layout: EyeonHomeLayout) => {
      const kept =
        key !== null &&
        writeEyeonHomeLayout(browserLayoutStorage(), key, layout);
      setState({ key, layout, storageRefused: !kept });
    },
    reset: () => {
      if (key !== null) clearEyeonHomeLayout(browserLayoutStorage(), key);
      setState({
        key,
        layout: defaultEyeonHomeLayout(),
        storageRefused: false,
      });
    },
  };
}
