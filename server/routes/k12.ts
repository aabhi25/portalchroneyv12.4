import { Router, Request, Response } from "express";
import { db } from "../db";
import { k12Subjects, k12Chapters, k12Topics, k12Questions, k12TopicNotes, k12TopicVideos, businessAccounts, widgetSettings } from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import { requireAuth, requireBusinessAccount, requireRole } from "../auth";
import { TopScholarApiService } from "../services/topscholarApiService";
import { isTopscholarAccount } from "../services/topscholar/config";

const router = Router();

function getBusinessAccountId(req: Request): string | null {
  const user = (req as any).user;
  if (!user) return null;
  return user.businessAccountId || null;
}

function requireTopScholarSuperAdminView(req: Request, res: Response, next: Function) {
  const user = (req as any).user;
  const businessAccountId = getBusinessAccountId(req);
  const isAllowed =
    user?.role === "super_admin" &&
    !!user.activeBusinessAccountId &&
    user.activeBusinessAccountId === businessAccountId &&
    !!businessAccountId &&
    isTopscholarAccount(businessAccountId);

  if (!isAllowed) {
    return res.status(403).json({ error: "TopScholar content management is available only from superadmin account access." });
  }

  next();
}

router.get("/api/k12/subjects", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const subjects = await db
    .select()
    .from(k12Subjects)
    .where(eq(k12Subjects.businessAccountId, businessAccountId))
    .orderBy(asc(k12Subjects.sortOrder));
  res.json(subjects);
});

router.post("/api/k12/subjects", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { name, language, grade, board } = req.body;
  const [subject] = await db.insert(k12Subjects).values({
    businessAccountId,
    name,
    language: language || "en",
    grade,
    board,
  }).returning();
  res.json(subject);
});

router.put("/api/k12/subjects/:id", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { name, language, grade, board } = req.body;
  const [subject] = await db.update(k12Subjects)
    .set({ name, language, grade, board, updatedAt: new Date() })
    .where(and(eq(k12Subjects.id, req.params.id), eq(k12Subjects.businessAccountId, businessAccountId)))
    .returning();
  if (!subject) return res.status(404).json({ error: "Subject not found" });
  res.json(subject);
});

router.delete("/api/k12/subjects/:id", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  await db.delete(k12Subjects).where(and(eq(k12Subjects.id, req.params.id), eq(k12Subjects.businessAccountId, businessAccountId)));
  res.json({ success: true });
});

router.get("/api/k12/subjects/:subjectId/chapters", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const chapters = await db
    .select()
    .from(k12Chapters)
    .where(and(eq(k12Chapters.subjectId, req.params.subjectId), eq(k12Chapters.businessAccountId, businessAccountId)))
    .orderBy(asc(k12Chapters.sortOrder));
  res.json(chapters);
});

router.post("/api/k12/chapters", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { subjectId, name } = req.body;
  const [parentSubject] = await db.select().from(k12Subjects).where(and(eq(k12Subjects.id, subjectId), eq(k12Subjects.businessAccountId, businessAccountId)));
  if (!parentSubject) return res.status(403).json({ error: "Subject not found or access denied" });

  const [chapter] = await db.insert(k12Chapters).values({
    businessAccountId,
    subjectId,
    name,
  }).returning();
  res.json(chapter);
});

router.put("/api/k12/chapters/:id", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { name } = req.body;
  const [chapter] = await db.update(k12Chapters)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(k12Chapters.id, req.params.id), eq(k12Chapters.businessAccountId, businessAccountId)))
    .returning();
  if (!chapter) return res.status(404).json({ error: "Chapter not found" });
  res.json(chapter);
});

router.delete("/api/k12/chapters/:id", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  await db.delete(k12Chapters).where(and(eq(k12Chapters.id, req.params.id), eq(k12Chapters.businessAccountId, businessAccountId)));
  res.json({ success: true });
});

router.get("/api/k12/chapters/:chapterId/topics", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const topics = await db
    .select()
    .from(k12Topics)
    .where(and(eq(k12Topics.chapterId, req.params.chapterId), eq(k12Topics.businessAccountId, businessAccountId)))
    .orderBy(asc(k12Topics.sortOrder));
  res.json(topics);
});

router.get("/api/k12/topics/:id", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const [topic] = await db
    .select()
    .from(k12Topics)
    .where(and(eq(k12Topics.id, req.params.id), eq(k12Topics.businessAccountId, businessAccountId)));
  if (!topic) return res.status(404).json({ error: "Topic not found" });
  res.json(topic);
});

router.post("/api/k12/topics", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { chapterId, name, description, tags } = req.body;
  const [parentChapter] = await db.select().from(k12Chapters).where(and(eq(k12Chapters.id, chapterId), eq(k12Chapters.businessAccountId, businessAccountId)));
  if (!parentChapter) return res.status(403).json({ error: "Chapter not found or access denied" });

  const [topic] = await db.insert(k12Topics).values({
    businessAccountId,
    chapterId,
    name,
    description,
    tags: tags || [],
  }).returning();
  res.json(topic);
});

router.put("/api/k12/topics/:id", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { name, description, tags } = req.body;
  const [topic] = await db.update(k12Topics)
    .set({ name, description, tags, updatedAt: new Date() })
    .where(and(eq(k12Topics.id, req.params.id), eq(k12Topics.businessAccountId, businessAccountId)))
    .returning();
  if (!topic) return res.status(404).json({ error: "Topic not found" });
  res.json(topic);
});

router.delete("/api/k12/topics/:id", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  await db.delete(k12Topics).where(and(eq(k12Topics.id, req.params.id), eq(k12Topics.businessAccountId, businessAccountId)));
  res.json({ success: true });
});

router.get("/api/k12/topics/:topicId/questions", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const questions = await db
    .select()
    .from(k12Questions)
    .where(and(eq(k12Questions.topicId, req.params.topicId), eq(k12Questions.businessAccountId, businessAccountId)))
    .orderBy(asc(k12Questions.sortOrder));
  res.json(questions);
});

router.post("/api/k12/questions", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { topicId, questionHtml, questionType, options, solutionHtml, difficulty, marks } = req.body;
  const [parentTopic] = await db.select().from(k12Topics).where(and(eq(k12Topics.id, topicId), eq(k12Topics.businessAccountId, businessAccountId)));
  if (!parentTopic) return res.status(403).json({ error: "Topic not found or access denied" });

  const [question] = await db.insert(k12Questions).values({
    businessAccountId,
    topicId,
    questionHtml,
    questionType: questionType || "objective",
    options: options || [],
    solutionHtml,
    difficulty,
    marks,
  }).returning();
  res.json(question);
});

router.delete("/api/k12/questions/:id", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  await db.delete(k12Questions).where(and(eq(k12Questions.id, req.params.id), eq(k12Questions.businessAccountId, businessAccountId)));
  res.json({ success: true });
});

router.get("/api/k12/topics/:topicId/notes", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const notes = await db
    .select()
    .from(k12TopicNotes)
    .where(and(eq(k12TopicNotes.topicId, req.params.topicId), eq(k12TopicNotes.businessAccountId, businessAccountId)))
    .orderBy(asc(k12TopicNotes.sortOrder));
  res.json(notes);
});

router.post("/api/k12/topics/:topicId/notes", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const [parentTopic] = await db.select().from(k12Topics).where(and(eq(k12Topics.id, req.params.topicId), eq(k12Topics.businessAccountId, businessAccountId)));
  if (!parentTopic) return res.status(403).json({ error: "Topic not found or access denied" });

  const { title, content } = req.body;
  const [note] = await db.insert(k12TopicNotes).values({
    topicId: req.params.topicId,
    businessAccountId,
    title: title || "Revision Notes",
    content: content || "",
  }).returning();
  res.json(note);
});

router.put("/api/k12/notes/:id", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { title, content } = req.body;
  const [note] = await db.update(k12TopicNotes)
    .set({ title, content, updatedAt: new Date() })
    .where(and(eq(k12TopicNotes.id, req.params.id), eq(k12TopicNotes.businessAccountId, businessAccountId)))
    .returning();
  if (!note) return res.status(404).json({ error: "Note not found" });
  res.json(note);
});

router.delete("/api/k12/notes/:id", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  await db.delete(k12TopicNotes).where(and(eq(k12TopicNotes.id, req.params.id), eq(k12TopicNotes.businessAccountId, businessAccountId)));
  res.json({ success: true });
});

router.get("/api/k12/topics/:topicId/videos", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const videos = await db
    .select()
    .from(k12TopicVideos)
    .where(and(eq(k12TopicVideos.topicId, req.params.topicId), eq(k12TopicVideos.businessAccountId, businessAccountId)))
    .orderBy(asc(k12TopicVideos.sortOrder));
  res.json(videos);
});

router.post("/api/k12/topics/:topicId/videos", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const [parentTopic] = await db.select().from(k12Topics).where(and(eq(k12Topics.id, req.params.topicId), eq(k12Topics.businessAccountId, businessAccountId)));
  if (!parentTopic) return res.status(403).json({ error: "Topic not found or access denied" });

  const { title, videoUrl, transcript } = req.body;
  if (!videoUrl) return res.status(400).json({ error: "Video URL is required" });
  try {
    const parsed = new URL(videoUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: "Video URL must use http or https" });
    }
  } catch {
    return res.status(400).json({ error: "Invalid video URL format" });
  }

  const [video] = await db.insert(k12TopicVideos).values({
    topicId: req.params.topicId,
    businessAccountId,
    title: title || "Video",
    videoUrl,
    transcript: transcript || null,
  }).returning();
  res.json(video);
});

router.put("/api/k12/videos/:id", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { title, videoUrl, transcript } = req.body;
  if (videoUrl) {
    try {
      const parsed = new URL(videoUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: "Video URL must use http or https" });
      }
    } catch {
      return res.status(400).json({ error: "Invalid video URL format" });
    }
  }
  const [video] = await db.update(k12TopicVideos)
    .set({ title, videoUrl, transcript, updatedAt: new Date() })
    .where(and(eq(k12TopicVideos.id, req.params.id), eq(k12TopicVideos.businessAccountId, businessAccountId)))
    .returning();
  if (!video) return res.status(404).json({ error: "Video not found" });
  res.json(video);
});

router.delete("/api/k12/videos/:id", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  await db.delete(k12TopicVideos).where(and(eq(k12TopicVideos.id, req.params.id), eq(k12TopicVideos.businessAccountId, businessAccountId)));
  res.json({ success: true });
});

router.get("/api/k12/content-tree", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const subjects = await db.select().from(k12Subjects).where(eq(k12Subjects.businessAccountId, businessAccountId)).orderBy(asc(k12Subjects.sortOrder));
  const chapters = await db.select().from(k12Chapters).where(eq(k12Chapters.businessAccountId, businessAccountId)).orderBy(asc(k12Chapters.sortOrder));
  const topics = await db.select().from(k12Topics).where(eq(k12Topics.businessAccountId, businessAccountId)).orderBy(asc(k12Topics.sortOrder));

  const tree = subjects.map(subject => ({
    ...subject,
    chapters: chapters
      .filter(ch => ch.subjectId === subject.id)
      .map(chapter => ({
        ...chapter,
        topics: topics.filter(t => t.chapterId === chapter.id),
      })),
  }));

  res.json(tree);
});

router.post("/api/k12/seed-sample-data", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const existingSubjects = await db.select().from(k12Subjects).where(eq(k12Subjects.businessAccountId, businessAccountId));
  if (existingSubjects.length > 0) {
    return res.json({ message: "Sample data already exists", seeded: false });
  }

  const [mathSubject] = await db.insert(k12Subjects).values({
    businessAccountId,
    name: "Mathematics II",
    language: "en",
    grade: "10",
    board: "Maharashtra Board",
  }).returning();

  const [mathChapter] = await db.insert(k12Chapters).values({
    businessAccountId,
    subjectId: mathSubject.id,
    name: "Similarity",
  }).returning();

  const [mathTopic] = await db.insert(k12Topics).values({
    businessAccountId,
    chapterId: mathChapter.id,
    name: "Similarity of Triangles, Conditions of Similar Triangles",
    description: "Learn about similarity of triangles and the conditions that make triangles similar. Covers AA, SAS, and SSS similarity criteria.",
    tags: ["10", "CBSE", "Mathematics", "similar figures", "similarity of triangles", "theorem on similarity", "English", "Maharashtra Board"],
  }).returning();

  await db.insert(k12TopicNotes).values({
    topicId: mathTopic.id,
    businessAccountId,
    title: "Revision Notes",
    content: "Similar Figures: Two figures are similar if they have the same shape but may differ in size.\n\nSimilarity of Triangles: Two triangles are similar if their corresponding angles are equal and their corresponding sides are in proportion.\n\nCriteria for Similarity:\n1. AA (Angle-Angle): If two angles of one triangle are equal to two angles of another, the triangles are similar.\n2. SAS (Side-Angle-Side): If one angle is equal and the sides including that angle are proportional, the triangles are similar.\n3. SSS (Side-Side-Side): If all three pairs of corresponding sides are proportional, the triangles are similar.\n\nBasic Proportionality Theorem (BPT): If a line is drawn parallel to one side of a triangle, it divides the other two sides proportionally.",
  });

  const mathQuestions = [
    {
      questionHtml: '<p>In <math xmlns="http://www.w3.org/1998/Math/MathML"><mo>&#8710;</mo><mi>ABC</mi><mo>,</mo><mo> </mo><mi>DE</mi><mo>&#8741;</mo><mi>BC</mi></math> If AD = x cm, DB = x-2, AE = x+2, EC = x-1, find x.</p>',
      options: [
        { text: "x = 5", isCorrect: false },
        { text: "x = 4", isCorrect: true },
        { text: "x = 6", isCorrect: false },
        { text: "x = 8", isCorrect: false },
      ],
      solutionHtml: '<p>Using Basic Proportionality Theorem (BPT): AD/DB = AE/EC<br/>x/(x-2) = (x+2)/(x-1)<br/>x(x-1) = (x+2)(x-2)<br/>x² - x = x² - 4<br/>-x = -4<br/>x = 4</p>',
      difficulty: 5,
    },
    {
      questionHtml: '<p>If two triangles are similar, then the ratio of their areas is equal to the ratio of the squares of their corresponding sides. True or False?</p>',
      options: [
        { text: "True", isCorrect: true },
        { text: "False", isCorrect: false },
      ],
      solutionHtml: '<p>This is the theorem on areas of similar triangles. If △ABC ~ △DEF, then Area(△ABC)/Area(△DEF) = (AB/DE)² = (BC/EF)² = (AC/DF)²</p>',
      difficulty: 3,
    },
    {
      questionHtml: '<p>Which of the following is NOT a criterion for similarity of triangles?</p>',
      options: [
        { text: "AA (Angle-Angle)", isCorrect: false },
        { text: "SAS (Side-Angle-Side)", isCorrect: false },
        { text: "SSS (Side-Side-Side)", isCorrect: false },
        { text: "ASA (Angle-Side-Angle)", isCorrect: true },
      ],
      solutionHtml: '<p>ASA is a congruence criterion, not a similarity criterion. The three similarity criteria are AA, SAS, and SSS.</p>',
      difficulty: 4,
    },
    {
      questionHtml: '<p>In △ABC, if DE ∥ BC and AD/DB = 3/5, then AE/AC is:</p>',
      options: [
        { text: "3/8", isCorrect: true },
        { text: "3/5", isCorrect: false },
        { text: "5/8", isCorrect: false },
        { text: "5/3", isCorrect: false },
      ],
      solutionHtml: '<p>By BPT, AD/DB = AE/EC = 3/5. So AE/AC = AE/(AE+EC) = 3/(3+5) = 3/8</p>',
      difficulty: 5,
    },
    {
      questionHtml: '<p>Two similar triangles have areas 16 cm² and 25 cm². If a side of the smaller triangle is 2.4 cm, find the corresponding side of the larger triangle.</p>',
      options: [
        { text: "3.0 cm", isCorrect: true },
        { text: "3.5 cm", isCorrect: false },
        { text: "2.8 cm", isCorrect: false },
        { text: "4.0 cm", isCorrect: false },
      ],
      solutionHtml: '<p>Ratio of areas = (ratio of sides)²<br/>16/25 = (2.4/x)²<br/>4/5 = 2.4/x<br/>x = 2.4 × 5/4 = 3.0 cm</p>',
      difficulty: 6,
    },
  ];

  for (let i = 0; i < mathQuestions.length; i++) {
    await db.insert(k12Questions).values({
      businessAccountId,
      topicId: mathTopic.id,
      questionHtml: mathQuestions[i].questionHtml,
      options: mathQuestions[i].options,
      solutionHtml: mathQuestions[i].solutionHtml,
      difficulty: mathQuestions[i].difficulty,
      sortOrder: i,
    });
  }

  const [scienceSubject] = await db.insert(k12Subjects).values({
    businessAccountId,
    name: "Science & Technology I",
    language: "en",
    grade: "10",
    board: "Maharashtra Board",
  }).returning();

  const [scienceChapter] = await db.insert(k12Chapters).values({
    businessAccountId,
    subjectId: scienceSubject.id,
    name: "Gravitation",
  }).returning();

  const [scienceTopic] = await db.insert(k12Topics).values({
    businessAccountId,
    chapterId: scienceChapter.id,
    name: "Introduction to the Force of Gravitation",
    description: "Learn about gravitational force, Newton's universal law of gravitation, and the gravitational constant.",
    tags: ["Gravitation", "Physics", "English", "10", "Maharashtra Board"],
  }).returning();

  await db.insert(k12TopicNotes).values({
    topicId: scienceTopic.id,
    businessAccountId,
    title: "Revision Notes",
    content: "The gravitational force is an attractive force that acts between any bodies with mass.\n\nNewton's universal law of gravitation states that every object in the universe attracts every other object with the force which is directly proportional to the product of their masses (m and M) and is inversely proportional to the square of the distance (r) between them.\n\nF = GmM/r²\n\nWhere M and m are the masses of the two bodies, r is the distance between their centres, F is the force of attraction.\n\nG is a constant of proportionality and is called Universal Gravitational Constant (6.67 × 10⁻¹¹ N m²/kg²)\n\nThe gravitational force between two bodies is always attractive, and it can never be repulsive.\n\nA gravitational force is a conservative force.",
  });

  const scienceQuestions = [
    {
      questionHtml: "<p>What is the SI unit of the gravitational constant G?</p>",
      options: [
        { text: "N m²/kg²", isCorrect: true },
        { text: "N/kg", isCorrect: false },
        { text: "m/s²", isCorrect: false },
        { text: "kg m/s", isCorrect: false },
      ],
      solutionHtml: "<p>From F = GmM/r², we get G = Fr²/(mM). The SI unit is N·m²/kg²</p>",
      difficulty: 3,
    },
    {
      questionHtml: "<p>The gravitational force between two objects is proportional to:</p>",
      options: [
        { text: "Sum of their masses", isCorrect: false },
        { text: "Product of their masses", isCorrect: true },
        { text: "Difference of their masses", isCorrect: false },
        { text: "Ratio of their masses", isCorrect: false },
      ],
      solutionHtml: "<p>According to Newton's law of gravitation, F = GmM/r², the force is directly proportional to the product of the masses.</p>",
      difficulty: 2,
    },
    {
      questionHtml: "<p>If the distance between two bodies is doubled, the gravitational force between them becomes:</p>",
      options: [
        { text: "Half", isCorrect: false },
        { text: "One-fourth", isCorrect: true },
        { text: "Double", isCorrect: false },
        { text: "Four times", isCorrect: false },
      ],
      solutionHtml: "<p>F ∝ 1/r². If r becomes 2r, F becomes F/(2²) = F/4. The force becomes one-fourth.</p>",
      difficulty: 4,
    },
    {
      questionHtml: "<p>The value of the gravitational constant G is approximately:</p>",
      options: [
        { text: "6.67 × 10⁻¹¹ N m²/kg²", isCorrect: true },
        { text: "9.8 m/s²", isCorrect: false },
        { text: "6.67 × 10¹¹ N m²/kg²", isCorrect: false },
        { text: "3 × 10⁸ m/s", isCorrect: false },
      ],
      solutionHtml: "<p>The universal gravitational constant G = 6.67 × 10⁻¹¹ N m²/kg²</p>",
      difficulty: 2,
    },
  ];

  for (let i = 0; i < scienceQuestions.length; i++) {
    await db.insert(k12Questions).values({
      businessAccountId,
      topicId: scienceTopic.id,
      questionHtml: scienceQuestions[i].questionHtml,
      options: scienceQuestions[i].options,
      solutionHtml: scienceQuestions[i].solutionHtml,
      difficulty: scienceQuestions[i].difficulty,
      sortOrder: i,
    });
  }

  const [hindiSubject] = await db.insert(k12Subjects).values({
    businessAccountId,
    name: "हिंदी (Hindi)",
    language: "hi",
    grade: "10",
    board: "Maharashtra Board",
  }).returning();

  const [hindiChapter] = await db.insert(k12Chapters).values({
    businessAccountId,
    subjectId: hindiSubject.id,
    name: "भाषा",
  }).returning();

  const [hindiTopic1] = await db.insert(k12Topics).values({
    businessAccountId,
    chapterId: hindiChapter.id,
    name: "भाषा के भेद",
    description: "अपने विचारों के आदान-प्रदान के लिए सभी को किसी न किसी साधन की आवश्यकता होती है। इस साधन को ही हम 'भाषा' कहते हैं।",
    tags: ["Hindi", "भाषा", "10th", "Maharashtra Board"],
  }).returning();

  await db.insert(k12TopicNotes).values({
    topicId: hindiTopic1.id,
    businessAccountId,
    title: "भाषा के भेद - Revision Notes",
    content: "भाषा के भेद\n\nअपने विचारों के आदान-प्रदान के लिए सभी को किसी न किसी साधन की आवश्यकता होती है। इस साधन को ही हम 'भाषा' कहते हैं।\n\nभाषा के दो रूप होते हैं:\n१) मौखिक भाषा\n२) लिखित भाषा\n\n१. मौखिक भाषा - जब हम मौखिक रूप से अर्थात बोलकर और सुनकर विचारों का आदान-प्रदान करते हैं, तो उसे 'मौखिक भाषा' कहते हैं।\nजैसे- मोबाइल पर बातें करना, रेडियो सुनना, गीत गाना, नाटक देखना, संभाषण देना आदि।\n\n२. लिखित भाषा - जब हम लिखित रूप से अर्थात लिखकर एवं पढ़कर भाषाओं का आदान-प्रदान करते हैं, तो उसे 'लिखित भाषा' कहते हैं।\nजैसे- विज्ञापन पढ़ना, समाचार पत्र पढ़ना, लेख पढ़ना, चिट्ठी लिखना आदि।\n\nसांकेतिक भाषा - मौखिक एवं लिखित भाषा के अतिरिक्त जब हम निर्देशक चिह्नों एवं संकेतों के माध्यम से अपनी बात को बताने का प्रयास करते हैं, तो उसे 'सांकेतिक भाषा' कहते हैं।",
  });

  const [hindiChapter2] = await db.insert(k12Chapters).values({
    businessAccountId,
    subjectId: hindiSubject.id,
    name: "व्याकरण",
  }).returning();

  const [hindiTopic2] = await db.insert(k12Topics).values({
    businessAccountId,
    chapterId: hindiChapter2.id,
    name: "संज्ञा और उसके भेद",
    description: "किसी व्यक्ति, वस्तु, स्थान या भाव के नाम को संज्ञा कहते हैं।",
    tags: ["Hindi", "व्याकरण", "संज्ञा", "10th"],
  }).returning();

  await db.insert(k12TopicNotes).values({
    topicId: hindiTopic2.id,
    businessAccountId,
    title: "संज्ञा - Revision Notes",
    content: "संज्ञा: किसी व्यक्ति, वस्तु, स्थान या भाव के नाम को संज्ञा कहते हैं।\n\nसंज्ञा के भेद:\n१) व्यक्तिवाचक संज्ञा - राम, गंगा, हिमालय\n२) जातिवाचक संज्ञा - लड़का, नदी, पर्वत\n३) भाववाचक संज्ञा - सुंदरता, बचपन, मिठास",
  });

  const k12ConversationStarters = JSON.stringify([
    "Explain the concept of similarity of triangles",
    "What is Newton's law of gravitation?",
    "Quiz me on Gravitation MCQs",
    "भाषा के भेद समझाइए",
    "Help me solve a Maths problem"
  ]);

  const k12CustomInstructions = `You are a friendly K12 education tutor for Maharashtra Board Class 10 students. You help students learn Mathematics, Science, and Hindi.

When a student asks about a topic:
1. First fetch the topic content using your tools to get revision notes and explanations
2. Explain concepts clearly with examples, step by step
3. When asked to quiz or practice, fetch questions and present them one at a time as interactive MCQs
4. For MCQs, show the question and options, wait for the student's answer, then reveal the solution
5. Support Hindi, Marathi, and English — respond in whatever language the student uses
6. Be encouraging and patient, celebrate correct answers, and gently explain mistakes
7. Use simple language appropriate for Class 10 students`;

  const existingWidgetSettings = await db.select().from(widgetSettings).where(eq(widgetSettings.businessAccountId, businessAccountId)).limit(1);
  if (existingWidgetSettings.length > 0) {
    await db.update(widgetSettings)
      .set({
        conversationStarters: k12ConversationStarters,
        conversationStartersEnabled: "true",
        welcomeMessage: "Hi! I'm your study buddy. Ask me about any topic, or let's practice with some questions! 📚",
        widgetHeaderText: "TopScholar",
        customInstructions: k12CustomInstructions,
        personality: "friendly",
        responseLength: "detailed",
        languageSelectorEnabled: "true",
        availableLanguages: JSON.stringify(["auto", "en", "hi", "mr"]),
      })
      .where(eq(widgetSettings.businessAccountId, businessAccountId));
  } else {
    await db.insert(widgetSettings).values({
      businessAccountId,
      conversationStarters: k12ConversationStarters,
      conversationStartersEnabled: "true",
      welcomeMessage: "Hi! I'm your study buddy. Ask me about any topic, or let's practice with some questions! 📚",
      widgetHeaderText: "TopScholar",
      customInstructions: k12CustomInstructions,
      personality: "friendly",
      responseLength: "detailed",
      languageSelectorEnabled: "true",
      availableLanguages: JSON.stringify(["auto", "en", "hi", "mr"]),
    });
  }

  res.json({ message: "Sample data seeded successfully", seeded: true });
});

router.get("/api/k12/search", requireAuth, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const query = (req.query.q as string || "").toLowerCase();
  if (!query) return res.json({ topics: [], questions: [] });

  const allTopics = await db.select().from(k12Topics).where(eq(k12Topics.businessAccountId, businessAccountId));
  const matchedTopics = allTopics.filter(t =>
    t.name.toLowerCase().includes(query) ||
    (t.description && t.description.toLowerCase().includes(query)) ||
    (t.tags && (t.tags as string[]).some(tag => tag.toLowerCase().includes(query)))
  );

  const topicIds = matchedTopics.map(t => t.id);
  let matchedQuestions: any[] = [];
  if (topicIds.length > 0) {
    const allQuestions = await db.select().from(k12Questions).where(eq(k12Questions.businessAccountId, businessAccountId));
    matchedQuestions = allQuestions.filter(q => topicIds.includes(q.topicId));
  }

  res.json({ topics: matchedTopics, questions: matchedQuestions });
});

router.get("/api/k12/external-api-config", requireAuth, requireBusinessAccount, requireRole("business_user", "super_admin"), requireTopScholarSuperAdminView, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const [account] = await db
    .select({
      topscholarApiBaseUrl: businessAccounts.topscholarApiBaseUrl,
      topscholarApiToken: businessAccounts.topscholarApiToken,
    })
    .from(businessAccounts)
    .where(eq(businessAccounts.id, businessAccountId));

  if (!account) return res.status(404).json({ error: "Account not found" });

  res.json({
    apiBaseUrl: account.topscholarApiBaseUrl || '',
    apiToken: account.topscholarApiToken ? '••••••••' : '',
    configured: !!(account.topscholarApiBaseUrl && account.topscholarApiToken),
  });
});

router.put("/api/k12/external-api-config", requireAuth, requireBusinessAccount, requireRole("business_user", "super_admin"), requireTopScholarSuperAdminView, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { apiBaseUrl, apiToken } = req.body;

  const updates: Partial<{ topscholarApiBaseUrl: string | null; topscholarApiToken: string | null }> = {};
  if (apiBaseUrl !== undefined) {
    if (apiBaseUrl) {
      try {
        const url = new URL(apiBaseUrl);
        if (url.protocol !== 'https:') {
          return res.status(400).json({ error: 'API Base URL must use HTTPS' });
        }
        const hostname = url.hostname.toLowerCase();
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' ||
            hostname.startsWith('10.') || hostname.startsWith('192.168.') || hostname.startsWith('172.') ||
            hostname === '169.254.169.254' || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
          return res.status(400).json({ error: 'API Base URL cannot point to internal/private addresses' });
        }
      } catch {
        return res.status(400).json({ error: 'Invalid API Base URL format' });
      }
    }
    updates.topscholarApiBaseUrl = apiBaseUrl || null;
  }
  if (apiToken !== undefined && apiToken !== '••••••••') {
    updates.topscholarApiToken = apiToken || null;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  await db.update(businessAccounts)
    .set(updates)
    .where(eq(businessAccounts.id, businessAccountId));

  res.json({ success: true });
});

router.get("/api/k12/image-upload-settings", requireAuth, requireBusinessAccount, requireRole("business_user", "super_admin"), async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const [account] = await db
    .select({ k12ImageUploadEnabled: businessAccounts.k12ImageUploadEnabled })
    .from(businessAccounts)
    .where(eq(businessAccounts.id, businessAccountId));

  if (!account) return res.status(404).json({ error: "Account not found" });

  res.json({ enabled: account.k12ImageUploadEnabled === 'true' });
});

router.put("/api/k12/image-upload-settings", requireAuth, requireBusinessAccount, requireRole("business_user", "super_admin"), async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }

  await db.update(businessAccounts)
    .set({ k12ImageUploadEnabled: enabled ? 'true' : 'false' })
    .where(eq(businessAccounts.id, businessAccountId));

  res.json({ success: true, enabled });
});

router.get("/api/k12/guardrail-settings", requireAuth, requireBusinessAccount, requireRole("business_user", "super_admin"), async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const [account] = await db
    .select({ k12ContentOnlyMode: businessAccounts.k12ContentOnlyMode, k12VerbatimContentMode: businessAccounts.k12VerbatimContentMode })
    .from(businessAccounts)
    .where(eq(businessAccounts.id, businessAccountId));

  if (!account) return res.status(404).json({ error: "Account not found" });

  res.json({
    contentOnlyMode: account.k12ContentOnlyMode === 'true',
    verbatimContentMode: account.k12VerbatimContentMode === 'true',
  });
});

router.put("/api/k12/guardrail-settings", requireAuth, requireBusinessAccount, requireRole("business_user", "super_admin"), async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  const { contentOnlyMode, verbatimContentMode } = req.body;
  if (typeof contentOnlyMode !== 'boolean' || typeof verbatimContentMode !== 'boolean') {
    return res.status(400).json({ error: 'contentOnlyMode and verbatimContentMode must be booleans' });
  }

  await db.update(businessAccounts)
    .set({
      k12ContentOnlyMode: contentOnlyMode ? 'true' : 'false',
      k12VerbatimContentMode: verbatimContentMode ? 'true' : 'false',
    })
    .where(eq(businessAccounts.id, businessAccountId));

  res.json({ success: true, contentOnlyMode, verbatimContentMode });
});

router.post("/api/k12/external-api-test", requireAuth, requireBusinessAccount, requireRole("business_user", "super_admin"), async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });

  let { apiBaseUrl, apiToken } = req.body;

  if (apiToken === '••••••••') apiToken = undefined;

  if (!apiBaseUrl || !apiToken) {
    const [account] = await db
      .select({
        topscholarApiBaseUrl: businessAccounts.topscholarApiBaseUrl,
        topscholarApiToken: businessAccounts.topscholarApiToken,
      })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessAccountId));

    if (!apiBaseUrl) apiBaseUrl = account?.topscholarApiBaseUrl;
    if (!apiToken) apiToken = account?.topscholarApiToken;
  }

  if (!apiBaseUrl || !apiToken) {
    return res.json({ success: false, message: 'API Base URL and Token are required' });
  }

  try {
    const url = new URL(apiBaseUrl);
    if (url.protocol !== 'https:') {
      return res.json({ success: false, message: 'API Base URL must use HTTPS' });
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' ||
        hostname.startsWith('10.') || hostname.startsWith('192.168.') || hostname.startsWith('172.') ||
        hostname === '169.254.169.254' || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
      return res.json({ success: false, message: 'API Base URL cannot point to internal/private addresses' });
    }
  } catch {
    return res.json({ success: false, message: 'Invalid API Base URL format' });
  }

  const service = new TopScholarApiService({ baseUrl: apiBaseUrl, token: apiToken });
  const result = await service.testConnection();
  res.json(result);
});

export default router;
