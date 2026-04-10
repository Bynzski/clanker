import {
  Braces,
  Coffee,
  File,
  FileCode,
  FileDiff,
  FileTerminal,
  FileText,
  Hash,
  Image,
  Package,
  Settings,
} from 'lucide-react';

export type FileTypeIcon = typeof File;

// Re-export LucideIcon type for consumers
export type LucideIcon = FileTypeIcon;

export interface FileTypeConfig {
  Icon: LucideIcon;
  color: string;
}

const FILE_TYPE_MAP: Record<string, FileTypeConfig> = {
  // TypeScript / JavaScript
  ts: { Icon: FileCode, color: '#3178c6' },
  tsx: { Icon: FileCode, color: '#3178c6' },
  js: { Icon: FileCode, color: '#f7df1e' },
  jsx: { Icon: FileCode, color: '#61dafb' },
  mjs: { Icon: FileCode, color: '#f7df1e' },
  cjs: { Icon: FileCode, color: '#f7df1e' },

  // Data / Config
  json: { Icon: Braces, color: '#cbcb41' },
  yaml: { Icon: FileText, color: '#cb171e' },
  yml: { Icon: FileText, color: '#cb171e' },
  toml: { Icon: FileText, color: '#9c4221' },
  xml: { Icon: FileCode, color: '#e44d26' },
  csv: { Icon: FileText, color: '#89d185' },

  // Web
  html: { Icon: FileCode, color: '#e44d26' },
  css: { Icon: FileCode, color: '#1572b6' },
  scss: { Icon: FileCode, color: '#c6538c' },
  less: { Icon: FileCode, color: '#1d365d' },

  // Documentation
  md: { Icon: FileText, color: '#083fa1' },
  mdx: { Icon: FileText, color: '#fcb32c' },
  txt: { Icon: FileText, color: '#8b949e' },
  adoc: { Icon: FileText, color: '#e8e4e0' },

  // Images
  png: { Icon: Image, color: '#a855f7' },
  jpg: { Icon: Image, color: '#a855f7' },
  jpeg: { Icon: Image, color: '#a855f7' },
  gif: { Icon: Image, color: '#a855f7' },
  svg: { Icon: Image, color: '#ffb13b' },
  webp: { Icon: Image, color: '#a855f7' },
  ico: { Icon: Image, color: '#a855f7' },

  // Build / Package
  lock: { Icon: Hash, color: '#8b949e' },
  map: { Icon: File, color: '#8b949e' },

  // Shell
  sh: { Icon: FileTerminal, color: '#89e051' },
  bash: { Icon: FileTerminal, color: '#89e051' },
  zsh: { Icon: FileTerminal, color: '#89e051' },
  fish: { Icon: FileTerminal, color: '#89e051' },

  // Programming languages
  py: { Icon: FileCode, color: '#3572a5' },
  rs: { Icon: FileCode, color: '#dea584' },
  go: { Icon: FileCode, color: '#00add8' },
  rb: { Icon: FileCode, color: '#701516' },
  java: { Icon: Coffee, color: '#b07219' },
  c: { Icon: FileCode, color: '#555555' },
  h: { Icon: FileCode, color: '#555555' },
  cpp: { Icon: FileCode, color: '#f34b7d' },
  hpp: { Icon: FileCode, color: '#f34b7d' },

  // Config / Dotfiles
  env: { Icon: Settings, color: '#ecd53f' },
  gitignore: { Icon: FileDiff, color: '#f14e32' },
  editorconfig: { Icon: Settings, color: '#fff2f0' },
  prettierrc: { Icon: Settings, color: '#56b3b4' },
  eslintrc: { Icon: Settings, color: '#4b32c3' },
};

// Special filename matches (exact match, no extension)
// These take priority over extension-based lookups
const FILE_NAME_MAP: Record<string, FileTypeConfig> = {
  'package.json': { Icon: Package, color: '#cb3837' },
  'tsconfig.json': { Icon: Settings, color: '#3178c6' },
  'dockerfile': { Icon: Package, color: '#2496ed' },
  'makefile': { Icon: FileTerminal, color: '#6d8086' },
  'license': { Icon: FileText, color: '#d4a520' },
  'readme.md': { Icon: FileText, color: '#083fa1' },
  '.gitignore': { Icon: FileDiff, color: '#f14e32' },
  '.env': { Icon: Settings, color: '#ecd53f' },
  '.env.local': { Icon: Settings, color: '#ecd53f' },
  '.editorconfig': { Icon: Settings, color: '#fff2f0' },
};

const DEFAULT_FILE_CONFIG: FileTypeConfig = { Icon: File, color: '#8b949e' };

export function getFileTypeConfig(fileName: string): FileTypeConfig {
  // Check exact filename first (case-insensitive)
  const lowerName = fileName.toLowerCase();
  if (FILE_NAME_MAP[lowerName] !== undefined) {
    return FILE_NAME_MAP[lowerName];
  }

  // Then check extension
  const dotIndex = lowerName.lastIndexOf('.');
  if (dotIndex > 0) {
    const ext = lowerName.slice(dotIndex + 1);
    if (FILE_TYPE_MAP[ext] !== undefined) {
      return FILE_TYPE_MAP[ext];
    }
  }

  return DEFAULT_FILE_CONFIG;
}
