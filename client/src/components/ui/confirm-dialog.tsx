import { useEffect, useRef, useState } from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The app's question box, in the centre of the screen. Never the browser's own alert / confirm /
 * prompt (scripts/check-no-browser-popups.mjs):
 *   if (!(await confirmDialog({ title: "Delete this paper?", text: "This can't be undone.", confirmLabel: "Delete", danger: true }))) return;
 */
export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red button: something is deleted or replaced. */
  danger?: boolean;
}

interface Question extends ConfirmOptions { answer: (yes: boolean) => void }

const waiting: Question[] = [];
let changed: (() => void) | null = null;

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    waiting.push({ ...options, answer: resolve });
    changed?.();
  });
}

/** A question is on screen: page shortcuts (Esc, arrow keys) leave the keys to it. */
export function confirmDialogOpen(): boolean {
  return waiting.length > 0;
}

/** Mounted once, in App. */
export function ConfirmDialogHost() {
  const [, redraw] = useState(0);
  useEffect(() => {
    changed = () => redraw((n) => n + 1);
    changed();
    return () => { changed = null; };
  }, []);
  // Kept while the box fades out.
  const last = useRef<Question | null>(null);
  const open = waiting[0] ?? null;
  if (open) last.current = open;
  const q = open ?? last.current;

  const answer = (yes: boolean) => {
    const done = waiting.shift();
    redraw((n) => n + 1);
    done?.answer(yes);
  };

  if (!q) return null;
  const Icon = q.danger ? AlertTriangle : HelpCircle;
  return (
    <AlertDialogPrimitive.Root open={!!open} onOpenChange={(o) => { if (!o && open) answer(false); }}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-[200] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <AlertDialogPrimitive.Content
          className="fixed inset-x-4 inset-y-0 z-[200] m-auto h-fit max-h-[calc(100dvh-32px)] max-w-md overflow-y-auto rounded-2xl border bg-background p-6 text-center shadow-xl outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          {...(q.text ? {} : { "aria-describedby": undefined })}
          data-testid="confirm-dialog"
        >
          <span className={cn("mx-auto grid h-12 w-12 place-items-center rounded-full", q.danger ? "bg-red-50 text-red-600" : "bg-violet-50 text-violet-600")}>
            <Icon className="h-6 w-6" />
          </span>
          <AlertDialogPrimitive.Title className="mt-4 text-[17px] font-semibold text-foreground">{q.title}</AlertDialogPrimitive.Title>
          {q.text && <AlertDialogPrimitive.Description className="mt-2 whitespace-pre-line text-[14px] text-muted-foreground">{q.text}</AlertDialogPrimitive.Description>}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <AlertDialogPrimitive.Cancel className={cn(buttonVariants({ variant: "outline" }), "h-auto min-h-10 whitespace-normal")} data-testid="confirm-dialog-cancel">
              {q.cancelLabel ?? "Cancel"}
            </AlertDialogPrimitive.Cancel>
            <button
              type="button"
              className={cn(buttonVariants({ variant: q.danger ? "destructive" : "default" }), "h-auto min-h-10 whitespace-normal")}
              onClick={() => answer(true)}
              data-testid="confirm-dialog-yes"
            >
              {q.confirmLabel}
            </button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
