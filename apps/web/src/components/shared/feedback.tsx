"use client";
import {
  Alert,
  AlertTitle,
  AlertDescription,
  Button,
  Skeleton,
  Card,
  CardContent,
} from "@repo/ui";
import { AlertCircle, RefreshCw, Inbox } from "lucide-react";
import { errorMessage } from "@repo/web/lib/format";
export function ErrorAlert({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>We couldn't complete that</AlertTitle>
      <AlertDescription>
        {errorMessage(error)}
        {retry && (
          <Button variant="outline" size="sm" onClick={retry}>
            <RefreshCw />
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
export function LoadingCards() {
  return (
    <section
      className="space-y-5"
      aria-label="Loading workspace"
      aria-busy="true"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((item) => (
          <Skeleton key={item} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-12 w-2/5" />
      <Skeleton className="h-72 w-full" />
    </section>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <div className="grid size-12 place-items-center border border-dashed border-primary bg-primary/10">
        <Inbox className="size-5 text-forest" />
      </div>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
export function PixelCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`pixel-frame ${className}`}>
      {children}
      <div aria-hidden="true" className="pixel-edges">
        <div className="corner tl" />
        <div className="corner tr" />
        <div className="corner bl" />
        <div className="corner br" />
        <div className="edge top left" />
        <div className="edge top right" />
        <div className="edge bottom left" />
        <div className="edge bottom right" />
        <div className="edge side l" />
        <div className="edge side r" />
      </div>
    </Card>
  );
}
export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <PixelCard>
      <CardContent className="pt-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
        {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </PixelCard>
  );
}
