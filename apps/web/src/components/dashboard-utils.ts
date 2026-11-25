import type { FormEvent } from "react";
export function display(value: unknown): string {
  return typeof value === "object" && value !== null
    ? JSON.stringify(value, null, 2)
    : String(value ?? "—");
}
export function fields(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget));
}
