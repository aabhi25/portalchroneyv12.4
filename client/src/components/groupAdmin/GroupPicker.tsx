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
  if (groups.length === 1) {
    return (
      <div className="mx-2 mb-2 flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm text-gray-800" title="Your group">
        <Layers className="h-4 w-4 shrink-0 text-purple-600" />
        <span className="truncate font-medium">{current.groupName}</span>
      </div>
    );
  }
  return (
    <div className="mx-2 mb-2">
      <Select value={current.groupId} onValueChange={setGroupId}>
        <SelectTrigger className="h-9 bg-white text-sm font-medium" data-testid="select-group-admin-group" aria-label="Group">
          <span className="flex min-w-0 items-center gap-2">
            <Layers className="h-4 w-4 shrink-0 text-purple-600" />
            <span className="truncate"><SelectValue /></span>
          </span>
        </SelectTrigger>
        <SelectContent>
          {groups.map(g => <SelectItem key={g.groupId} value={g.groupId}>{g.groupName}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
