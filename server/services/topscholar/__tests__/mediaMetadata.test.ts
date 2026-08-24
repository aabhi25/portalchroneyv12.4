import {
  createMediaMetadata,
  readCurriculumMedia,
  selectRelevantImages,
  type CurriculumMediaCandidate,
} from '../mediaMetadata';
import { parsePlan } from '../cmsConnector';

let failed = 0;
function expect(condition: unknown, label: string) {
  if (!condition) {
    failed++;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

const context = {
  sourceRef: 'lesson-litmus',
  topic: 'Litmus paper',
  concept: 'Acids, bases and salts',
  subConcept: 'Indicators',
  chapter: 'Acids, Bases and Salts',
  subject: 'Chemistry',
};

const litmus = createMediaMetadata(
  'https://cdn.test/litmus.png',
  'image',
  context,
  0,
  { alt: 'Litmus paper in acid and base', caption: 'Litmus paper colour change' },
);

expect(litmus?.topic === 'Litmus paper', 'new image metadata preserves lesson topic');
expect(litmus?.alt === 'Litmus paper in acid and base', 'new image metadata preserves HTML alt text');

{
  const parsed = readCurriculumMedia(
    {
      media: [litmus],
      images: ['https://cdn.test/litmus.png', 'https://cdn.test/legacy.png'],
    },
    'https://cdn.test/litmus.png',
    'image',
    context,
  );
  expect(parsed.length === 2, 'structured, legacy, and primary URLs are deduplicated');
  expect(parsed[0]?.caption === 'Litmus paper colour change', 'structured media keeps caption and provenance');
  expect(parsed[1]?.topic === 'Litmus paper', 'legacy image inherits chunk curriculum context');
}

const candidates: CurriculumMediaCandidate[] = [
  {
    ...litmus!,
    retrievalRank: 0,
  },
  {
    url: 'https://cdn.test/concentration.png',
    kind: 'image',
    topic: 'Concentration of solutions',
    concept: 'Concentration',
    subConcept: 'Formula calculations',
    caption: 'Formula for concentration',
    chapter: 'Acids, Bases and Salts',
    subject: 'Chemistry',
    retrievalRank: 1,
  },
];

{
  const approved = selectRelevantImages('What is litmus paper?', candidates);
  expect(approved.length === 1, 'a clearly relevant image is approved');
  expect(approved[0]?.url === 'https://cdn.test/litmus.png', 'litmus query rejects the concentration diagram');
}

{
  const approved = selectRelevantImages('What is litmus paper?', [candidates[1]]);
  expect(approved.length === 0, 'unrelated-only candidates fail closed');
}

{
  const ionQueryCandidate: CurriculumMediaCandidate = {
    ...candidates[1],
    topic: 'Concentration of solutions',
    concept: 'Concentration',
    caption: 'Concentration formula',
  };
  expect(selectRelevantImages('What is ion?', [ionQueryCandidate]).length === 0, 'substring collisions do not approve an image');
}

{
  const gravitation: CurriculumMediaCandidate = {
    url: 'https://cdn.test/gravitational-potential.png',
    kind: 'image',
    topic: 'Gravitational potential energy',
    chapter: 'Gravitation',
    retrievalRank: 0,
  };
  expect(
    selectRelevantImages('Show a gravitation diagram', [gravitation])[0]?.url === gravitation.url,
    'closely related gravitation and gravitational terms select the verified diagram',
  );
  expect(
    selectRelevantImages('Help me with an image', [gravitation]).length === 0,
    'a vague image-only request remains fail-closed without established topic context',
  );
  expect(
    selectRelevantImages(
      'Help me with an image\n\nEstablished curriculum topic: What is gravitation?',
      [gravitation],
    )[0]?.url === gravitation.url,
    'an established explicit topic safely enables a visual follow-up',
  );
}

{
  const ambiguous: CurriculumMediaCandidate[] = [
    { ...candidates[0], url: 'https://cdn.test/litmus-a.png', retrievalRank: 0 },
    { ...candidates[0], url: 'https://cdn.test/litmus-b.png', retrievalRank: 1 },
  ];
  expect(selectRelevantImages('What is litmus paper?', ambiguous).length === 0, 'equally supported image candidates fail closed');
}

{
  const bundle = parsePlan({
    cp_id: 'cp-standalone-image',
    chapters: [{
      chapterName: { en: 'Acids and Bases' },
      concepts: [{
        conceptName: { en: 'Indicators' },
        subConcepts: [{
          subConceptName: { en: 'Litmus paper' },
          content: {
            images: [{ id: 'img-1', imageUrl: 'https://cdn.test/litmus-standalone.png', alt: { en: 'Litmus test strip' } }],
          },
        }],
      }],
    }],
  }, 'fixture');
  expect(bundle?.images.length === 1, 'standalone CMS images are normalized into the curriculum bundle');
  expect(bundle?.images[0]?.subConcept === 'Litmus paper', 'standalone images retain their lesson provenance');
}

console.log(failed === 0 ? '\nAll TopScholar media metadata tests passed' : `\n${failed} test(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);