import { isApprovedCurriculumImageUrl } from '../mediaProxy';

let failed = 0;
function expect(condition: unknown, label: string) {
  if (!condition) {
    failed++;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

expect(
  isApprovedCurriculumImageUrl(
    'https://toppscholar-upload.s3.ap-southeast-1.amazonaws.com/content-package/example.png',
  ),
  'accepts the observed TopScholar S3 image host',
);
expect(
  isApprovedCurriculumImageUrl(
    'https://jaro-images.s3.ap-south-1.amazonaws.com/example.png',
  ),
  'accepts the observed legacy curriculum S3 image host',
);
expect(
  !isApprovedCurriculumImageUrl('https://images.example.com/diagram.png'),
  'rejects unapproved image hosts',
);
expect(
  !isApprovedCurriculumImageUrl('http://toppscholar-upload.s3.ap-southeast-1.amazonaws.com/example.png'),
  'requires HTTPS even for approved hosts',
);

console.log(failed === 0 ? '\nAll TopScholar media proxy tests passed' : `\n${failed} test(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);