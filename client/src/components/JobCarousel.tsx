import { useState } from "react";
import { Briefcase, MapPin, DollarSign, Clock, X, Award, GraduationCap, ChevronRight } from "lucide-react";

interface JobItem {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  salaryMin?: string | null;
  salaryMax?: string | null;
  currency?: string | null;
  jobType?: string | null;
  experienceLevel?: string | null;
  department?: string | null;
  skills?: string[] | null;
  matchScore?: number;
}

interface JobCarouselProps {
  jobs: JobItem[];
  chatColor?: string;
  applicantId?: string | null;
  onApply?: (jobId: string, applicantId: string, jobTitle: string) => void;
}

function formatSalary(min?: string | null, max?: string | null, currency?: string | null): string | null {
  const cur = currency || 'INR';
  const symbol = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : '₹';
  if (min && max) {
    return `${symbol}${Number(min).toLocaleString('en-IN')} – ${symbol}${Number(max).toLocaleString('en-IN')}`;
  }
  if (min) return `From ${symbol}${Number(min).toLocaleString('en-IN')}`;
  if (max) return `Up to ${symbol}${Number(max).toLocaleString('en-IN')}`;
  return null;
}

function formatJobType(type?: string | null): string {
  if (!type) return '';
  return type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatExperienceLevel(level?: string | null): string {
  if (!level) return '';
  return level.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function JobDetailFullPage({ job, chatColor, applicantId, onApply, onClose }: {
  job: JobItem;
  chatColor: string;
  applicantId?: string | null;
  onApply?: (jobId: string, applicantId: string, jobTitle: string) => void;
  onClose: () => void;
}) {
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.currency);

  return (
    <div className="fixed inset-0 z-[9999] bg-white dark:bg-gray-950 flex flex-col">
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b border-gray-100 dark:border-gray-800"
        style={{ background: `linear-gradient(135deg, ${chatColor}18 0%, ${chatColor}06 100%)` }}
      >
        <div className="flex-1 min-w-0 pr-3">
          <h2 className="font-bold text-lg text-gray-900 dark:text-gray-100 leading-tight">
            {job.title}
          </h2>
          {job.department && (
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 block">{job.department}</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors flex-shrink-0"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {job.matchScore !== undefined && job.matchScore > 0 && (
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 flex-shrink-0" style={{ color: chatColor }} />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Match Score</span>
            <div className="flex-1 h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden ml-1">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(job.matchScore, 100)}%`, backgroundColor: chatColor }}
              />
            </div>
            <span className="text-sm font-bold" style={{ color: chatColor }}>{job.matchScore}%</span>
          </div>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-2.5">
          {job.location && (
            <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
              <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: chatColor }} />
              <span>{job.location}</span>
            </div>
          )}
          {salary && (
            <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
              <DollarSign className="w-4 h-4 flex-shrink-0" style={{ color: chatColor }} />
              <span>{salary}</span>
            </div>
          )}
          {job.jobType && (
            <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
              <Clock className="w-4 h-4 flex-shrink-0" style={{ color: chatColor }} />
              <span>{formatJobType(job.jobType)}</span>
            </div>
          )}
          {job.experienceLevel && (
            <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
              <GraduationCap className="w-4 h-4 flex-shrink-0" style={{ color: chatColor }} />
              <span>{formatExperienceLevel(job.experienceLevel)}</span>
            </div>
          )}
        </div>

        {job.skills && job.skills.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Skills</h4>
            <div className="flex flex-wrap gap-1.5">
              {(job.skills as string[]).map((skill, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 text-xs rounded-full font-medium"
                  style={{ backgroundColor: `${chatColor}15`, color: chatColor }}
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {job.description && (
          <div>
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Job Description</h4>
            <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">
              {job.description}
            </div>
          </div>
        )}
      </div>

      {applicantId && onApply && (
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0 bg-white dark:bg-gray-950">
          <button
            onClick={() => {
              onApply(job.id, applicantId, job.title);
              onClose();
            }}
            className="w-full py-3 text-sm font-semibold text-white rounded-lg transition-colors hover:opacity-90"
            style={{ backgroundColor: chatColor }}
          >
            Apply Now
          </button>
        </div>
      )}
    </div>
  );
}

export function JobCarousel({ jobs, chatColor = "#9333ea", applicantId, onApply }: JobCarouselProps) {
  const [selectedJob, setSelectedJob] = useState<JobItem | null>(null);

  if (!jobs || jobs.length === 0) return null;

  return (
    <div className="w-full my-3">
      <div className="flex items-center gap-2 mb-2 px-1">
        <Briefcase className="w-4 h-4" style={{ color: chatColor }} />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {jobs.length} Job{jobs.length !== 1 ? 's' : ''} Found
        </span>
      </div>

      <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory -mx-1 px-1">
        {jobs.map((job) => {
          const salary = formatSalary(job.salaryMin, job.salaryMax, job.currency);
          return (
            <div
              key={job.id}
              className="flex-shrink-0 w-[220px] bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden hover:shadow-md transition-all duration-200 snap-start cursor-pointer"
              onClick={() => setSelectedJob(job)}
            >
              <div
                className="px-3 py-2"
                style={{ background: `linear-gradient(135deg, ${chatColor}15 0%, ${chatColor}08 100%)` }}
              >
                <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 line-clamp-2 leading-tight">
                  {job.title}
                </h3>
                {job.department && (
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">{job.department}</span>
                )}
              </div>

              <div className="px-3 py-2 space-y-1.5">
                {job.location && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{job.location}</span>
                  </div>
                )}

                {salary && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                    <DollarSign className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{salary}</span>
                  </div>
                )}

                {job.jobType && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                    <Clock className="w-3 h-3 flex-shrink-0" />
                    <span>{formatJobType(job.jobType)}</span>
                  </div>
                )}

                {job.skills && job.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {(job.skills as string[]).slice(0, 3).map((skill, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5 text-[10px] rounded-full font-medium"
                        style={{ backgroundColor: `${chatColor}15`, color: chatColor }}
                      >
                        {skill}
                      </span>
                    ))}
                    {(job.skills as string[]).length > 3 && (
                      <span className="text-[10px] text-gray-400">+{(job.skills as string[]).length - 3}</span>
                    )}
                  </div>
                )}

                {job.matchScore !== undefined && job.matchScore > 0 && (
                  <div className="pt-1">
                    <div className="flex items-center justify-between text-[10px] mb-0.5">
                      <span className="text-gray-500">Match</span>
                      <span style={{ color: chatColor }} className="font-medium">{job.matchScore}%</span>
                    </div>
                    <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(job.matchScore, 100)}%`, backgroundColor: chatColor }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="px-3 pb-2 space-y-1.5">
                {applicantId && onApply && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onApply(job.id, applicantId, job.title);
                    }}
                    className="w-full py-1.5 text-xs font-medium text-white rounded-md transition-colors hover:opacity-90"
                    style={{ backgroundColor: chatColor }}
                  >
                    Apply Now
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedJob(job);
                  }}
                  className="w-full flex items-center justify-center gap-1 py-1 text-[11px] font-medium rounded-md transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                  style={{ color: chatColor }}
                >
                  View Details
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {selectedJob && (
        <JobDetailFullPage
          job={selectedJob}
          chatColor={chatColor}
          applicantId={applicantId}
          onApply={onApply}
          onClose={() => setSelectedJob(null)}
        />
      )}
    </div>
  );
}
