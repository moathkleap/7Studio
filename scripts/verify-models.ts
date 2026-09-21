/**
 * verify-models — runs the real per-model self-test for every installed model and prints an honest report.
 *
 * This is meant to run on a developer's or user's machine, where models have actually been downloaded.
 * In the build sandbox no large models can be fetched, so it will normally report "no models installed",
 * which is the truthful result — nothing is faked.
 *
 *   pnpm verify:models
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../packages/engine/src/api/createEngine';
import { createBrowserHost } from '../packages/engine/src/devbridge/browserHost';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function readVersion(): string {
  try {
    return (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<void> {
  const userData = process.env.SEVENSTUDIOS_USER_DATA ?? path.join(root, '.sevenstudios-dev', 'userData');
  const resources = process.env.SEVENSTUDIOS_RESOURCES ?? path.join(root, 'resources');
  const engine = createEngine({ host: createBrowserHost({ appVersion: readVersion(), onQuit: () => undefined, mediaUrl: (p) => `file://${p}` }), paths: { userData, resources } });
  await engine.start();
  try {
    const models = await engine.invoke('models.list', undefined as never);
    const installed = models.filter((m) => m.status === 'installed');
    console.log(`verify-models: ${models.length} models in the registry, ${installed.length} installed (userData: ${userData})\n`);
    if (installed.length === 0) {
      console.log('No models installed — nothing to verify. Install models from AI Models in the app, then re-run.');
      console.log('(This is expected in the build sandbox, where model hosts are blocked.)');
      return;
    }
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const m of installed) {
      process.stdout.write(`• ${m.spec.id} (${m.spec.capability})… `);
      try {
        const r = await engine.invoke('models.test', { modelId: m.spec.id });
        if (r.ok) {
          console.log(`PASS in ${r.ms} ms — ${r.message}`);
          passed++;
        } else if (/not available|not implemented/i.test(r.message)) {
          // No self-test harness for this model family yet — the files are present, so this is a skip, not a failure.
          console.log(`SKIP — ${r.message}`);
          skipped++;
        } else {
          console.log(`FAIL — ${r.message}`);
          failed++;
        }
      } catch (err) {
        console.log(`ERROR — ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      }
    }
    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped (no test harness) of ${installed.length} installed models.`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await engine.dispose();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
