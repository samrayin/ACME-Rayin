/* eslint-disable boundaries/dependencies */
import { type RowData } from "@tanstack/react-table";

import { Badge } from "@/src/components/ui/badge";
import { Skeleton } from "@/src/components/ui/skeleton";
import {
  createTableColumn,
  type TableColumnOptions,
} from "./utils/createTableColumn";
import { acmeEnvironmentLabel } from "@/src/features/acme-enhancements/utils/acmeBranding";

export function createBadgeTableColumn<TData extends RowData>(
  options: TableColumnOptions<TData, string>,
) {
  return createTableColumn<TData, string>({
    ...options,
    loadingCell: <Skeleton className="h-5 w-16 shrink-0 rounded-sm" />,
    // Every badge column is an environment column: show Langfuse's internal
    // environments as "cairo-…" (display only, CHG-2026-085).
    renderCell: (value) =>
      value ? (
        <Badge
          variant="secondary"
          className="max-w-fit truncate rounded-sm px-1 font-normal"
          title={acmeEnvironmentLabel(value)}
        >
          {acmeEnvironmentLabel(value)}
        </Badge>
      ) : null,
  });
}
