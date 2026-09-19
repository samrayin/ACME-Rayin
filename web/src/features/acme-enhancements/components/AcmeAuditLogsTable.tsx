/**
 * ACME enhancement — audit log table, no Enterprise entitlement required.
 * Built from scratch against MIT-licensed shared components only (DataTable,
 * IOTableCell, Avatar, SettingsTableCard — none of these are under
 * web/src/ee/). Does not import anything from web/src/ee/features/
 * audit-log-viewer/, which is EE-licensed. See acmeAuditLogsRouter.ts for
 * the licensing rationale.
 */
import { DataTable } from "@/src/components/table/data-table";
import { type LangfuseColumnDef } from "@/src/components/table/types";
import { api, type RouterOutputs } from "@/src/utils/api";
import { safeExtract } from "@/src/utils/map-utils";
import { useQueryParams, withDefault, NumberParam } from "use-query-params";
import { ConnectedIOTableCell } from "@/src/components/table/ConnectedIOTableCell";
import { Avatar } from "@/src/components/design-system/Avatar/Avatar";
import { cn } from "@/src/utils/tailwind";
import { useRowHeightLocalStorage } from "@/src/components/table/data-table-row-height-switch";
import { DataTableToolbar } from "@/src/components/table/data-table-toolbar";
import { SettingsTableCard } from "@/src/components/layouts/settings-table-card";

type AcmeAuditLogRow = RouterOutputs["acmeAuditLogs"]["all"]["data"][number];

export function AcmeAuditLogsTable({ projectId }: { projectId: string }) {
  const [paginationState, setPaginationState] = useQueryParams({
    pageIndex: withDefault(NumberParam, 0),
    pageSize: withDefault(NumberParam, 50),
  });

  const auditLogs = api.acmeAuditLogs.all.useQuery({
    projectId,
    page: paginationState.pageIndex,
    limit: paginationState.pageSize,
  });

  const [rowHeight, setRowHeight] = useRowHeightLocalStorage(
    "acmeAuditLogs",
    "s",
  );

  const columns: LangfuseColumnDef<AcmeAuditLogRow>[] = [
    {
      accessorKey: "createdAt",
      header: "Time",
      cell: (row) => (row.getValue() as Date).toLocaleString(),
    },
    {
      accessorKey: "actor",
      header: "Actor",
      headerTooltip: {
        description: "The actor within Langfuse who performed the action.",
      },
      cell: (row) => {
        const actor = row.getValue() as AcmeAuditLogRow["actor"];
        if (actor?.type === "USER") {
          const user = actor.body;
          return (
            <div className="flex items-center gap-2">
              <Avatar
                size="sm"
                displayName={user?.name ?? user?.email ?? "User"}
                src={user?.image ?? undefined}
              />
              <span
                className={cn(
                  "text-sm",
                  !user?.name && "text-muted-foreground",
                )}
              >
                {user?.name ?? user?.email ?? user?.id}
              </span>
            </div>
          );
        }
        if (actor?.type === "API_KEY") {
          return (
            <span className="text-sm">
              {actor.body?.publicKey ?? actor.body?.id}
            </span>
          );
        }
        return null;
      },
    },
    { accessorKey: "resourceType", header: "Resource Type" },
    { accessorKey: "resourceId", header: "Resource ID" },
    { accessorKey: "action", header: "Action" },
    {
      accessorKey: "before",
      header: "Before",
      size: 300,
      cell: (row) => {
        const value = row.getValue() as string | null;
        return value ? (
          <ConnectedIOTableCell data={value} singleLine={rowHeight === "s"} />
        ) : null;
      },
    },
    {
      accessorKey: "after",
      header: "After",
      size: 300,
      cell: (row) => {
        const value = row.getValue() as string | null;
        return value ? (
          <ConnectedIOTableCell data={value} singleLine={rowHeight === "s"} />
        ) : null;
      },
    },
  ];

  return (
    <>
      <DataTableToolbar
        tableName="acmeAuditLogs"
        columns={columns}
        rowHeight={rowHeight}
        setRowHeight={setRowHeight}
        className="px-0"
      />
      <SettingsTableCard>
        <DataTable
          tableName="acmeAuditLogs"
          columns={columns}
          data={
            auditLogs.isPending
              ? { isLoading: true, isError: false }
              : auditLogs.isError
                ? {
                    isLoading: false,
                    isError: true,
                    error: auditLogs.error.message,
                  }
                : {
                    isLoading: false,
                    isError: false,
                    data: safeExtract(auditLogs.data, "data", []),
                  }
          }
          pagination={{
            totalCount: auditLogs.data?.totalCount ?? 0,
            onChange: setPaginationState,
            state: paginationState,
          }}
          rowHeight={rowHeight}
          cellPadding="comfortable"
        />
      </SettingsTableCard>
    </>
  );
}
