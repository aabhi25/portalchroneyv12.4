import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface ImportJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  totalRows: number;
  processedRows: number;
  successCount: number;
  errorCount: number;
  totalEmbeddings: number;
  processedEmbeddings: number;
  fileName: string | null;
  completedAt: string | null;
}

const STORAGE_KEY = 'import_job_notifications';

function getNotifiedJobs(): { completed: string[]; embeddings: string[] } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {}
  return { completed: [], embeddings: [] };
}

function markJobNotified(jobId: string, type: 'completed' | 'embeddings') {
  const data = getNotifiedJobs();
  if (!data[type].includes(jobId)) {
    data[type].push(jobId);
    if (data[type].length > 50) {
      data[type] = data[type].slice(-50);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
}

export function ImportJobMonitor() {
  const { toast } = useToast();
  const notifiedRef = useRef<{ completed: Set<string>; embeddings: Set<string> }>({ 
    completed: new Set(), 
    embeddings: new Set() 
  });
  const initializedRef = useRef(false);

  const { data: recentJobs } = useQuery<ImportJob[]>({
    queryKey: ["/api/products/import-jobs"],
    queryFn: async () => {
      const res = await fetch('/api/products/import-jobs', { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 3000,
    staleTime: 2000,
  });

  useEffect(() => {
    if (!recentJobs) return;

    const stored = getNotifiedJobs();
    stored.completed.forEach(id => notifiedRef.current.completed.add(id));
    stored.embeddings.forEach(id => notifiedRef.current.embeddings.add(id));

    if (!initializedRef.current) {
      for (const job of recentJobs) {
        if (job.status === 'completed') {
          notifiedRef.current.completed.add(job.id);
        }
        if (job.totalEmbeddings > 0 && job.processedEmbeddings >= job.totalEmbeddings) {
          notifiedRef.current.embeddings.add(job.id);
        }
      }
      initializedRef.current = true;
      return;
    }

    const ONE_DAY = 24 * 60 * 60 * 1000;

    for (const job of recentJobs) {
      const isRecent = job.completedAt && 
        (Date.now() - new Date(job.completedAt).getTime()) < ONE_DAY;

      if (job.status === 'completed' && 
          isRecent &&
          !notifiedRef.current.completed.has(job.id)) {
        notifiedRef.current.completed.add(job.id);
        markJobNotified(job.id, 'completed');
        toast({
          title: "Import Completed",
          description: `Successfully imported ${job.successCount} products${job.errorCount > 0 ? ` (${job.errorCount} errors)` : ''}.`,
        });
      }

      const embeddingsComplete = job.totalEmbeddings > 0 && 
        job.processedEmbeddings >= job.totalEmbeddings;

      if (embeddingsComplete && 
          isRecent &&
          !notifiedRef.current.embeddings.has(job.id)) {
        notifiedRef.current.embeddings.add(job.id);
        markJobNotified(job.id, 'embeddings');
        toast({
          title: "Visual Search Ready",
          description: `All ${job.totalEmbeddings} product images have been processed for visual search.`,
        });
      }
    }
  }, [recentJobs, toast]);

  return null;
}
