import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { businessAccounts, type InsertJob, type InsertJobApplicant, type InsertJobApplication } from "@shared/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { jobImportService, type JobImportConfig } from "../services/jobImportService";

const router = Router();

function getBusinessAccountId(req: Request): string | null {
  const user = (req as any).user;
  if (!user) return null;
  return user.businessAccountId || null;
}

async function requireJobPortalEnabled(req: Request, res: Response, next: NextFunction) {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });
  const [account] = await db.select({ jobPortalEnabled: businessAccounts.jobPortalEnabled })
    .from(businessAccounts).where(eq(businessAccounts.id, businessAccountId));
  if (!account || account.jobPortalEnabled !== "true") {
    return res.status(403).json({ error: "Job Portal feature is not enabled for this account" });
  }
  next();
}

router.get("/api/jobs", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { status, search } = req.query;
  const statusFilter = status && status !== "all" ? String(status) : undefined;
  const searchFilter = search && typeof search === "string" && search.trim() ? search : undefined;

  const allJobs = await storage.getJobs(businessAccountId, { status: statusFilter, search: searchFilter });

  const applications = await storage.getApplications(businessAccountId);
  const countsMap: Record<string, number> = {};
  applications.forEach(app => { countsMap[app.jobId] = (countsMap[app.jobId] || 0) + 1; });

  res.json(allJobs.map(j => ({ ...j, applicantCount: countsMap[j.id] || 0 })));
});

router.get("/api/jobs/:id", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const job = await storage.getJob(req.params.id, businessAccountId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

router.post("/api/jobs", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { title, description, requirements, location, salaryMin, salaryMax, currency, jobType, experienceLevel, department, skills, status: jobStatus } = req.body;
  if (!title) return res.status(400).json({ error: "Job title is required" });

  const job = await storage.createJob({
    businessAccountId,
    title,
    description: description || null,
    requirements: requirements || null,
    location: location || null,
    salaryMin: salaryMin || null,
    salaryMax: salaryMax || null,
    currency: currency || "INR",
    jobType: jobType || "full-time",
    experienceLevel: experienceLevel || null,
    department: department || null,
    skills: skills || [],
    status: jobStatus || "active",
  });
  res.json(job);
});

router.put("/api/jobs/:id", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { title, description, requirements, location, salaryMin, salaryMax, currency, jobType, experienceLevel, department, skills, status: jobStatus } = req.body;
  const updates: Partial<InsertJob> = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (requirements !== undefined) updates.requirements = requirements;
  if (location !== undefined) updates.location = location;
  if (salaryMin !== undefined) updates.salaryMin = salaryMin;
  if (salaryMax !== undefined) updates.salaryMax = salaryMax;
  if (currency !== undefined) updates.currency = currency;
  if (jobType !== undefined) updates.jobType = jobType;
  if (experienceLevel !== undefined) updates.experienceLevel = experienceLevel;
  if (department !== undefined) updates.department = department;
  if (skills !== undefined) updates.skills = skills;
  if (jobStatus !== undefined) updates.status = jobStatus;

  const job = await storage.updateJob(req.params.id, businessAccountId, updates);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

router.delete("/api/jobs/:id", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  await storage.deleteJob(req.params.id, businessAccountId);
  res.json({ success: true });
});

router.get("/api/applicants", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { search } = req.query;
  const searchStr = search && typeof search === "string" && search.trim() ? search : undefined;
  const allApplicants = await storage.getApplicants(businessAccountId, searchStr);

  const applications = await storage.getApplications(businessAccountId);
  const appsByApplicant: Record<string, typeof applications> = {};
  applications.forEach(app => {
    if (!appsByApplicant[app.applicantId]) appsByApplicant[app.applicantId] = [];
    appsByApplicant[app.applicantId].push(app);
  });

  res.json(allApplicants.map(a => ({ ...a, applications: appsByApplicant[a.id] || [] })));
});

router.get("/api/applicants/:id", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const applicant = await storage.getApplicant(req.params.id, businessAccountId);
  if (!applicant) return res.status(404).json({ error: "Applicant not found" });

  const applications = await storage.getApplications(businessAccountId, { applicantId: applicant.id });
  res.json({ ...applicant, applications });
});

router.post("/api/applicants", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { name, email, phone, resumeUrl, resumeText, skills, experienceSummary, source } = req.body;
  if (!name) return res.status(400).json({ error: "Applicant name is required" });

  const applicant = await storage.createApplicant({
    businessAccountId,
    name,
    email: email || null,
    phone: phone || null,
    resumeUrl: resumeUrl || null,
    resumeText: resumeText || null,
    skills: skills || [],
    experienceSummary: experienceSummary || null,
    source: source || "manual",
  });
  res.json(applicant);
});

router.put("/api/applicants/:id", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { name, email, phone, skills, experienceSummary } = req.body;
  const updates: Partial<InsertJobApplicant> = {};
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email;
  if (phone !== undefined) updates.phone = phone;
  if (skills !== undefined) updates.skills = skills;
  if (experienceSummary !== undefined) updates.experienceSummary = experienceSummary;

  const applicant = await storage.updateApplicant(req.params.id, businessAccountId, updates);
  if (!applicant) return res.status(404).json({ error: "Applicant not found" });
  res.json(applicant);
});

router.delete("/api/applicants/:id", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  await storage.deleteApplicant(req.params.id, businessAccountId);
  res.json({ success: true });
});

router.get("/api/applications", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { jobId, applicantId, status: filterStatus } = req.query;
  const filters: { jobId?: string; applicantId?: string; status?: string } = {};
  if (jobId && typeof jobId === "string") filters.jobId = jobId;
  if (applicantId && typeof applicantId === "string") filters.applicantId = applicantId;
  if (filterStatus && typeof filterStatus === "string") filters.status = filterStatus;

  const results = await storage.getApplications(businessAccountId, filters);
  res.json(results);
});

router.get("/api/applications/:id", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const application = await storage.getApplication(req.params.id, businessAccountId);
  if (!application) return res.status(404).json({ error: "Application not found" });
  res.json(application);
});

router.post("/api/applications", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { jobId, applicantId, status: appStatus, matchScore } = req.body;
  if (!jobId || !applicantId) return res.status(400).json({ error: "jobId and applicantId are required" });

  const job = await storage.getJob(jobId, businessAccountId);
  if (!job) return res.status(400).json({ error: "Job not found or does not belong to this account" });

  const applicant = await storage.getApplicant(applicantId, businessAccountId);
  if (!applicant) return res.status(400).json({ error: "Applicant not found or does not belong to this account" });

  const application = await storage.createApplication({
    jobId,
    applicantId,
    businessAccountId,
    status: appStatus || "new",
    matchScore: matchScore || null,
  });
  res.json(application);
});

router.put("/api/applications/:id", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { status: appStatus, matchScore } = req.body;
  const updates: Partial<InsertJobApplication> = {};
  if (appStatus !== undefined) updates.status = appStatus;
  if (matchScore !== undefined) updates.matchScore = matchScore;

  const application = await storage.updateApplication(req.params.id, businessAccountId, updates);
  if (!application) return res.status(404).json({ error: "Application not found" });
  res.json(application);
});

router.delete("/api/applications/:id", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  await storage.deleteApplication(req.params.id, businessAccountId);
  res.json({ success: true });
});

router.post("/api/jobs/load-samples", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const sampleJobs = [
    { title: "Senior Software Engineer", description: "Design and develop scalable backend services using microservices architecture. Lead code reviews, mentor junior developers, and drive technical decisions for product features.", requirements: "5+ years experience in Java/Python/Node.js, strong knowledge of distributed systems, experience with AWS/GCP, familiarity with CI/CD pipelines.", location: "Bangalore", salaryMin: "2000000", salaryMax: "3500000", jobType: "full-time", experienceLevel: "senior", department: "Engineering", skills: ["Java", "Python", "AWS", "Microservices", "Docker", "Kubernetes"] },
    { title: "Product Manager", description: "Own the product roadmap for our B2B SaaS platform. Work closely with engineering, design, and sales teams to define features, prioritize backlogs, and drive product launches.", requirements: "3+ years in product management, experience with agile methodologies, strong analytical and communication skills.", location: "Mumbai", salaryMin: "1800000", salaryMax: "3000000", jobType: "full-time", experienceLevel: "mid", department: "Product", skills: ["Product Strategy", "Agile", "JIRA", "Data Analytics", "Stakeholder Management"] },
    { title: "UI/UX Designer", description: "Create intuitive and visually compelling user interfaces for web and mobile applications. Conduct user research, build wireframes and prototypes, and collaborate with developers on implementation.", requirements: "3+ years of UI/UX design experience, proficiency in Figma/Sketch, strong portfolio demonstrating design thinking.", location: "Pune", salaryMin: "1200000", salaryMax: "2200000", jobType: "full-time", experienceLevel: "mid", department: "Design", skills: ["Figma", "Sketch", "User Research", "Prototyping", "Design Systems", "Adobe XD"] },
    { title: "Data Scientist", description: "Build predictive models and ML pipelines to drive business insights. Analyze large datasets, develop recommendation engines, and present findings to leadership.", requirements: "MS/PhD in Statistics, Computer Science, or related field. 3+ years experience with Python, TensorFlow/PyTorch, and SQL.", location: "Hyderabad", salaryMin: "1600000", salaryMax: "2800000", jobType: "full-time", experienceLevel: "mid", department: "Data Science", skills: ["Python", "TensorFlow", "PyTorch", "SQL", "Machine Learning", "Statistical Modeling"] },
    { title: "DevOps Engineer", description: "Design and maintain CI/CD pipelines, manage cloud infrastructure, and ensure system reliability. Implement monitoring, alerting, and incident response processes.", requirements: "3+ years DevOps experience, expertise in AWS/Azure, Docker, Kubernetes, Terraform, and scripting languages.", location: "Bangalore", salaryMin: "1500000", salaryMax: "2500000", jobType: "full-time", experienceLevel: "mid", department: "Engineering", skills: ["AWS", "Docker", "Kubernetes", "Terraform", "Jenkins", "Linux", "Ansible"] },
    { title: "Frontend Developer (React)", description: "Build responsive, performant web applications using React and TypeScript. Collaborate with designers and backend engineers to deliver exceptional user experiences.", requirements: "2+ years experience with React, TypeScript, and modern CSS. Familiarity with state management libraries and REST/GraphQL APIs.", location: "Noida", salaryMin: "1000000", salaryMax: "1800000", jobType: "full-time", experienceLevel: "junior", department: "Engineering", skills: ["React", "TypeScript", "CSS", "Redux", "GraphQL", "Jest"] },
    { title: "Business Development Manager", description: "Identify and pursue new business opportunities in the enterprise segment. Build relationships with key decision-makers, negotiate contracts, and close deals.", requirements: "5+ years B2B sales experience, proven track record of meeting revenue targets, excellent presentation skills.", location: "Delhi", salaryMin: "1400000", salaryMax: "2400000", jobType: "full-time", experienceLevel: "senior", department: "Sales", skills: ["Enterprise Sales", "CRM", "Negotiation", "Lead Generation", "Account Management"] },
    { title: "Quality Assurance Engineer", description: "Design and execute test plans for web and mobile applications. Automate regression test suites, identify bugs, and work with developers to ensure product quality.", requirements: "2+ years QA experience, proficiency in Selenium/Cypress, experience with API testing tools like Postman.", location: "Chennai", salaryMin: "800000", salaryMax: "1400000", jobType: "full-time", experienceLevel: "junior", department: "Engineering", skills: ["Selenium", "Cypress", "Postman", "JIRA", "Test Automation", "SQL"] },
    { title: "HR Business Partner", description: "Partner with business leaders to drive talent strategy, employee engagement, and organizational development. Handle performance management and workforce planning.", requirements: "5+ years HR experience, strong knowledge of Indian labor laws, experience with HRIS systems.", location: "Gurgaon", salaryMin: "1200000", salaryMax: "2000000", jobType: "full-time", experienceLevel: "senior", department: "Human Resources", skills: ["Talent Management", "Employee Relations", "HRIS", "Performance Management", "Organizational Development"] },
    { title: "Content Marketing Specialist", description: "Create compelling content across blogs, social media, whitepapers, and email campaigns. Develop content strategy aligned with brand goals and SEO best practices.", requirements: "2+ years content marketing experience, excellent writing skills in English, familiarity with SEO tools and analytics.", location: "Mumbai", salaryMin: "600000", salaryMax: "1000000", jobType: "full-time", experienceLevel: "junior", department: "Marketing", skills: ["Content Writing", "SEO", "Social Media", "Google Analytics", "HubSpot", "Copywriting"] },
    { title: "Cloud Solutions Architect", description: "Design enterprise-grade cloud solutions on AWS/Azure. Lead cloud migration projects, define architecture standards, and mentor engineering teams on cloud-native development.", requirements: "8+ years experience, AWS/Azure certified, expertise in serverless architectures and multi-cloud strategies.", location: "Bangalore", salaryMin: "3000000", salaryMax: "5000000", jobType: "full-time", experienceLevel: "lead", department: "Engineering", skills: ["AWS", "Azure", "Cloud Architecture", "Serverless", "Solution Design", "Cost Optimization"] },
    { title: "Mobile Developer (React Native)", description: "Build cross-platform mobile applications using React Native. Integrate with native APIs, optimize app performance, and publish to App Store and Google Play.", requirements: "2+ years React Native experience, knowledge of iOS and Android ecosystems, experience with app store deployment.", location: "Pune", salaryMin: "1200000", salaryMax: "2000000", jobType: "full-time", experienceLevel: "mid", department: "Engineering", skills: ["React Native", "JavaScript", "iOS", "Android", "Redux", "Firebase"] },
    { title: "Financial Analyst", description: "Prepare financial models, forecasts, and variance analyses. Support budgeting processes, provide insights on business performance, and present reports to management.", requirements: "2+ years in financial analysis, CA/CFA preferred, proficiency in Excel and financial modeling.", location: "Mumbai", salaryMin: "800000", salaryMax: "1500000", jobType: "full-time", experienceLevel: "junior", department: "Finance", skills: ["Financial Modeling", "Excel", "SAP", "Budgeting", "Variance Analysis", "PowerBI"] },
    { title: "Cybersecurity Analyst", description: "Monitor security infrastructure, investigate incidents, and implement security policies. Conduct vulnerability assessments and ensure compliance with industry standards.", requirements: "3+ years cybersecurity experience, CISSP/CEH certification preferred, knowledge of SIEM tools and network security.", location: "Hyderabad", salaryMin: "1400000", salaryMax: "2400000", jobType: "full-time", experienceLevel: "mid", department: "IT Security", skills: ["SIEM", "Network Security", "Vulnerability Assessment", "Incident Response", "Compliance", "Firewalls"] },
    { title: "Technical Writer", description: "Create comprehensive technical documentation including API docs, user guides, and knowledge base articles. Work closely with engineering teams to understand complex systems.", requirements: "2+ years technical writing experience, ability to understand and document APIs and software systems.", location: "Remote", salaryMin: "600000", salaryMax: "1200000", jobType: "full-time", experienceLevel: "junior", department: "Engineering", skills: ["Technical Writing", "API Documentation", "Markdown", "Confluence", "DITA", "Git"] },
    { title: "Operations Manager", description: "Oversee daily business operations, optimize processes, and manage vendor relationships. Drive operational efficiency and ensure SLA compliance.", requirements: "5+ years operations management, experience with process improvement methodologies like Six Sigma or Lean.", location: "Chennai", salaryMin: "1500000", salaryMax: "2500000", jobType: "full-time", experienceLevel: "senior", department: "Operations", skills: ["Process Improvement", "Vendor Management", "Six Sigma", "Project Management", "SLA Management"] },
    { title: "Machine Learning Engineer", description: "Design, train, and deploy ML models at scale. Build data pipelines, optimize model performance, and integrate AI capabilities into production systems.", requirements: "3+ years ML engineering, strong Python skills, experience with MLOps tools and cloud deployment.", location: "Bangalore", salaryMin: "2200000", salaryMax: "4000000", jobType: "full-time", experienceLevel: "senior", department: "AI/ML", skills: ["Python", "MLOps", "Deep Learning", "NLP", "Computer Vision", "Spark", "Airflow"] },
    { title: "Customer Success Manager", description: "Manage a portfolio of enterprise clients, drive product adoption, and ensure customer satisfaction. Identify upsell opportunities and reduce churn.", requirements: "3+ years in customer success or account management, excellent communication skills, experience with SaaS products.", location: "Delhi", salaryMin: "1000000", salaryMax: "1800000", jobType: "full-time", experienceLevel: "mid", department: "Customer Success", skills: ["Account Management", "SaaS", "Customer Retention", "Upselling", "CRM", "Presentation Skills"] },
    { title: "Graphic Designer", description: "Create visual assets for marketing campaigns, product interfaces, and brand collaterals. Work across print and digital media to maintain brand consistency.", requirements: "2+ years graphic design experience, proficiency in Adobe Creative Suite, strong visual design portfolio.", location: "Jaipur", salaryMin: "500000", salaryMax: "900000", jobType: "full-time", experienceLevel: "junior", department: "Design", skills: ["Adobe Photoshop", "Illustrator", "InDesign", "Branding", "Typography", "Motion Graphics"] },
    { title: "Data Engineer (Contract)", description: "Build and maintain ETL pipelines, data warehouses, and real-time streaming systems. Ensure data quality and availability for analytics teams.", requirements: "3+ years data engineering experience, expertise in Spark, Kafka, and cloud data services.", location: "Bangalore", salaryMin: "1800000", salaryMax: "3000000", jobType: "contract", experienceLevel: "mid", department: "Data Engineering", skills: ["Apache Spark", "Kafka", "Airflow", "SQL", "Python", "Snowflake", "dbt"] },
  ];

  const created = [];
  for (const sample of sampleJobs) {
    const job = await storage.createJob({
      businessAccountId,
      title: sample.title,
      description: sample.description,
      requirements: sample.requirements,
      location: sample.location,
      salaryMin: sample.salaryMin,
      salaryMax: sample.salaryMax,
      currency: "INR",
      jobType: sample.jobType,
      experienceLevel: sample.experienceLevel,
      department: sample.department,
      skills: sample.skills,
      source: "sample",
      status: "active",
    });
    created.push(job);
  }

  res.json({ success: true, count: created.length });
});

router.get("/api/job-import/config", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const account = await storage.getBusinessAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Account not found" });

  res.json({ config: account.jobImportConfig || null });
});

router.post("/api/job-import/config", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { apiUrl, authHeader, fieldMapping } = req.body;
  if (!apiUrl || !fieldMapping || !fieldMapping.title || !fieldMapping.externalId) {
    return res.status(400).json({ error: "apiUrl, fieldMapping.title, and fieldMapping.externalId are required" });
  }

  const account = await storage.getBusinessAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Account not found" });

  const existing = account.jobImportConfig as JobImportConfig | null;
  const config: JobImportConfig = {
    apiUrl,
    authHeader: authHeader || undefined,
    fieldMapping,
    lastSyncedAt: existing?.lastSyncedAt,
    lastSyncStatus: existing?.lastSyncStatus || "idle",
    lastSyncError: existing?.lastSyncError,
    lastSyncStats: existing?.lastSyncStats,
  };

  await db.update(businessAccounts)
    .set({ jobImportConfig: config })
    .where(eq(businessAccounts.id, businessAccountId));

  res.json({ success: true, config });
});

router.post("/api/job-import/test", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const { apiUrl, authHeader } = req.body;
  if (!apiUrl) return res.status(400).json({ error: "apiUrl is required" });

  const result = await jobImportService.testConnection(apiUrl, authHeader);
  res.json(result);
});

router.post("/api/job-import/sync", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const stats = await jobImportService.syncJobs(businessAccountId);
    res.json({ success: true, stats });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errMsg });
  }
});

router.get("/api/job-import/status", requireAuth, requireJobPortalEnabled, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const account = await storage.getBusinessAccount(businessAccountId);
  if (!account) return res.status(404).json({ error: "Account not found" });

  const config = account.jobImportConfig as JobImportConfig | null;
  res.json({
    configured: !!config?.apiUrl,
    lastSyncedAt: config?.lastSyncedAt || null,
    lastSyncStatus: config?.lastSyncStatus || "idle",
    lastSyncError: config?.lastSyncError || null,
    lastSyncStats: config?.lastSyncStats || null,
  });
});

export default router;
