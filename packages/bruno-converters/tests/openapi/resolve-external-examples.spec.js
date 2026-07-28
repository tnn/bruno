import { describe, it, expect } from '@jest/globals';
import resolveExternalExamples from '../../src/openapi/resolve-external-examples';

const makeReader = (files) => async (uri) => {
  if (!(uri in files)) {
    const err = new Error(`ENOENT: no such file or directory, open '${uri}'`);
    err.code = 'ENOENT';
    throw err;
  }
  return files[uri];
};

const baseSpec = () => ({
  openapi: '3.0.0',
  info: { title: 't', version: '1' },
  paths: {
    '/users': {
      get: {
        responses: {
          200: {
            content: {
              'application/json': {
                examples: {
                  default: {
                    summary: 'one',
                    externalValue: './examples/users.json'
                  }
                }
              }
            }
          }
        }
      }
    }
  }
});

describe('resolveExternalExamples', () => {
  it('inlines a response example referenced by externalValue (application/json)', async () => {
    const spec = baseSpec();
    const { spec: out, issues } = await resolveExternalExamples(spec, {
      readFile: makeReader({
        './examples/users.json': { content: '[{"id":1}]', mediaType: 'application/json' }
      })
    });
    const ex = out.paths['/users'].get.responses['200'].content['application/json'].examples.default;
    expect(ex.value).toEqual([{ id: 1 }]);
    expect(ex.externalValue).toBeUndefined();
    expect(ex.summary).toBe('one');
    expect(issues).toEqual([]);
  });

  it('inlines a request-body example', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/u': {
          post: {
            requestBody: {
              content: {
                'application/json': { examples: { good: { externalValue: './req.json' } } }
              }
            }
          }
        }
      }
    };
    const { spec: out, issues } = await resolveExternalExamples(spec, {
      readFile: makeReader({ './req.json': { content: '{"n":1}', mediaType: 'application/json' } })
    });
    expect(out.paths['/u'].post.requestBody.content['application/json'].examples.good.value).toEqual({ n: 1 });
    expect(issues).toEqual([]);
  });

  it('inlines a parameter example', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/u': {
          get: {
            parameters: [
              { name: 'id', in: 'query', examples: { a: { externalValue: './p.json' } } }
            ]
          }
        }
      }
    };
    const { spec: out } = await resolveExternalExamples(spec, {
      readFile: makeReader({ './p.json': { content: '42', mediaType: 'application/json' } })
    });
    expect(out.paths['/u'].get.parameters[0].examples.a.value).toBe(42);
  });

  it('inlines a path-item-level parameter example', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/u': {
          parameters: [
            { name: 'id', in: 'query', examples: { a: { externalValue: './p.json' } } }
          ],
          get: {}
        }
      }
    };
    const { spec: out } = await resolveExternalExamples(spec, {
      readFile: makeReader({ './p.json': { content: '7', mediaType: 'application/json' } })
    });
    expect(out.paths['/u'].parameters[0].examples.a.value).toBe(7);
  });

  it('inlines a component-level example', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {},
      components: { examples: { Foo: { externalValue: './foo.json' } } }
    };
    const { spec: out } = await resolveExternalExamples(spec, {
      readFile: makeReader({ './foo.json': { content: '{"foo":true}', mediaType: 'application/json' } })
    });
    expect(out.components.examples.Foo.value).toEqual({ foo: true });
  });

  it('parses YAML based on media type', async () => {
    const spec = baseSpec();
    spec.paths['/users'].get.responses['200'].content['application/json'].examples.default.externalValue = './u.yaml';
    const { spec: out } = await resolveExternalExamples(spec, {
      readFile: makeReader({ './u.yaml': { content: 'a: 1\nb: 2\n', mediaType: 'application/yaml' } })
    });
    expect(out.paths['/users'].get.responses['200'].content['application/json'].examples.default.value).toEqual({ a: 1, b: 2 });
  });

  it('parses YAML based on file extension when no media type is supplied (component-level)', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {},
      components: { examples: { Foo: { externalValue: './foo.yaml' } } }
    };
    const { spec: out } = await resolveExternalExamples(spec, {
      readFile: makeReader({ './foo.yaml': { content: 'a: 1\nb: 2\n' } })
    });
    expect(out.components.examples.Foo.value).toEqual({ a: 1, b: 2 });
  });

  it('parses application/problem+json as JSON', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/u': {
          get: {
            responses: {
              400: {
                content: {
                  'application/problem+json': { examples: { bad: { externalValue: './p.json' } } }
                }
              }
            }
          }
        }
      }
    };
    const { spec: out } = await resolveExternalExamples(spec, {
      readFile: makeReader({ './p.json': { content: '{"title":"oops"}', mediaType: 'application/problem+json' } })
    });
    expect(out.paths['/u'].get.responses['400'].content['application/problem+json'].examples.bad.value).toEqual({ title: 'oops' });
  });

  it('keeps raw string when media type is application/xml', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/u': {
          get: {
            responses: {
              200: {
                content: {
                  'application/xml': { examples: { x: { externalValue: './x.xml' } } }
                }
              }
            }
          }
        }
      }
    };
    const { spec: out } = await resolveExternalExamples(spec, {
      readFile: makeReader({ './x.xml': { content: '<u><id>1</id></u>', mediaType: 'application/xml' } })
    });
    expect(out.paths['/u'].get.responses['200'].content['application/xml'].examples.x.value).toBe('<u><id>1</id></u>');
  });

  it('falls back to raw string when JSON parse fails on application/json', async () => {
    const spec = baseSpec();
    const { spec: out } = await resolveExternalExamples(spec, {
      readFile: makeReader({ './examples/users.json': { content: 'not-json', mediaType: 'application/json' } })
    });
    expect(out.paths['/users'].get.responses['200'].content['application/json'].examples.default.value).toBe('not-json');
  });

  it('records an issue and leaves externalValue in place when readFile throws', async () => {
    const spec = baseSpec();
    const { spec: out, issues } = await resolveExternalExamples(spec, {
      readFile: makeReader({})
    });
    const ex = out.paths['/users'].get.responses['200'].content['application/json'].examples.default;
    expect(ex.value).toBeUndefined();
    expect(ex.externalValue).toBe('./examples/users.json');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'warning',
      path: 'paths./users.get.responses.200.content.application/json.examples.default'
    });
    expect(issues[0].message).toMatch(/Could not resolve externalValue/);
  });

  it('deletes externalValue when value is already present (value wins)', async () => {
    const spec = baseSpec();
    spec.paths['/users'].get.responses['200'].content['application/json'].examples.default.value = [{ id: 9 }];
    let called = 0;
    const { spec: out } = await resolveExternalExamples(spec, {
      readFile: async () => {
        called++; return { content: '[]' };
      }
    });
    const ex = out.paths['/users'].get.responses['200'].content['application/json'].examples.default;
    expect(ex.value).toEqual([{ id: 9 }]);
    expect(ex.externalValue).toBeUndefined();
    expect(called).toBe(0);
  });

  it('leaves examples without externalValue untouched', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/u': {
          get: {
            responses: {
              200: {
                content: {
                  'application/json': { examples: { ok: { value: { n: 1 } }, raw: { summary: 'no value' } } }
                }
              }
            }
          }
        }
      }
    };
    const { spec: out, issues } = await resolveExternalExamples(spec, { readFile: makeReader({}) });
    expect(out.paths['/u'].get.responses['200'].content['application/json'].examples.ok.value).toEqual({ n: 1 });
    expect(out.paths['/u'].get.responses['200'].content['application/json'].examples.raw).toEqual({ summary: 'no value' });
    expect(issues).toEqual([]);
  });

  it('mutates spec in place (returned spec is the same reference)', async () => {
    const spec = baseSpec();
    const { spec: out } = await resolveExternalExamples(spec, {
      readFile: makeReader({ './examples/users.json': { content: '[]', mediaType: 'application/json' } })
    });
    expect(out).toBe(spec);
  });

  describe('component sections reachable via $ref', () => {
    const shell = (components) => ({
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {},
      components
    });

    it('resolves examples inside components.responses', async () => {
      const spec = shell({
        responses: {
          Me: {
            description: 'ok',
            content: {
              'application/json': { examples: { me: { externalValue: './me.json' } } }
            }
          }
        }
      });
      const { spec: out, issues } = await resolveExternalExamples(spec, {
        readFile: makeReader({ './me.json': { content: '{"id":1}', mediaType: 'application/json' } })
      });
      const ex = out.components.responses.Me.content['application/json'].examples.me;
      expect(ex.value).toEqual({ id: 1 });
      expect(ex.externalValue).toBeUndefined();
      expect(issues).toEqual([]);
    });

    it('resolves examples inside components.requestBodies', async () => {
      const spec = shell({
        requestBodies: {
          NewUser: {
            content: {
              'application/json': { examples: { good: { externalValue: './new-user.json' } } }
            }
          }
        }
      });
      const { spec: out, issues } = await resolveExternalExamples(spec, {
        readFile: makeReader({ './new-user.json': { content: '{"n":1}', mediaType: 'application/json' } })
      });
      expect(out.components.requestBodies.NewUser.content['application/json'].examples.good.value).toEqual({ n: 1 });
      expect(issues).toEqual([]);
    });

    it('resolves examples inside components.parameters', async () => {
      const spec = shell({
        parameters: {
          UserId: {
            name: 'userId',
            in: 'query',
            examples: { sample: { externalValue: './id.json' } }
          }
        }
      });
      const { spec: out, issues } = await resolveExternalExamples(spec, {
        readFile: makeReader({ './id.json': { content: '42', mediaType: 'application/json' } })
      });
      expect(out.components.parameters.UserId.examples.sample.value).toBe(42);
      expect(issues).toEqual([]);
    });

    it('resolves examples inside components.headers', async () => {
      const spec = shell({
        headers: {
          RateLimit: { examples: { low: { externalValue: './limit.json' } } }
        }
      });
      const { spec: out, issues } = await resolveExternalExamples(spec, {
        readFile: makeReader({ './limit.json': { content: '10', mediaType: 'application/json' } })
      });
      expect(out.components.headers.RateLimit.examples.low.value).toBe(10);
      expect(issues).toEqual([]);
    });

    it('resolves examples inside components.pathItems operations', async () => {
      const spec = shell({
        pathItems: {
          MePath: {
            get: {
              responses: {
                200: {
                  content: {
                    'application/json': { examples: { me: { externalValue: './me.json' } } }
                  }
                }
              }
            }
          }
        }
      });
      const { spec: out, issues } = await resolveExternalExamples(spec, {
        readFile: makeReader({ './me.json': { content: '{"id":2}', mediaType: 'application/json' } })
      });
      const ex = out.components.pathItems.MePath.get.responses['200'].content['application/json'].examples.me;
      expect(ex.value).toEqual({ id: 2 });
      expect(issues).toEqual([]);
    });
  });

  describe('inline sites previously missed', () => {
    it('resolves examples on inline response headers', async () => {
      const spec = {
        openapi: '3.0.0',
        info: { title: 't', version: '1' },
        paths: {
          '/u': {
            get: {
              responses: {
                200: {
                  description: 'ok',
                  headers: {
                    'X-Rate-Limit': { examples: { low: { externalValue: './limit.json' } } }
                  }
                }
              }
            }
          }
        }
      };
      const { spec: out, issues } = await resolveExternalExamples(spec, {
        readFile: makeReader({ './limit.json': { content: '10', mediaType: 'application/json' } })
      });
      expect(out.paths['/u'].get.responses['200'].headers['X-Rate-Limit'].examples.low.value).toBe(10);
      expect(issues).toEqual([]);
    });

    it('resolves examples on a parameter content media type', async () => {
      const spec = {
        openapi: '3.0.0',
        info: { title: 't', version: '1' },
        paths: {
          '/u': {
            get: {
              parameters: [
                {
                  name: 'filter',
                  in: 'query',
                  content: {
                    'application/json': { examples: { sample: { externalValue: './filter.json' } } }
                  }
                }
              ],
              responses: { 200: { description: 'ok' } }
            }
          }
        }
      };
      const { spec: out, issues } = await resolveExternalExamples(spec, {
        readFile: makeReader({ './filter.json': { content: '{"a":1}', mediaType: 'application/json' } })
      });
      expect(out.paths['/u'].get.parameters[0].content['application/json'].examples.sample.value).toEqual({ a: 1 });
      expect(issues).toEqual([]);
    });
  });
});
