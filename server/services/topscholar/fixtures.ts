import type { RawPlan } from './cmsConnector';

/**
 * Local fixtures mirroring the Toppscholars "content-bundle" response shape
 * (one plan in result[], with a nested chapters -> concepts -> subConcepts ->
 * content tree). Used to build and verify the full ingest -> embed -> retrieve
 * -> answer pipeline before / without the live API.
 *
 * The demo plan resolves to one cp_id that encodes a board+grade+medium subject
 * package. Notes embed MathML so the MathML conversion + rich rendering paths
 * are exercised.
 */

const DEMO_PLAN_ID = 'demo-plan-6-cbse-science';
const DEMO_CP_ID = '647b233f36e4405c1595a59b';

const MOTION_NOTES_HTML = `
<h2>Motion in a Straight Line</h2>
<p>An object is said to be in <b>motion</b> when its position changes with time
relative to a reference point. The shortest distance between the initial and
final positions is called <b>displacement</b>.</p>
<p>The three equations of motion for uniformly accelerated motion are:</p>
<p><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>v</mi><mo>=</mo><mi>u</mi><mo>+</mo><mi>a</mi><mi>t</mi></math></p>
<p><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>s</mi><mo>=</mo><mi>u</mi><mi>t</mi><mo>+</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mi>a</mi><msup><mi>t</mi><mn>2</mn></msup></math></p>
<p>Here <i>u</i> is the initial velocity, <i>v</i> the final velocity, <i>a</i> the
acceleration, <i>t</i> the time, and <i>s</i> the displacement.</p>
<img src="https://cms-uat.toppscholars.com/assets/motion-graph.jpg" alt="velocity-time graph" />
`;

const FORCE_NOTES_HTML = `
<h2>Newton's Laws of Motion</h2>
<p><b>First Law:</b> A body continues in its state of rest or uniform motion unless
acted upon by an external force. This is also called the law of inertia.</p>
<p><b>Second Law:</b> The rate of change of momentum is proportional to the applied
force: <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>F</mi><mo>=</mo><mi>m</mi><mi>a</mi></math>.</p>
<p><b>Third Law:</b> For every action there is an equal and opposite reaction.</p>
`;

const DEMO_PLAN: RawPlan = {
  planId: DEMO_PLAN_ID,
  planName: { en: '6th CBSE Science (Demo)' },
  cp_id: DEMO_CP_ID,
  cpName: { en: '6th CBSE Science' },
  boardName: { en: 'CBSE' },
  gradeName: { en: '6th' },
  mediumName: { en: 'English' },
  chapters: [
    {
      chapterId: 'ch1',
      chapterName: { en: 'Motion and Measurement' },
      concepts: [
        {
          conceptId: 'c1',
          conceptName: { en: 'Describing Motion' },
          subConcepts: [
            {
              subConceptId: 'sc1',
              subConceptName: { en: 'Motion in a Straight Line' },
              content: {
                revisionNotes: [
                  { contentId: 'n1', title: { en: 'Motion in a Straight Line' }, noteText: [{ content: { en: MOTION_NOTES_HTML }, contentType: 'Notes' }] },
                ],
                videoTranscripts: [
                  {
                    contentId: 't1',
                    videoId: 'v1',
                    title: { en: 'Distance vs Displacement' },
                    videoUrl: 'https://cms-uat.toppscholars.com/assets/motion.mp4',
                    duration: 312,
                    transcriptText: 'In this video we explore how displacement differs from distance. Distance is the total path length covered, while displacement is the straight-line change in position with direction.',
                  },
                  {
                    contentId: 't2',
                    videoId: 'v2',
                    title: { en: 'Velocity-Time Graphs' },
                    videoUrl: 'https://cms-uat.toppscholars.com/assets/vtgraph.mp4',
                    duration: 280,
                    transcriptText: 'When acceleration is constant, the velocity-time graph is a straight line, and the area under the graph gives the displacement of the object.',
                  },
                ],
                questions: [
                  {
                    questionId: 'q1',
                    questionType: 'mcq',
                    questionText: { en: 'A car starts from rest and accelerates uniformly at 2 m/s² for 5 seconds. What is its final velocity?' },
                    difficultyLevel: 3,
                    options: [
                      { name: { en: '5 m/s' }, isCorrect: false },
                      { name: { en: '10 m/s' }, isCorrect: true },
                      { name: { en: '15 m/s' }, isCorrect: false },
                      { name: { en: '20 m/s' }, isCorrect: false },
                    ],
                    solutionDescription: { en: 'Using v = u + at = 0 + 2 × 5 = 10 m/s.' },
                    solutionIndex: [1],
                  },
                ],
                pdfs: [
                  { id: 'eb1', name: { en: 'Physics Chapter 1 - Motion' }, url: 'https://cms-uat.toppscholars.com/assets/ebook-motion-p1.pdf' },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      chapterId: 'ch2',
      chapterName: { en: 'Force and Laws of Motion' },
      concepts: [
        {
          conceptId: 'c2',
          conceptName: { en: "Newton's Laws" },
          subConcepts: [
            {
              subConceptId: 'sc2',
              subConceptName: { en: 'The Three Laws' },
              content: {
                revisionNotes: [
                  { contentId: 'n2', title: { en: "Newton's Laws of Motion" }, noteText: [{ content: { en: FORCE_NOTES_HTML }, contentType: 'Notes' }] },
                ],
                questions: [
                  {
                    questionId: 'q2',
                    questionType: 'mcq',
                    questionText: { en: "Which of Newton's laws is also known as the law of inertia?" },
                    difficultyLevel: 2,
                    options: [
                      { name: { en: 'First Law' }, isCorrect: true },
                      { name: { en: 'Second Law' }, isCorrect: false },
                      { name: { en: 'Third Law' }, isCorrect: false },
                      { name: { en: 'Law of Gravitation' }, isCorrect: false },
                    ],
                    solutionDescription: { en: "Newton's First Law states a body resists change in its state of motion — this property is inertia." },
                    solutionIndex: [0],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};

const FIXTURES: Record<string, RawPlan> = {
  [DEMO_PLAN_ID]: DEMO_PLAN,
};

/** Returns fixture plans for the requested plan IDs (only those that exist). */
export function getFixturePlans(planIds: string[]): RawPlan[] {
  return planIds.map((id) => FIXTURES[id.trim()]).filter((p): p is RawPlan => !!p);
}

export function listFixturePlanIds(): string[] {
  return Object.keys(FIXTURES);
}

export const DEMO_TOPSCHOLAR_PLAN_ID = DEMO_PLAN_ID;
export const DEMO_TOPSCHOLAR_CP_ID = DEMO_CP_ID;
