import { useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { SaBody, SaHeader } from "@/components/superadmin/SuperAdminFrame";
import { DataRetentionDialog } from "@/components/DataRetentionDialog";
import { GROUP_TABS, groupHref, type GroupTabKey } from "@/navigation/superAdminAreas";
import SuperAdminAccountGroups from "@/pages/SuperAdminAccountGroups";
import GroupInsightsPage from "@/pages/GroupInsightsPage";
import GroupTrainingEditor from "@/pages/GroupTrainingEditor";

interface GroupLite {
  id: string;
  name: string;
  members: { businessAccountId: string }[];
}

/** One account group's own page: accounts and admins, insights, shared training and auto-delete. */
export default function SuperAdminGroupPage({ groupId, tab }: { groupId: string; tab?: string }) {
  const { data: groups = [], isLoading } = useQuery<GroupLite[]>({ queryKey: ["/api/super-admin/account-groups"] });
  const group = groups.find(g => g.id === groupId);
  const active = (GROUP_TABS.find(t => t.key === tab)?.key ?? "overview") as GroupTabKey;
  const tabs = GROUP_TABS.map(t => ({ key: t.key, label: t.label, href: groupHref(groupId, t.key) }));

  return (
    <>
      <SaHeader
        icon={Link2}
        tint="bg-indigo-600"
        kind="Account group"
        title={group?.name ?? (isLoading ? "Loading…" : "Group not found")}
        subtitle={group ? `${group.members.length} linked account${group.members.length === 1 ? "" : "s"}` : undefined}
        back={{ label: "Account groups", href: "/super-admin/account-groups" }}
        tabs={tabs}
        activeTab={active}
      />
      <SaBody>
        {!isLoading && !group ? (
          <p className="text-sm text-gray-500">This group could not be found. It may have been deleted.</p>
        ) : (
          <>
            {active === "overview" && <SuperAdminAccountGroups groupId={groupId} />}
            {active === "insights" && <GroupInsightsPage />}
            {active === "training" && <GroupTrainingEditor />}
            {active === "privacy" && group && (
              <DataRetentionDialog bare open onOpenChange={() => {}} scopeType="group" scopeId={group.id} scopeName={group.name} />
            )}
          </>
        )}
      </SaBody>
    </>
  );
}
