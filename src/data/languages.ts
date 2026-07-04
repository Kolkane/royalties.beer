// The fixed `language` enum referenced by SCHEMA.md ("from a fixed list of 30").
// Detection maps a project to one of these slugs, or omits the field entirely.
// Changing this list is a schema change (see SCHEMA.md / CI drift guard).
export const LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'go',
  'rust',
  'java',
  'kotlin',
  'swift',
  'ruby',
  'php',
  'csharp',
  'cpp',
  'c',
  'scala',
  'elixir',
  'erlang',
  'haskell',
  'clojure',
  'dart',
  'lua',
  'r',
  'julia',
  'perl',
  'shell',
  'sql',
  'html',
  'css',
  'solidity',
  'zig',
  'ocaml',
] as const;

export type Language = (typeof LANGUAGES)[number];
