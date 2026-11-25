"use client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@repo/ui";
export function DetailSheet({
  title,
  description,
  open,
  close,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  close(): void;
  children: React.ReactNode;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 p-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
