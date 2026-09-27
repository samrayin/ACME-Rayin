/**
 * ACME (CHG-2026-084, ADR-0018): the one table pattern every tab of the Logs
 * page uses. The shared DataTable, inside a table card, under the shared
 * toolbar (a summary on the left, actions and row height on the right), with
 * the standard pagination footer, and a details panel opened from a row.
 *
 * Built from MIT-licensed shared components only, as AcmeAuditLogsTable was.
 */
import { type ReactNode, useState } from "react";
import { type PaginationState } from "@tanstack/react-table";
import {
  DataTable,
  type AsyncTableData,
} from "@/src/components/table/data-table";
import { DataTableToolbar } from "@/src/components/table/data-table-toolbar";
import {
  type RowHeight,
  useRowHeightLocalStorage,
} from "@/src/components/table/data-table-row-height-switch";
import { type LangfuseColumnDef } from "@/src/components/table/types";
import { SettingsTableCard } from "@/src/components/layouts/settings-table-card";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { JSONView } from "@/src/components/ui/CodeJsonViewer";

/** Page sizes offered by every log. The log procedures cap a page at 100. */
export const ACME_LOG_PAGE_SIZES = [20, 50, 100];
export const ACME_LOG_DEFAULT_PAGE_SIZE = 50;

/** Applies a TanStack pagination update, which may be a value or a function. */
export function nextPaginationState(
  update: PaginationState | ((old: PaginationState) => PaginationState),
  current: PaginationState,
): PaginationState {
  return typeof update === "function" ? update(current) : update;
}

/**
 * Keyset (cursor) paging on the shared footer: `cursors` holds the cursor of
 * each page after the first. Forward pushes the next cursor when there is
 * one, back drops cursors, and a new page size starts again from the newest
 * page, so the page numbers shown stay consistent with the page size.
 */
export function nextCursorPage({
  next,
  current,
  cursors,
  nextCursor,
}: {
  next: PaginationState;
  current: PaginationState;
  cursors: string[];
  nextCursor: string | null | undefined;
}): { cursors: string[]; pageSize: number } {
  if (next.pageSize !== current.pageSize) {
    return { cursors: [], pageSize: next.pageSize };
  }
  if (next.pageIndex > current.pageIndex) {
    return {
      cursors: nextCursor ? [...cursors, nextCursor] : cursors,
      pageSize: current.pageSize,
    };
  }
  if (next.pageIndex < current.pageIndex) {
    return {
      cursors: cursors.slice(0, Math.max(0, next.pageIndex)),
      pageSize: current.pageSize,
    };
  }
  return { cursors, pageSize: current.pageSize };
}

/** The table's data prop from a query's state, rows or an error message. */
export function asyncTableData<T>(query: {
  isPending: boolean;
  isError: boolean;
  error?: { message: string } | null;
  data?: T[];
}): AsyncTableData<T[]> {
  if (query.isPending) return { isLoading: true, isError: false };
  if (query.isError) {
    return {
      isLoading: false,
      isError: true,
      error: query.error?.message ?? "Could not load this log.",
    };
  }
  return { isLoading: false, isError: false, data: query.data ?? [] };
}

export function AcmeLogTable<TData extends object>({
  tableName,
  description,
  filters,
  summary,
  actions,
  notice,
  columns,
  data,
  isFetching,
  pagination,
  onRowClick,
  noResultsMessage,
}: {
  /** Also keys the row height and column widths saved in the browser. */
  tableName: string;
  description?: ReactNode;
  /** A filter row above the toolbar, for logs that have filters. */
  filters?: ReactNode;
  /** Left of the toolbar: counts, a scope switch. */
  summary?: ReactNode;
  /** Right of the toolbar: export. */
  actions?: ReactNode;
  /** Between the toolbar and the table: a warning about the data. */
  notice?: ReactNode;
  /** Or a function of the current row height, for cells that wrap in taller rows. */
  columns:
    | LangfuseColumnDef<TData, unknown>[]
    | ((rowHeight: RowHeight) => LangfuseColumnDef<TData, unknown>[]);
  data: AsyncTableData<TData[]>;
  isFetching?: boolean;
  pagination: React.ComponentProps<
    typeof DataTable<TData, unknown>
  >["pagination"];
  onRowClick?: (row: TData) => void;
  noResultsMessage?: ReactNode;
}) {
  const [rowHeight, setRowHeight] = useRowHeightLocalStorage(tableName, "s");
  const columnDefs =
    typeof columns === "function" ? columns(rowHeight) : columns;

  return (
    <div className="flex flex-col gap-3">
      {description ? (
        <p className="text-muted-foreground text-sm">{description}</p>
      ) : null}
      {filters}
      <DataTableToolbar
        tableName={tableName}
        columns={columnDefs}
        rowHeight={rowHeight}
        setRowHeight={setRowHeight}
        leadingControls={summary}
        actionButtons={actions}
        className="px-0"
      />
      {notice}
      <SettingsTableCard>
        <DataTable
          tableName={tableName}
          columns={columnDefs}
          // DataTable draws loading rows whenever it has no rows, errors
          // included; an error is shown as an empty table with its message.
          data={
            data.isError ? { isLoading: false, isError: false, data: [] } : data
          }
          isFetching={isFetching}
          pagination={pagination}
          rowHeight={rowHeight}
          cellPadding="comfortable"
          onRowClick={onRowClick ? (row) => onRowClick(row) : undefined}
          noResultsMessage={
            data.isError ? (
              <span className="text-dark-red text-sm">{data.error}</span>
            ) : (
              noResultsMessage
            )
          }
        />
      </SettingsTableCard>
    </div>
  );
}

/** One labelled line of a details panel. */
export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 border-b py-2 text-sm last:border-b-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

/** The details panel a log row opens: labelled fields, then the raw JSON. */
export function AcmeLogDetailDialog({
  open,
  onClose,
  title,
  description,
  fields,
  json,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  fields: [label: string, value: ReactNode][];
  json?: unknown;
}) {
  const [showJson, setShowJson] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col">
            {fields.map(([label, value]) => (
              <DetailRow key={label} label={label}>
                {value}
              </DetailRow>
            ))}
            {json !== undefined ? (
              <>
                <div className="pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowJson((v) => !v)}
                  >
                    {showJson ? "Hide JSON" : "Show JSON"}
                  </Button>
                </div>
                {showJson ? (
                  <div className="pt-2">
                    <JSONView json={json} />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
