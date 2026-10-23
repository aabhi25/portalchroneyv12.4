import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * The right-hand panel a feature's "Set up" opens (Features on this account, Business accounts):
 * title, a line on what it is, a scrolling body and a footer with the panel's buttons.
 */
export function SetupPanel({ open, onOpenChange, icon: Icon, title, description, footer, children, testId, wide = false }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
  /** Wider panel for long forms (voice browser, avatar setup). */
  wide?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={`flex w-full flex-col gap-0 p-0 ${wide ? "sm:max-w-2xl" : "sm:max-w-xl"}`} data-testid={testId}>
        <SheetHeader className="border-b px-6 py-4 pr-12 text-left">
          <SheetTitle className="flex items-center gap-2">
            {Icon && <Icon className="h-5 w-5 text-purple-600" />}
            {title}
          </SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <SheetFooter className="flex-row justify-end gap-2 border-t px-6 py-3">{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  );
}
