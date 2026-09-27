// One-off test: does YOUR X API access still include a way to check follows?
//
// This makes exactly ONE request. It does not loop, paginate, or run at any
// scale — it's purely so you can see, with your own paid token, whether your
// project still has relationship/follow data enabled. Run it locally:
//
//   X_BEARER_TOKEN=your_token_here TARGET_USERNAME=Foxxy_ethn node scripts/check-follow-access.js
//
// What "success" looks like: a 200 response with a list of users.
// What "no self-serve follow access" looks like (the likely outcome, per
// X's April 2026 change removing follow/like endpoints from self-serve):
// a 403 or 404 with an error body explaining the restriction.
//
// Either way, this costs at most a few cents on your existing plan and tells
// you definitively — nothing here is guesswork after you run it.

const TOKEN = process.env.X_BEARER_TOKEN;
const TARGET = process.env.TARGET_USERNAME || 'Foxxy_ethn';

if (!TOKEN) {
  console.error('Set X_BEARER_TOKEN in your environment first. Example:');
  console.error('  X_BEARER_TOKEN=xxxx TARGET_USERNAME=Foxxy_ethn node scripts/check-follow-access.js');
  process.exit(1);
}

async function main() {
  // Step 1: resolve the target username to a user ID (cheap, almost always allowed).
  const userLookup = await fetch(`https://api.twitter.com/2/users/by/username/${TARGET}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  const userData = await userLookup.json();
  console.log('--- Step 1: look up target user ---');
  console.log(JSON.stringify(userData, null, 2));

  if (!userLookup.ok || !userData.data) {
    console.log('\nCould not even resolve the target username — check the token or username and try again.');
    return;
  }

  const targetId = userData.data.id;

  // Step 2: the actual test — try reading the target's followers list, capped
  // to 1 result, purely to see if the endpoint is enabled for this project.
  const followersCheck = await fetch(
    `https://api.twitter.com/2/users/${targetId}/followers?max_results=1`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  const followersData = await followersCheck.json();
  console.log('\n--- Step 2: attempt to read followers (single result) ---');
  console.log('HTTP status:', followersCheck.status);
  console.log(JSON.stringify(followersData, null, 2));

  console.log('\n--- Result ---');
  if (followersCheck.ok) {
    console.log('✅ Your project CAN read follower data. A real follow-check may be feasible — ask me and I\'ll help wire it in with strict rate limits/caching so it stays affordable.');
  } else {
    console.log('❌ Your project cannot read follower data on this token (likely the April 2026 self-serve removal). This confirms we should stick with the self-report + manual spot-check approach already built into the site.');
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
