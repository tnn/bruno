const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  makeSpecExampleReader,
  resolveSpecExternalExamples
} = require('../../src/utils/openapi-external-examples');

const specWithExternalValue = () => ({
  openapi: '3.0.3',
  info: { title: 't', version: '1' },
  paths: {
    '/me': {
      get: {
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/json': {
                examples: {
                  me: { summary: 'Me', externalValue: './examples/me.json' }
                }
              }
            }
          }
        }
      }
    }
  }
});

describe('makeSpecExampleReader', () => {
  it('reads relative paths against the spec file directory for local file sources', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-oas-'));
    fs.mkdirSync(path.join(dir, 'examples'));
    fs.writeFileSync(path.join(dir, 'examples', 'me.json'), '{"id":1}');
    fs.writeFileSync(path.join(dir, 'spec.yaml'), 'openapi: 3.0.3');

    const readFile = makeSpecExampleReader({ sourceUrl: path.join(dir, 'spec.yaml') });
    const result = await readFile('./examples/me.json');
    expect(result.content).toBe('{"id":1}');
  });

  it('resolves a relative sourceUrl against the collection path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-oas-'));
    fs.mkdirSync(path.join(dir, 'specs', 'examples'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'specs', 'examples', 'me.json'), '{"id":2}');
    fs.writeFileSync(path.join(dir, 'specs', 'spec.yaml'), 'openapi: 3.0.3');

    const readFile = makeSpecExampleReader({
      sourceUrl: path.join('specs', 'spec.yaml'),
      collectionPath: dir
    });
    const result = await readFile('./examples/me.json');
    expect(result.content).toBe('{"id":2}');
  });

  it('joins relative uris onto an http(s) sourceUrl', async () => {
    const fetched = [];
    const httpGet = async (url) => {
      fetched.push(url);
      return { content: '{"id":3}', mediaType: 'application/json' };
    };
    const readFile = makeSpecExampleReader({ sourceUrl: 'https://api.example.com/specs/openapi.yaml', httpGet });
    const result = await readFile('./examples/me.json');
    expect(fetched).toEqual(['https://api.example.com/specs/examples/me.json']);
    expect(result.content).toBe('{"id":3}');
  });

  it('fetches absolute http(s) uris regardless of source type', async () => {
    const fetched = [];
    const httpGet = async (url) => {
      fetched.push(url);
      return { content: 'x' };
    };
    const readFile = makeSpecExampleReader({ sourceUrl: '/some/local/spec.yaml', httpGet });
    await readFile('https://cdn.example.com/me.json');
    expect(fetched).toEqual(['https://cdn.example.com/me.json']);
  });

  it('throws when there is no source to resolve relative uris against', async () => {
    const readFile = makeSpecExampleReader({ sourceUrl: null });
    await expect(readFile('./examples/me.json')).rejects.toThrow();
  });
});

describe('resolveSpecExternalExamples', () => {
  it('returns a resolved clone and leaves the input spec untouched', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-oas-'));
    fs.mkdirSync(path.join(dir, 'examples'));
    fs.writeFileSync(path.join(dir, 'examples', 'me.json'), '{"id":1}');
    fs.writeFileSync(path.join(dir, 'spec.yaml'), 'openapi: 3.0.3');

    const spec = specWithExternalValue();
    const resolved = await resolveSpecExternalExamples(spec, { sourceUrl: path.join(dir, 'spec.yaml') });

    const resolvedExample = resolved.paths['/me'].get.responses['200'].content['application/json'].examples.me;
    expect(resolvedExample.value).toEqual({ id: 1 });
    expect(resolvedExample.externalValue).toBeUndefined();

    const rawExample = spec.paths['/me'].get.responses['200'].content['application/json'].examples.me;
    expect(rawExample.externalValue).toBe('./examples/me.json');
    expect(rawExample.value).toBeUndefined();
  });

  it('degrades gracefully when resolution fails (spec returned, externalValue intact)', async () => {
    const spec = specWithExternalValue();
    const resolved = await resolveSpecExternalExamples(spec, { sourceUrl: null });
    const example = resolved.paths['/me'].get.responses['200'].content['application/json'].examples.me;
    expect(example.externalValue).toBe('./examples/me.json');
  });

  it('passes through non-object specs', async () => {
    expect(await resolveSpecExternalExamples(null, { sourceUrl: null })).toBe(null);
  });
});
