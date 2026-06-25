import { test, expect } from '../../../../playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

test.describe('OpenAPI externalValue import', () => {
  test('CLI: inlines externalValue example bodies', async ({ createTmpDir }) => {
    const outputDir = await createTmpDir('openapi-external');
    const jsonOutputPath = path.join(outputDir, 'external-examples.json');

    const cliPath = path.resolve(__dirname, '../../../../packages/bruno-cli/bin/bru.js');
    const specPath = path.resolve(__dirname, '../fixtures/openapi-with-external-examples/spec.yaml');
    const command = `node "${cliPath}" import openapi --source "${specPath}" --output-file "${jsonOutputPath}" --collection-name "External"`;

    try {
      execSync(command, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err: any) {
      const stderr = (err.stderr || '').toString();
      throw new Error(`CLI import failed: ${err.message}\n${stderr}`);
    }

    expect(fs.existsSync(jsonOutputPath)).toBe(true);

    const collection = JSON.parse(fs.readFileSync(jsonOutputPath, 'utf8'));
    const flatten = (items: any[]): any[] => items.flatMap((i: any) => (i.type === 'folder' ? flatten(i.items) : [i]));
    const items = flatten(collection.items);
    const me = items.find((i: any) => /getMe/i.test(i.name) || i.request?.url?.endsWith('/me'));
    expect(me, 'GET /me item').toBeDefined();

    const exampleBodies = me.examples
      .map((ex: any) => ex.response?.body?.content)
      .filter(Boolean)
      .map((b: any) => (typeof b === 'string' ? b : JSON.stringify(b)));

    expect(exampleBodies.some((b: string) => b.includes('alice@example.com'))).toBe(true);
    expect(exampleBodies.some((b: string) => b.includes('<error>'))).toBe(true);
  });

  test('CLI: missing externalValue files produce a warning and complete import', async ({ createTmpDir }) => {
    const outputDir = await createTmpDir('openapi-external-missing');
    const jsonOutputPath = path.join(outputDir, 'out.json');

    const cliPath = path.resolve(__dirname, '../../../../packages/bruno-cli/bin/bru.js');
    const specPath = path.resolve(__dirname, '../fixtures/openapi-with-external-examples/spec.yaml');
    const command = `node "${cliPath}" import openapi --source "${specPath}" --output-file "${jsonOutputPath}" --collection-name "External"`;

    const out = execSync(command, { stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    expect(out).toMatch(/Could not resolve externalValue.*does-not-exist\.xml/);
    expect(fs.existsSync(jsonOutputPath)).toBe(true);
  });
});
