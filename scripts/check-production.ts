import { apiOrigin, verifyRelease } from './deployment/readiness';
const option = (name: string) => process.argv.slice(2).find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const base = option('api') || process.env.VITE_API_BASE_URL;
const release = option('release') || process.env.GITHUB_SHA;
const attempts = Number(option('attempts') || 1), interval = Number(option('interval-ms') || 10_000);
if (!base || !release || !Number.isInteger(attempts) || attempts < 1 || attempts > 120 || !Number.isInteger(interval) || interval < 0 || interval > 60_000) throw new Error('Dùng: npm run production:check -- --api=https://api.example.org --release=<commit-sha> [--attempts=60] [--interval-ms=10000]');
apiOrigin(base);
for (let attempt = 1; attempt <= attempts; attempt++) {
  const result = await verifyRelease({ base, release });
  if (result.ok || attempt === attempts) { console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1; break; }
  console.log(`Backend chưa sẵn sàng: lần ${attempt}/${attempts}.`);
  await new Promise(resolve => setTimeout(resolve, interval));
}
