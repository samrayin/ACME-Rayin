/**
 * ACME (CHG-2026-150, ADR-0026 §12.5): how the EYEON rail and the docked
 * sidebar beside it share the window.
 *
 * The rail is either compact (an icon in a circle with its name under it) or
 * expanded (each icon with its name beside it on one line). Whichever it is,
 * it hands its width to the sidebar beside it as `--eyeon-rail-width`, with a
 * sibling selector on sidebar.tsx's structure (`[data-side=left]`), and
 * everything that depends on the rail's width reads that one variable:
 * - the sidebar's fixed panel, fixed to the window's left edge, sits that far
 *   from it (CHG-2026-135);
 * - the sidebar's header row, which holds the logo, reaches back over the
 *   rail's own top row by the same width, so the logo row is one header
 *   across the rail and the page list (AppSidebar).
 * Without the rail (its flag off, on a phone, outside a project) the variable
 * is not set, so both are as upstream has them.
 *
 * Class strings, written out in full for Tailwind to find.
 */

/**
 * The rail's own width, and the same width handed to the sidebar.
 *
 * ACME (CHG-2026-153): in a window 700px tall or less the list
 * can overflow, and the browser's scrollbar then takes a lane out of the
 * names' room ("Governanc|e"). The rail is wider there by the scrollbar's lane
 * (1rem, `scrollbar-rail` in globals.css), so the names keep the room they
 * have in a taller window, where there is no scrollbar and the width is as it
 * was: about 79px, against the longest name's 71px at text-xs.
 */
export const EYEON_RAIL_WIDTH_CLASS = {
  compact:
    "w-22 [&~[data-side=left]]:[--eyeon-rail-width:5.5rem] [@media(max-height:700px)]:w-26 [@media(max-height:700px)]:[&~[data-side=left]]:[--eyeon-rail-width:6.5rem]",
  // "Governance Controls" and "Prompt Management" fit on one line beside
  // their icons in the system fonts (about 125px at text-sm); longer text
  // is cut short with an ellipsis rather than wrapping.
  expanded:
    "w-52 [&~[data-side=left]]:[--eyeon-rail-width:13rem] [@media(max-height:700px)]:w-56 [@media(max-height:700px)]:[&~[data-side=left]]:[--eyeon-rail-width:14rem]",
} as const;

/**
 * The sidebar's fixed panel, moved right by the rail's width. Its own
 * transition (sidebar.tsx: left, right and width, 200ms, linear) carries it
 * along as the rail widens or narrows; the rail's width uses the same timing.
 */
export const EYEON_RAIL_SIDEBAR_OFFSET_CLASS =
  "[&~[data-side=left]>.fixed]:left-(--eyeon-rail-width)";

/** The rail's width change, timed as sidebar.tsx's own transitions are. */
export const EYEON_RAIL_TRANSITION_CLASS =
  "transition-[width] duration-200 ease-linear";

/**
 * For the sidebar's header row (AppSidebar). Beside the rail, the row starts
 * at the rail's left edge, so the logo does too and the top row reads as one
 * header with no divider in it. It moves with the same timing as the panel,
 * so the logo stays where it is while the rail widens or narrows. With the
 * sidebar collapsed to icons the row keeps to the sidebar, and upstream's
 * icon stays centred above the sidebar's own icons. Without the rail the
 * margin is zero.
 */
export const EYEON_RAIL_HEADER_ROW_CLASS =
  "ml-[calc(var(--eyeon-rail-width,0px)*-1)] transition-[margin-left] duration-200 ease-linear group-data-[collapsible=icon]:ml-0";
