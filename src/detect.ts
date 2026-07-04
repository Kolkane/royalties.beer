// Best-effort project language & framework detection from manifest files in the
// working directory. Returns a slug from the fixed enums, or undefined — never a
// guess. File contents are read only to derive the slug; nothing else is kept.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Language } from './data/languages.js';
import type { Framework } from './data/frameworks.js';

export function detectLanguage(cwd: string): Language | undefined {
  const has = (f: string): boolean => existsSync(join(cwd, f));
  if (has('tsconfig.json')) return 'typescript';
  if (has('package.json')) return 'javascript';
  if (has('Cargo.toml')) return 'rust';
  if (has('go.mod')) return 'go';
  if (has('pyproject.toml') || has('requirements.txt') || has('Pipfile')) return 'python';
  if (has('Gemfile')) return 'ruby';
  if (has('composer.json')) return 'php';
  if (has('pom.xml') || has('build.gradle') || has('build.gradle.kts')) return 'java';
  return undefined;
}

const NPM_FRAMEWORKS: Record<string, Framework> = {
  next: 'nextjs',
  nuxt: 'nuxt',
  '@sveltejs/kit': 'sveltekit',
  svelte: 'svelte',
  '@angular/core': 'angular',
  'solid-js': 'solid',
  '@builder.io/qwik': 'qwik',
  astro: 'astro',
  '@remix-run/react': 'remix',
  gatsby: 'gatsby',
  preact: 'preact',
  react: 'react',
  vue: 'vue',
  '@nestjs/core': 'nestjs',
  express: 'express',
  fastify: 'fastify',
  koa: 'koa',
  hono: 'hono',
  '@trpc/server': 'trpc',
};

const PY_FRAMEWORKS: Record<string, Framework> = {
  django: 'django',
  fastapi: 'fastapi',
  flask: 'flask',
  tornado: 'tornado',
  torch: 'pytorch',
  tensorflow: 'tensorflow',
  langchain: 'langchain',
  'llama-index': 'llamaindex',
  transformers: 'transformers',
  scrapy: 'scrapy',
  celery: 'celery',
};

const RUST_FRAMEWORKS: Record<string, Framework> = {
  'actix-web': 'actix',
  axum: 'axum',
  rocket: 'rocket',
  tauri: 'tauri',
  tokio: 'tokio',
};

const GO_FRAMEWORKS: Record<string, Framework> = {
  'gin-gonic/gin': 'gin',
  'labstack/echo': 'echo',
  'gofiber/fiber': 'fiber',
  'go-chi/chi': 'chi',
  beego: 'beego',
};

export function detectFramework(cwd: string): Framework | undefined {
  const pkg = readJson(join(cwd, 'package.json'));
  if (pkg) {
    const deps = { ...asRecord(pkg.dependencies), ...asRecord(pkg.devDependencies) };
    for (const [name, slug] of Object.entries(NPM_FRAMEWORKS)) if (name in deps) return slug;
  }

  const py = readText(join(cwd, 'requirements.txt')) + '\n' + readText(join(cwd, 'pyproject.toml'));
  if (py.trim()) {
    for (const [name, slug] of Object.entries(PY_FRAMEWORKS)) {
      if (new RegExp(`(^|[^a-z0-9-])${escapeRe(name)}([^a-z0-9-]|$)`, 'im').test(py)) return slug;
    }
  }

  const cargo = readText(join(cwd, 'Cargo.toml'));
  if (cargo) {
    for (const [name, slug] of Object.entries(RUST_FRAMEWORKS)) {
      if (new RegExp(`^\\s*${escapeRe(name)}\\s*=`, 'm').test(cargo)) return slug;
    }
  }

  const gomod = readText(join(cwd, 'go.mod'));
  if (gomod) {
    for (const [needle, slug] of Object.entries(GO_FRAMEWORKS)) if (gomod.includes(needle)) return slug;
  }

  return undefined;
}

function readText(file: string): string {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  } catch {
    return '';
  }
}

function readJson(file: string): Record<string, unknown> | null {
  const text = readText(file);
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
