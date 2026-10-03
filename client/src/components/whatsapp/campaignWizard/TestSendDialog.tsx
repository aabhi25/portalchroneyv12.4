import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Smartphone, Send } from "lucide-react";

export interface TestSendTarget {
  /** A saved campaign … */
  campaignId?: string;
  variant?: "A" | "B";
  /** … or the unsaved wizard values. */
  templateId?: string;
  templateParams?: string[];
  groupIds?: string[];
}

interface TestSendResponse {
  success: boolean;
  phone: string;
  sampleContactName?: string | null;
  remainingThisHour: number;
}

const PHONE_KEY = "wa-campaign-test-phone";

/**
 * "Send test to my phone": one real message to one number. It is not counted as a
 * campaign recipient. Limited per business per hour on the server.
 */
export function TestSendDialog({ open, onOpenChange, target }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: TestSendTarget;
}) {
  const { toast } = useToast();
  const [phone, setPhone] = useState(() => {
    try { return localStorage.getItem(PHONE_KEY) || ""; } catch { return ""; }
  });
  const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  const valid = digits.length === 10 || (digits.length >= 11 && digits.length <= 15);

  const mutation = useMutation({
    mutationFn: () => target.campaignId
      ? apiRequest<TestSendResponse>("POST", `/api/whatsapp/campaigns/${target.campaignId}/test-send`, { phone, variant: target.variant })
      : apiRequest<TestSendResponse>("POST", "/api/whatsapp/campaigns/test-send", {
        phone,
        templateId: target.templateId,
        templateParams: target.templateParams,
        groupIds: target.groupIds,
      }),
    onSuccess: res => {
      try { localStorage.setItem(PHONE_KEY, phone); } catch { /* ignore */ }
      toast({
        title: "Test message sent",
        description: `Sent to ${res.phone}${res.sampleContactName ? ` using ${res.sampleContactName}'s details` : ""}. You can send ${res.remainingThisHour} more test${res.remainingThisHour === 1 ? "" : "s"} this hour.`,
      });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Test message not sent", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5 text-emerald-600" /> Send a test message</DialogTitle>
          <DialogDescription>
            We'll send this message to one number so you can see exactly what your customers will get. It uses the
            details of the first person in your audience and is not counted in the campaign.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700" htmlFor="test-phone">Your WhatsApp number</label>
          <Input
            id="test-phone"
            inputMode="tel"
            placeholder="91 98765 43210"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && valid && !mutation.isPending) mutation.mutate(); }}
            data-testid="input-test-phone"
          />
          <p className="text-xs text-gray-500">Include the country code. A 10-digit number is treated as an Indian number.</p>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending} data-testid="button-send-test">
            <Send className="mr-1.5 h-4 w-4" /> {mutation.isPending ? "Sending…" : "Send test"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
