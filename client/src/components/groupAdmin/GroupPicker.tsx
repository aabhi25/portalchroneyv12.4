import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGroupAdminGroupId } from "@/lib/stickyState";

/**
 * The group a group admin is working in, at the top of the sidebar. Leads, Conversations and
 * Insights all follow it. With one group it just names it.
 */
export function GroupAdminGroupPicker() {
  const { data } = useQuery<{ groups: { groupId: string; groupName: string }[] }>({ queryKey: ["/api/group-admin/groups"] });
  const groups = data?.groups || [];
  const [groupId, setGroupId] = useGroupAdminGroupId();
  const current = groups.find(g => g.groupId === groupId) ?? groups[0];

  useEffect(() => {
    if (current && current.groupId !== groupId) setGroupId(current.groupId);
  }, [current, groupId, setGroupId]);

  if (!current) return null;
  // Same size and icon tile as the menu items below it. (A div: the dropdown styles its inner spans.)
  const icon = (
    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-purple-100" aria-hidden>
      <Layers className="h-3.5 w-3.5 text-purple-600" />
    </div>
  );
  if (groups.length === 1) {
    return (
      <div className="mb-2 flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white pl-1.5 pr-2 text-[13px] font-medium text-gray-800" title={current.groupName}>
        {icon}
        <span className="min-w-0 truncate">{current.groupName}</span>
      </div>
    );
  }
  return (
    <div className="mb-2">
      <Select value={current.groupId} onValueChange={setGroupId}>
        <SelectTrigger
          className="h-9 gap-2 rounded-lg border-gray-200 bg-white pl-1.5 pr-2 text-[13px] font-medium text-gray-800 shadow-none focus:ring-1 focus:ring-purple-300 focus:ring-offset-0 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:text-left"
          data-testid="select-group-admin-group"
          aria-label="Group"
          title={current.groupName}
        >
          {icon}
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {groups.map(g => <SelectItem key={g.groupId} value={g.groupId}>{g.groupName}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
