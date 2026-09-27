import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type LangfuseColumnDef } from "@/src/components/table/types";
import {
  AcmeLogDetailDialog,
  AcmeLogTable,
  asyncTableData,
  nextCursorPage,
  nextPaginationState,
} from "./AcmeLogTable";

vi.mock("next/router", () => ({
  useRouter: () => ({ query: {}, pathname: "/", asPath: "/" }),
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

type Row = { id: string; action: string };
const columns: LangfuseColumnDef<Row>[] = [
  { accessorKey: "id", header: "Id" },
  { accessorKey: "action", header: "Action" },
];
const rows: Row[] = [
  { id: "r1", action: "created" },
  { id: "r2", action: "revoked" },
];

describe("paging helpers (CHG-2026-084)", () => {
  const page = { pageIndex: 1, pageSize: 50 };

  it("applies a pagination update given as a value or a function", () => {
    expect(nextPaginationState({ pageIndex: 2, pageSize: 50 }, page)).toEqual({
      pageIndex: 2,
      pageSize: 50,
    });
    expect(
      nextPaginationState((old) => ({ ...old, pageIndex: 0 }), page),
    ).toEqual({ pageIndex: 0, pageSize: 50 });
  });

  it("cursor paging: forward pushes the next cursor", () => {
    expect(
      nextCursorPage({
        next: { pageIndex: 2, pageSize: 50 },
        current: page,
        cursors: ["c1"],
        nextCursor: "c2",
      }),
    ).toEqual({ cursors: ["c1", "c2"], pageSize: 50 });
  });

  it("cursor paging: forward without a next cursor stays put", () => {
    expect(
      nextCursorPage({
        next: { pageIndex: 2, pageSize: 50 },
        current: page,
        cursors: ["c1"],
        nextCursor: null,
      }),
    ).toEqual({ cursors: ["c1"], pageSize: 50 });
  });

  it("cursor paging: back drops cursors down to the page asked for", () => {
    expect(
      nextCursorPage({
        next: { pageIndex: 0, pageSize: 50 },
        current: { pageIndex: 2, pageSize: 50 },
        cursors: ["c1", "c2"],
        nextCursor: "c3",
      }),
    ).toEqual({ cursors: [], pageSize: 50 });
    expect(
      nextCursorPage({
        next: { pageIndex: 1, pageSize: 50 },
        current: { pageIndex: 2, pageSize: 50 },
        cursors: ["c1", "c2"],
        nextCursor: "c3",
      }),
    ).toEqual({ cursors: ["c1"], pageSize: 50 });
  });

  it("cursor paging: a new page size starts again from the newest page", () => {
    expect(
      nextCursorPage({
        next: { pageIndex: 1, pageSize: 100 },
        current: page,
        cursors: ["c1"],
        nextCursor: "c2",
      }),
    ).toEqual({ cursors: [], pageSize: 100 });
  });

  it("maps a query's state to the table's data", () => {
    expect(asyncTableData({ isPending: true, isError: false })).toEqual({
      isLoading: true,
      isError: false,
    });
    expect(
      asyncTableData({
        isPending: false,
        isError: true,
        error: { message: "boom" },
      }),
    ).toEqual({ isLoading: false, isError: true, error: "boom" });
    expect(
      asyncTableData({ isPending: false, isError: false, data: rows }),
    ).toEqual({ isLoading: false, isError: false, data: rows });
  });
});

describe("AcmeLogTable (CHG-2026-084)", () => {
  const renderTable = (
    props: Partial<React.ComponentProps<typeof AcmeLogTable<Row>>> = {},
  ) =>
    render(
      <AcmeLogTable<Row>
        tableName="acmeLogTableTest"
        description="What this log holds."
        summary={<span>2 entries</span>}
        actions={<button type="button">Export CSV</button>}
        columns={columns}
        data={{ isLoading: false, isError: false, data: rows }}
        pagination={{
          totalCount: 2,
          state: { pageIndex: 0, pageSize: 50 },
          onChange: vi.fn(),
        }}
        {...props}
      />,
    );

  it("renders the description, toolbar content and rows", () => {
    renderTable();
    expect(screen.getByText("What this log holds.")).toBeInTheDocument();
    expect(screen.getByText("2 entries")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export CSV" }),
    ).toBeInTheDocument();
    expect(screen.getByText("created")).toBeInTheDocument();
    expect(screen.getByText("revoked")).toBeInTheDocument();
  });

  it("opens a row's details on click", () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });
    fireEvent.click(screen.getByText("revoked"));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it("shows the error message when the log fails to load", () => {
    renderTable({
      data: { isLoading: false, isError: true, error: "Not allowed" },
    });
    expect(screen.getByText("Not allowed")).toBeInTheDocument();
  });

  it("shows the empty message when there are no rows", () => {
    renderTable({
      data: { isLoading: false, isError: false, data: [] },
      noResultsMessage: "Nothing recorded yet.",
    });
    expect(screen.getByText("Nothing recorded yet.")).toBeInTheDocument();
  });
});

describe("AcmeLogDetailDialog (CHG-2026-084)", () => {
  it("lists the fields and reveals the JSON on request", () => {
    render(
      <AcmeLogDetailDialog
        open
        onClose={vi.fn()}
        title="Gateway change"
        description="One row of the change record."
        fields={[
          ["Action", "key.create"],
          ["Error", "—"],
        ]}
        json={{ correlationId: "abc-123" }}
      />,
    );
    expect(screen.getByText("Gateway change")).toBeInTheDocument();
    expect(screen.getByText("key.create")).toBeInTheDocument();
    expect(screen.queryByText(/abc-123/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show JSON" }));
    expect(screen.getByText(/abc-123/)).toBeInTheDocument();
  });
});
