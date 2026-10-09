import { useState } from "react";
import { browserLayoutStorage } from "@/src/features/acme-enhancements/utils/eyeonHomeLayout";
import {
  clearCommandLayout,
  commandLayoutKey,
  defaultCommandLayout,
  readCommandLayout,
  writeCommandLayout,
  type CommandLayout,
} from "@/src/features/acme-enhancements/utils/eyeonCommandLayout";

function load(key: string | null): CommandLayout {
  return key === null
    ? defaultCommandLayout()
    : readCommandLayout(browserLayoutStorage(), key);
}

/**
 * ACME (CHG-2026-147, ADR-0030): this person's arrangement of the command
 * centre for this project, kept in this browser's localStorage and never
 * sent to the server. As useEyeonHomeLayout (ADR-0028): the key's own
 * arrangement is read whenever the person or project changes, and storage is
 * written only when the person changes something.
 */
export function useEyeonCommandLayout(
  projectId: string,
  userId: string | undefined,
) {
  const key = userId ? commandLayoutKey(userId, projectId) : null;
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
    save: (layout: CommandLayout) => {
      const kept =
        key !== null && writeCommandLayout(browserLayoutStorage(), key, layout);
      setState({ key, layout, storageRefused: !kept });
    },
    reset: () => {
      if (key !== null) clearCommandLayout(browserLayoutStorage(), key);
      setState({
        key,
        layout: defaultCommandLayout(),
        storageRefused: false,
      });
    },
  };
}
