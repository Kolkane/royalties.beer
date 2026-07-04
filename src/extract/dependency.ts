// dependency_added extraction.
//
// Two sources, both yielding package NAME (+ version when known) only:
//   - package-manager install commands seen in Bash tool inputs
//   - added dependencies in a manifest write/edit (package.json, requirements.txt, go.mod)
//
// A go module path (host/org/repo) would leak a hostname + repo, which SCHEMA.md
// forbids, so for `go` we emit only the final path segment.
import type { DepObs } from '../state.js';

const NPM_BINS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const NPM_ADD_SUB = new Set(['add', 'install', 'i']);
const VERSION_RE = /^v?\d[\w.+-]*$/; // exact-ish version; ranges/tags are dropped

// ---- from a Bash command -----------------------------------------------------
export function depsFromCommand(command: string): DepObs[] {
  const tokens = command.trim().split(/\s+/);
  if (tokens.length < 2) return [];
  const bin = tokens[0];
  const rest = tokens.slice(1);

  if (NPM_BINS.has(bin)) {
    const sub = rest[0];
    if (!NPM_ADD_SUB.has(sub)) return [];
    // `npm install` / `yarn install` with no package = install from lockfile.
    if (sub !== 'add' && operands(rest.slice(1)).length === 0) return [];
    return operands(rest.slice(1)).map((s) => parseNpm(s)).filter(isDep);
  }
  if ((bin === 'pip' || bin === 'pip3') && rest[0] === 'install') {
    return parsePipList(rest.slice(1));
  }
  if ((bin === 'python' || bin === 'python3') && rest[0] === '-m' && rest[1] === 'pip' && rest[2] === 'install') {
    return parsePipList(rest.slice(3));
  }
  if (bin === 'cargo' && rest[0] === 'add') {
    return operands(rest.slice(1)).map((s) => parseCargo(s)).filter(isDep);
  }
  if (bin === 'go' && rest[0] === 'get') {
    return operands(rest.slice(1)).map((s) => parseGo(s)).filter(isDep);
  }
  return [];
}

/** Non-flag tokens. */
function operands(tokens: string[]): string[] {
  return tokens.filter((t) => t.length > 0 && !t.startsWith('-'));
}

function parseNpm(spec: string): DepObs | null {
  let name = spec;
  let version: string | undefined;
  const at = spec.lastIndexOf('@');
  if (at > 0) {
    name = spec.slice(0, at);
    version = spec.slice(at + 1);
  }
  if (!name) return null;
  // A '/' is only valid as part of a single "@scope/name" prefix; otherwise the
  // token is a path or URL, not a package name.
  const slashes = (name.match(/\//g) ?? []).length;
  if (slashes > 0 && !(name.startsWith('@') && slashes === 1)) return null;
  const dep: DepObs = { ecosystem: 'npm', package: name };
  if (version && VERSION_RE.test(version)) dep.version = version;
  return dep;
}

function parsePipList(tokens: string[]): DepObs[] {
  const out: DepObs[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('-')) {
      // flags that take a following file/name argument we must not read as a package
      if (/^(-r|--requirement|-c|--constraint|-e|--editable)$/.test(t)) i++;
      continue;
    }
    const dep = parsePip(t);
    if (dep) out.push(dep);
  }
  return out;
}

function parsePip(spec: string): DepObs | null {
  if (spec.includes('/') || spec.includes(':') || spec.includes('\\')) return null; // url/path
  const m = spec.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?(==|>=|<=|~=|!=|>|<)?([\w.+-]+)?$/);
  if (!m) return null;
  const dep: DepObs = { ecosystem: 'pypi', package: m[1] };
  if (m[2] === '==' && m[3] && VERSION_RE.test(m[3])) dep.version = m[3];
  return dep;
}

function parseCargo(spec: string): DepObs | null {
  let name = spec;
  let version: string | undefined;
  const at = spec.indexOf('@');
  if (at > 0) {
    name = spec.slice(0, at);
    version = spec.slice(at + 1);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) return null;
  const dep: DepObs = { ecosystem: 'cargo', package: name };
  if (version && VERSION_RE.test(version)) dep.version = version;
  return dep;
}

function parseGo(spec: string): DepObs | null {
  let path = spec;
  let version: string | undefined;
  const at = spec.indexOf('@');
  if (at > 0) {
    path = spec.slice(0, at);
    version = spec.slice(at + 1);
  }
  if (path.includes('..') || path.startsWith('.')) return null; // ./... relative paths
  const name = path.split('/').filter(Boolean).pop() ?? '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return null;
  const dep: DepObs = { ecosystem: 'go', package: name };
  if (version && VERSION_RE.test(version)) dep.version = version;
  return dep;
}

// ---- from a manifest write/edit ---------------------------------------------
export function depsFromManifest(filePath: string, content: string): DepObs[] {
  const name = baseName(filePath);
  if (!content) return [];
  if (name === 'package.json') return fromPackageJson(content);
  if (name === 'requirements.txt') return parsePipList(splitLines(content));
  if (name === 'go.mod') return fromGoMod(content);
  return [];
}

function fromPackageJson(content: string): DepObs[] {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return []; // partial diff, not valid JSON — rely on the install command instead
  }
  const out: DepObs[] = [];
  for (const key of ['dependencies', 'devDependencies']) {
    const deps = json[key];
    if (!deps || typeof deps !== 'object') continue;
    for (const [pkg, range] of Object.entries(deps as Record<string, unknown>)) {
      const dep = parseNpm(pkg);
      if (!dep) continue;
      const version = typeof range === 'string' ? range.replace(/^[\^~>=<\s]+/, '') : '';
      if (version && VERSION_RE.test(version)) dep.version = version;
      out.push(dep);
    }
  }
  return out;
}

function fromGoMod(content: string): DepObs[] {
  const out: DepObs[] = [];
  for (const line of splitLines(content)) {
    const m = line.replace(/^\s*require\s+/, '').match(/^([^\s]+)\s+(v[\w.+-]+)/);
    if (!m) continue;
    const dep = parseGo(`${m[1]}@${m[2]}`);
    if (dep) out.push(dep);
  }
  return out;
}

function splitLines(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter((l) => l.length > 0);
}

function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? '';
}

function isDep(d: DepObs | null): d is DepObs {
  return d !== null;
}
