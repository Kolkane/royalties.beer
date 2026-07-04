// Dependency + api-domain extraction: names/versions only, no paths or files.
import { describe, expect, it } from 'vitest';
import { depsFromCommand, depsFromManifest } from '../src/extract/dependency.js';
import { domainsInContent } from '../src/extract/api-domain.js';

describe('depsFromCommand', () => {
  const cases: [string, unknown[]][] = [
    ['npm install resend@4.0.0', [{ ecosystem: 'npm', package: 'resend', version: '4.0.0' }]],
    ['pnpm add @scope/pkg', [{ ecosystem: 'npm', package: '@scope/pkg' }]],
    ['yarn add react react-dom', [{ ecosystem: 'npm', package: 'react' }, { ecosystem: 'npm', package: 'react-dom' }]],
    ['npm install react@^18', [{ ecosystem: 'npm', package: 'react' }]], // range dropped
    ['npm install', []], // lockfile install, not an add
    ['yarn install', []],
    ['npm run build', []],
    ['pip install requests==2.31.0', [{ ecosystem: 'pypi', package: 'requests', version: '2.31.0' }]],
    ['pip install -r requirements.txt', []], // must not treat the file as a package
    ['python -m pip install flask', [{ ecosystem: 'pypi', package: 'flask' }]],
    ['cargo add serde@1.0', [{ ecosystem: 'cargo', package: 'serde', version: '1.0' }]],
    ['go get github.com/gin-gonic/gin@v1.9.1', [{ ecosystem: 'go', package: 'gin', version: 'v1.9.1' }]],
  ];

  for (const [command, expected] of cases) {
    it(command, () => expect(depsFromCommand(command)).toEqual(expected));
  }
});

describe('depsFromManifest', () => {
  it('parses package.json dependencies (name + pinned version)', () => {
    const content = JSON.stringify({ dependencies: { resend: '^4.0.0', '@scope/x': '1.2.3' }, devDependencies: { vitest: '2.1.8' } });
    expect(depsFromManifest('package.json', content)).toEqual([
      { ecosystem: 'npm', package: 'resend', version: '4.0.0' },
      { ecosystem: 'npm', package: '@scope/x', version: '1.2.3' },
      { ecosystem: 'npm', package: 'vitest', version: '2.1.8' },
    ]);
  });

  it('ignores a non-manifest file', () => {
    expect(depsFromManifest('src/index.ts', 'import stripe from "stripe"')).toEqual([]);
  });
});

describe('domainsInContent', () => {
  it('returns only known-services domains present in the content', () => {
    const content = 'const url = "https://api.stripe.com/v1"; fetch("https://api.resend.com/emails")';
    expect(domainsInContent(content)).toEqual(['api.stripe.com', 'api.resend.com']);
  });
  it('returns nothing for unknown domains', () => {
    expect(domainsInContent('fetch("https://api.evil-tracker.com")')).toEqual([]);
  });
});
