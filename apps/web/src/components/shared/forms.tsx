"use client";
import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { z } from "zod";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
  toast,
} from "@repo/ui";
import { Check, Copy, Loader2, Plus, X } from "lucide-react";
import { errorMessage } from "@repo/web/lib/format";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-2 text-sm font-medium">
      <Label htmlFor={id}>{label}</Label>
      {isValidElement<{ id?: string }>(children)
        ? cloneElement(children, { id })
        : children}
      {hint && (
        <span className="text-xs font-normal leading-relaxed text-muted-foreground">
          {hint}
        </span>
      )}
    </div>
  );
}
export function ChoiceSelect({
  id,
  name,
  options,
  defaultValue,
  placeholder = "Choose an option",
  disabled = false,
  optional = false,
  onValueChange,
}: {
  id?: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  optional?: boolean;
  onValueChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  return (
    <Select
      name={name}
      value={value}
      onValueChange={(selected) => {
        const next = selected === "__none" ? "" : selected;
        setValue(next);
        onValueChange?.(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {optional && <SelectItem value="__none">None</SelectItem>}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function CheckboxChoices({
  name,
  options,
  initial = [],
}: {
  name: string;
  options: { value: string; label: string }[];
  initial?: string[];
}) {
  const id = useId();
  return (
    <div className="grid max-h-60 gap-3 overflow-y-auto border bg-background/50 p-4 sm:grid-cols-2">
      {options.map((option) => (
        <div className="flex items-start gap-2.5" key={option.value}>
          <Checkbox
            id={`${id}-${option.value}`}
            name={`${name}[]`}
            value={option.value}
            defaultChecked={initial.includes(option.value)}
          />
          <Label
            htmlFor={`${id}-${option.value}`}
            className="text-sm font-normal leading-4"
          >
            {option.label}
          </Label>
        </div>
      ))}
    </div>
  );
}
export function TagInput({
  id,
  name,
  initial = [],
  placeholder,
  validate = z.string().trim().min(1),
}: {
  name: string;
  initial?: string[];
  placeholder: string;
  id?: string;
  validate?: z.ZodType<string>;
}) {
  const [values, setValues] = useState(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const add = () => {
    const result = validate.safeParse(draft);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Check this value");
      return;
    }
    if (!values.includes(result.data)) setValues([...values, result.data]);
    setDraft("");
    setError("");
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => {
            event.currentTarget.setCustomValidity("");
            setDraft(event.target.value);
            setError("");
          }}
          onBlur={(event) => {
            if (!draft.trim()) return;
            const result = validate.safeParse(draft);
            event.currentTarget.setCustomValidity(
              result.success
                ? ""
                : (result.error.issues[0]?.message ?? "Check this value"),
            );
            add();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button
          variant="outline"
          type="button"
          onClick={add}
          aria-label={`Add ${name}`}
        >
          <Plus className="size-4" />
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {values.map((value) => (
          <Badge key={value} variant="secondary" className="gap-2 py-1.5">
            {value}
            <input type="hidden" name={`${name}[]`} value={value} />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${value}`}
              onClick={() => setValues(values.filter((item) => item !== value))}
            >
              <X className="size-3" />
            </Button>
          </Badge>
        ))}
      </div>
    </div>
  );
}
export function ActionForm<T>({
  schema,
  onSubmit,
  pending,
  submit = "Save changes",
  children,
}: {
  schema: z.ZodType<T>;
  onSubmit(input: T, form: HTMLFormElement): Promise<unknown>;
  pending?: boolean;
  submit?: string;
  children: ReactNode;
}) {
  const [issues, setIssues] = useState<string[]>([]);
  const handle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const values: Record<string, unknown> = Object.fromEntries(data);
    for (const name of new Set(data.keys())) {
      if (name.endsWith("[]")) {
        values[name.slice(0, -2)] = data.getAll(name);
        delete values[name];
      }
    }
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      setIssues(
        parsed.error.issues.map(
          (issue) => `${issue.path.join(" ")}: ${issue.message}`,
        ),
      );
      return;
    }
    setIssues([]);
    try {
      await onSubmit(parsed.data, form);
    } catch (error) {
      setIssues([errorMessage(error)]);
    }
  };
  return (
    <form onSubmit={(event) => void handle(event)} className="space-y-5">
      {children}
      {issues.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="space-y-1">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {submit}
        </Button>
      </div>
    </form>
  );
}
export function CreateDialog({
  title,
  description,
  label,
  children,
}: {
  title: string;
  description: string;
  label?: string;
  children(close: () => void): ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          {label ?? title}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open && children(() => setOpen(false))}
      </DialogContent>
    </Dialog>
  );
}
export function CredentialDialog({
  value,
  title,
  onClose,
}: {
  value: string;
  title: string;
  onClose(): void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open={!!value}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Copy this token now and keep it somewhere safe. It won't be shown
            again.
          </DialogDescription>
        </DialogHeader>
        <Input
          readOnly
          value={value}
          aria-label="New token"
          onFocus={(event) => event.target.select()}
        />
        <Button
          onClick={() =>
            void navigator.clipboard
              .writeText(value)
              .then(() => {
                setCopied(true);
                toast.success("Copied to clipboard");
              })
              .catch(() =>
                toast.error(
                  "Unable to copy. Select the token and copy it manually.",
                ),
              )
          }
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy token"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
