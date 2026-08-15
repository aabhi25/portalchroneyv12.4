import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ChevronDown, Check, Building2, Link } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface LinkedAccount {
  businessAccountId: string;
  businessName: string;
  isPrimary: boolean;
  isCurrent: boolean;
}

interface LinkedAccountsResponse {
  hasLinkedAccounts: boolean;
  currentAccountId: string;
  accounts: LinkedAccount[];
}

interface AccountSwitcherProps {
  businessName: string;
  businessAccountId: string;
}

export function AccountSwitcher({ businessName, businessAccountId }: AccountSwitcherProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);

  const { data: linkedData, isLoading } = useQuery<LinkedAccountsResponse>({
    queryKey: ["/api/account-groups/linked"],
  });

  const switchAccountMutation = useMutation({
    mutationFn: async (targetAccountId: string) => {
      const response = await apiRequest("POST", "/api/account-groups/switch", {
        targetAccountId,
      });
      return response;
    },
    onSuccess: async (data: { success: boolean; businessName: string }) => {
      toast({
        title: "Account Switched",
        description: `Now viewing ${data.businessName}`,
      });
      // Clear all React Query cache
      queryClient.clear();
      // Force refetch user data to get updated activeBusinessAccountId
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      // Reload to ensure clean state
      window.location.reload();
    },
    onError: (error: Error) => {
      toast({
        title: "Switch Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const hasLinkedAccounts = linkedData?.hasLinkedAccounts && linkedData.accounts.length > 1;

  if (!hasLinkedAccounts) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Building2 className="w-3 h-3" />
        <span className="truncate max-w-[120px]">{businessName}</span>
      </div>
    );
  }

  const currentAccount = linkedData?.accounts.find(a => a.isCurrent);
  const otherAccounts = linkedData?.accounts.filter(a => !a.isCurrent) || [];

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto p-1 -ml-1 hover:bg-accent"
          data-testid="account-switcher-trigger"
        >
          <div className="flex items-center gap-2">
            <Building2 className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground truncate max-w-[100px]">
              {currentAccount?.businessName || businessName}
            </span>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[200px]">
        <DropdownMenuLabel className="flex items-center gap-2 text-xs">
          <Link className="w-3 h-3" />
          Linked Accounts
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {currentAccount && (
          <DropdownMenuItem
            disabled
            className="flex items-center justify-between"
            data-testid="current-account-item"
          >
            <span className="truncate">{currentAccount.businessName}</span>
            <Check className="w-4 h-4 text-primary" />
          </DropdownMenuItem>
        )}
        {otherAccounts.map((account) => (
          <DropdownMenuItem
            key={account.businessAccountId}
            onClick={() => switchAccountMutation.mutate(account.businessAccountId)}
            disabled={switchAccountMutation.isPending}
            className="cursor-pointer"
            data-testid={`switch-to-${account.businessAccountId}`}
          >
            <span className="truncate">{account.businessName}</span>
            {account.isPrimary && (
              <span className="ml-auto text-[10px] text-muted-foreground">(Primary)</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
