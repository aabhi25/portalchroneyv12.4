import { getK12ContentResolver } from './services/k12ContentResolver';
import { TOPSCHOLAR_ACCOUNT_ID } from './services/topscholar/config';

async function main() {
  const acct = TOPSCHOLAR_ACCOUNT_ID;
  const resolver = await getK12ContentResolver(acct);

  const t = await resolver.searchTopics('opposite of exhume', acct, {});
  console.log('=== searchTopics("opposite of exhume") ===');
  console.log('message:', t.message, '| count:', t.results.length);
  t.results.forEach((r: any, i: number) => {
    const blob = JSON.stringify(r);
    console.log(`T[${i}] hasBury=${/bury/i.test(blob)} | keys=${Object.keys(r).join(',')}`);
    console.log('   text:', (r.content || r.contentText || r.text || r.notes || '').toString().replace(/<[^>]+>/g, ' ').slice(0, 200));
  });

  const q = await resolver.searchQuestions('opposite of exhume', acct, undefined, {});
  console.log('\n=== searchQuestions("opposite of exhume") ===');
  console.log('message:', q.message, '| count:', q.results.length);
  q.results.slice(0, 2).forEach((r: any, i: number) => {
    const blob = JSON.stringify(r);
    console.log(`Q[${i}] hasBury=${/bury/i.test(blob)} | keys=${Object.keys(r).join(',')}`);
  });
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1); });
