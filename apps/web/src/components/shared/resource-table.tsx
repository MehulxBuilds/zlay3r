"use client";
import { useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui";
import { Loader2, Search } from "lucide-react";
import { EmptyState, ErrorAlert, LoadingCards } from "./feedback";
export interface Column<T> {
  label: string;
  cell(row: T): ReactNode;
}
export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={`status-badge status-${status.toLowerCase()}`}
    >
      <span className="size-1.5 bg-current" />
      {status.toLowerCase().replaceAll("_", " ")}
    </Badge>
  );
}
export function ResourceTable<T extends { id: string }>({
  rows,
  columns,
  actions,
  loading,
  error,
  retry,
  emptyTitle,
  emptyDescription,
  more,
  loadingMore,
  onMore,
}: {
  rows: T[];
  columns: Column<T>[];
  actions?: (row: T) => ReactNode;
  loading?: boolean;
  error?: unknown;
  retry?: () => void;
  emptyTitle: string;
  emptyDescription: string;
  more?: boolean;
  loadingMore?: boolean;
  onMore?: () => void;
}) {
  const [search, setSearch] = useState("");
  if (loading) return <LoadingCards />;
  if (error && !rows.length) return <ErrorAlert error={error} retry={retry} />;
  const filtered = rows.filter((row) =>
    JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-4">
      <ErrorAlert error={error} retry={retry} />
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
        <Input
          aria-label="Search loaded records"
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search loaded records..."
        />
      </div>
      <Card className="overflow-hidden py-0 shadow-none">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <EmptyState
              title={search ? "No matching records" : emptyTitle}
              description={
                search
                  ? "Try a different search or load more records."
                  : emptyDescription
              }
            />
          ) : (
            <>
              <div className="divide-y md:hidden">
                {filtered.map((row) => (
                  <article key={row.id} className="space-y-4 p-5">
                    <div className="min-w-0 truncate">
                      {columns[0]?.cell(row)}
                    </div>
                    <dl className="grid grid-cols-2 gap-4">
                      {columns.slice(1).map((column) => (
                        <div key={column.label} className="min-w-0">
                          <dt className="mb-2 text-xs text-muted-foreground">
                            {column.label}
                          </dt>
                          <dd className="truncate text-sm">
                            {column.cell(row)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {actions && (
                      <div className="flex justify-end gap-2 border-t pt-3">
                        {actions(row)}
                      </div>
                    )}
                  </article>
                ))}
              </div>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {columns.map((column) => (
                        <TableHead
                          key={column.label}
                          className="h-12 px-5 text-xs"
                        >
                          {column.label}
                        </TableHead>
                      ))}
                      {actions && (
                        <TableHead className="pr-5 text-right">
                          Actions
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((row) => (
                      <TableRow key={row.id}>
                        {columns.map((column) => (
                          <TableCell
                            key={column.label}
                            className="max-w-72 px-5 py-5"
                          >
                            <div className="truncate">{column.cell(row)}</div>
                          </TableCell>
                        ))}
                        {actions && (
                          <TableCell className="pr-5">
                            <div className="flex justify-end gap-1">
                              {actions(row)}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      {more && (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loadingMore} onClick={onMore}>
            {loadingMore && <Loader2 className="animate-spin" />}Load more
          </Button>
        </div>
      )}
    </div>
  );
}
