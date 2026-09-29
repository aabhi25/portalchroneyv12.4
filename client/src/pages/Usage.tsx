import { SidebarTrigger } from "@/components/ui/sidebar";
import { UsageDashboard } from "@/components/usage/UsageDashboard";

/** Business-facing AI usage page (/admin/usage): the user's own / viewed-as account. */
export default function Usage() {
  return (
    <div className="flex flex-col flex-1 min-h-screen bg-gray-50">
      <header className="hidden lg:flex items-center h-[56px] px-6 border-b bg-white">
        <SidebarTrigger className="-ml-1 mr-2" />
        <h1 className="text-[15px] font-semibold text-gray-900">Usage</h1>
      </header>
      <div className="max-w-6xl w-full mx-auto p-4 md:p-6 lg:p-8">
        <UsageDashboard />
      </div>
    </div>
  );
}
