// Run from the repository root: node --test scripts/ci/tests/linkedin-personal-oauth.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Load the real provider implementations, isolating unrelated publishing SDKs.
function providers(fetch) {
  const loaded = {};
  class SocialAbstract {
    checkScopes(required, granted) {
      const scopes = String(granted).split(/[ ,]+/);
      if (!required.every((scope) => scopes.includes(scope))) {
        throw new Error('NotEnoughScopes');
      }
    }
  }
  function load(filename, exportName) {
    const source = fs.readFileSync(path.join(__dirname,
      '../../../libraries/nestjs-libraries/src/integrations/social', filename), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true, esModuleInterop: true },
    });
    const exports = {};
    vm.runInNewContext(outputText, {
      exports, fetch, URLSearchParams,
      process: { env: { LINKEDIN_CLIENT_ID: 'test-client', LINKEDIN_CLIENT_SECRET: 'test-secret',
        FRONTEND_URL: 'https://social.example.com' } },
      require(id) {
        if (id.endsWith('/social.abstract')) return { SocialAbstract };
        if (id.endsWith('/linkedin.provider')) return { LinkedinProvider: loaded.personal };
        if (id.endsWith('/make.secure.id')) return { makeSecureId: () => 'test-random' };
        if (id.endsWith('/rules.description.decorator')) return { Rules: () => () => {} };
        if (id.endsWith('/post.plug')) return { PostPlug: () => () => {} };
        if (id.endsWith('/plug.decorator')) return { Plug: () => () => {} };
        return {};
      },
    });
    return exports[exportName];
  }
  loaded.personal = load('linkedin.provider.ts', 'LinkedinProvider');
  loaded.page = load('linkedin.page.provider.ts', 'LinkedinPageProvider');
  return loaded;
}

test('personal OAuth requests self-service scopes and permits interactive consent', async () => {
  const { personal } = providers();
  const { url } = await new personal().generateAuthUrl();
  const params = new URL(url).searchParams;
  assert.equal(params.get('scope'), 'openid profile w_member_social');
  assert.equal(params.has('prompt'), false);
  assert.equal(params.get('redirect_uri'), 'https://social.example.com/integrations/social/linkedin');
  assert.equal(params.get('client_id'), 'test-client');
});

test('personal authentication succeeds with only OpenID and Share grants', async () => {
  const calls = [];
  const { personal } = providers(async (url) => {
    calls.push(url);
    if (url.endsWith('/accessToken')) return { json: async () => ({
      access_token: 'test-token', expires_in: 3600, scope: 'openid profile w_member_social',
    }) };
    assert.equal(url, 'https://api.linkedin.com/v2/userinfo');
    return { json: async () => ({ sub: 'member-id', name: 'Test Member', picture: 'avatar' }) };
  });
  const result = await new personal().authenticate({ code: 'test-code', codeVerifier: 'test-verifier' });
  assert.equal(result.id, 'member-id');
  assert.equal(result.name, 'Test Member');
  assert.equal(result.accessToken, 'test-token');
  assert.equal(calls.length, 2);
  assert.equal(result.username, '');
});

test('missing personal publishing grant is still rejected', async () => {
  const { personal } = providers(async () => ({ json: async () => ({
    access_token: 'test-token', scope: 'openid profile',
  }) }));
  await assert.rejects(new personal().authenticate({ code: 'test-code' }), /NotEnoughScopes/);
});

test('page OAuth retains organization permissions and its own callback', async () => {
  const { page } = providers();
  const { url } = await new page().generateAuthUrl();
  const params = new URL(url).searchParams;
  for (const scope of ['rw_organization_admin', 'w_organization_social', 'r_organization_social']) {
    assert.ok(params.get('scope').split(' ').includes(scope));
  }
  assert.equal(params.has('prompt'), false);
  assert.equal(params.get('redirect_uri'), 'https://social.example.com/integrations/social/linkedin-page');
});
