import { useLocation, Redirect } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Loader2, ArrowLeft } from "lucide-react";
import type { MeResponseDto } from "@shared/dto";

type GuardrailSettings = { contentOnlyMode: boolean; verbatimContentMode: boolean };

export default function K12Guardrails() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: user, isLoading: userLoading } = useQuery<MeResponseDto>({
    queryKey: ['/api/auth/me'],
  });
  const isK12Education = user?.businessAccount?.k12EducationEnabled === true;

  const { data: guardrailSettings, isLoading: guardrailSettingsLoading } = useQuery<GuardrailSettings | null>({
    queryKey: ['/api/k12/guardrail-settings'],
    queryFn: async () => {
      const response = await fetch('/api/k12/guardrail-settings', { credentials: 'include' });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: isK12Education,
  });

  const guardrailMutation = useMutation({
    mutationFn: async (next: GuardrailSettings) => {
      const response = await fetch('/api/k12/guardrail-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error('Failed to update guardrail setting');
      return response.json();
    },
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: ['/api/k12/guardrail-settings'] });
      const previous = queryClient.getQueryData<GuardrailSettings | null>(['/api/k12/guardrail-settings']);
      queryClient.setQueryData(['/api/k12/guardrail-settings'], next);
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/k12/guardrail-settings'] });
      toast({ title: 'Guardrail saved', description: 'AI guardrail setting has been updated.' });
    },
    onError: (error: Error, _next, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['/api/k12/guardrail-settings'], context.previous);
      }
      toast({ title: 'Failed to save', description: error.message, variant: 'destructive' });
    },
  });

  if (userLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!isK12Education) {
    return <Redirect to="/admin/training" />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center gap-4">
        <SidebarTrigger />
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={() => setLocation('/admin/training')}
          data-testid="button-back-to-training"
        >
          <ArrowLeft className="w-4 h-4" />
          Training
        </Button>
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600">
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-lg font-semibold">AI Guardrails</h1>
        </div>
      </header>

      <div className="p-6 max-w-3xl mx-auto">
        <Card className="shadow-lg border-gray-200" data-testid="card-k12-guardrails">
          <CardHeader className="border-b bg-gradient-to-r from-cyan-50 to-blue-50 py-4">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-cyan-600" />
              Tutor content controls
            </CardTitle>
            <CardDescription className="mt-1">
              Control how the AI tutor uses your uploaded curriculum content
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between p-4 border rounded-lg bg-gray-50">
              <div className="pr-4">
                <h4 className="font-medium text-sm">Answer only from uploaded content</h4>
                <p className="text-sm text-gray-500 mt-0.5">
                  AI will use only your FAQs, curriculum topics, notes, and documents — never general knowledge. Out-of-curriculum questions get a polite "not in our curriculum yet" response.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {guardrailSettingsLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                ) : (
                  <Switch
                    data-testid="switch-content-only-mode"
                    checked={guardrailSettings?.contentOnlyMode ?? false}
                    onCheckedChange={(checked) =>
                      guardrailMutation.mutate({
                        contentOnlyMode: checked,
                        verbatimContentMode: guardrailSettings?.verbatimContentMode ?? false,
                      })
                    }
                    disabled={guardrailMutation.isPending}
                  />
                )}
                <span className="text-xs text-gray-500 w-12">
                  {guardrailSettings?.contentOnlyMode ? 'On' : 'Off'}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-lg bg-gray-50">
              <div className="pr-4">
                <h4 className="font-medium text-sm">Reproduce content verbatim</h4>
                <p className="text-sm text-gray-500 mt-0.5">
                  AI will quote uploaded content word-for-word without paraphrasing or summarizing. Best for accuracy-critical curricula.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {guardrailSettingsLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                ) : (
                  <Switch
                    data-testid="switch-verbatim-content-mode"
                    checked={guardrailSettings?.verbatimContentMode ?? false}
                    onCheckedChange={(checked) =>
                      guardrailMutation.mutate({
                        contentOnlyMode: guardrailSettings?.contentOnlyMode ?? false,
                        verbatimContentMode: checked,
                      })
                    }
                    disabled={guardrailMutation.isPending}
                  />
                )}
                <span className="text-xs text-gray-500 w-12">
                  {guardrailSettings?.verbatimContentMode ? 'On' : 'Off'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
