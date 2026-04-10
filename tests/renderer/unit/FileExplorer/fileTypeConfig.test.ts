import { describe, it, expect } from 'vitest';
import { getFileTypeConfig } from '../../../../src/renderer/components/FileExplorer/fileTypeConfig';
import { FileCode, FileText, Image, Package, Settings, FileDiff, Coffee, FileTerminal, Braces, File, Hash } from 'lucide-react';

describe('getFileTypeConfig', () => {
  describe('extension lookup', () => {
    it("returns FileCode with #3178c6 for TypeScript files", () => {
      const config = getFileTypeConfig('index.ts');
      expect(config.Icon).toBe(FileCode);
      expect(config.color).toBe('#3178c6');
    });

    it("returns FileCode with #3178c6 for TSX files", () => {
      const config = getFileTypeConfig('App.tsx');
      expect(config.Icon).toBe(FileCode);
      expect(config.color).toBe('#3178c6');
    });

    it("returns FileCode with #f7df1e for JavaScript files", () => {
      const config = getFileTypeConfig('script.js');
      expect(config.Icon).toBe(FileCode);
      expect(config.color).toBe('#f7df1e');
    });

    it("returns Braces with #cbcb41 for JSON files", () => {
      const config = getFileTypeConfig('data.json');
      expect(config.Icon).toBe(Braces);
      expect(config.color).toBe('#cbcb41');
    });

    it("returns FileText with #083fa1 for Markdown files", () => {
      const config = getFileTypeConfig('README.md');
      expect(config.Icon).toBe(FileText);
      expect(config.color).toBe('#083fa1');
    });

    it("returns FileCode with #e44d26 for HTML files", () => {
      const config = getFileTypeConfig('index.html');
      expect(config.Icon).toBe(FileCode);
      expect(config.color).toBe('#e44d26');
    });

    it("returns FileCode with #1572b6 for CSS files", () => {
      const config = getFileTypeConfig('style.css');
      expect(config.Icon).toBe(FileCode);
      expect(config.color).toBe('#1572b6');
    });

    it("returns Image with #a855f7 for PNG files", () => {
      const config = getFileTypeConfig('image.png');
      expect(config.Icon).toBe(Image);
      expect(config.color).toBe('#a855f7');
    });

    it("returns Image with #ffb13b for SVG files", () => {
      const config = getFileTypeConfig('icon.svg');
      expect(config.Icon).toBe(Image);
      expect(config.color).toBe('#ffb13b');
    });

    it("returns FileTerminal with #89e051 for shell scripts", () => {
      const config = getFileTypeConfig('deploy.sh');
      expect(config.Icon).toBe(FileTerminal);
      expect(config.color).toBe('#89e051');
    });

    it("returns Coffee with #b07219 for Java files", () => {
      const config = getFileTypeConfig('Main.java');
      expect(config.Icon).toBe(Coffee);
      expect(config.color).toBe('#b07219');
    });

    it("returns FileCode with #3572a5 for Python files", () => {
      const config = getFileTypeConfig('main.py');
      expect(config.Icon).toBe(FileCode);
      expect(config.color).toBe('#3572a5');
    });

    it("returns FileCode with #dea584 for Rust files", () => {
      const config = getFileTypeConfig('lib.rs');
      expect(config.Icon).toBe(FileCode);
      expect(config.color).toBe('#dea584');
    });

    it("returns FileCode with #00add8 for Go files", () => {
      const config = getFileTypeConfig('main.go');
      expect(config.Icon).toBe(FileCode);
      expect(config.color).toBe('#00add8');
    });

    it("returns Hash with #8b949e for lock files", () => {
      // 'yarn.lock' → lastIndexOf('.') = 4, ext = 'lock'
      const config = getFileTypeConfig('yarn.lock');
      expect(config.Icon).toBe(Hash);
      expect(config.color).toBe('#8b949e');
    });

    it("returns FileCode with #555555 for C header files", () => {
      const config = getFileTypeConfig('types.h');
      expect(config.Icon).toBe(FileCode);
      expect(config.color).toBe('#555555');
    });

    it("returns FileCode with #f34b7d for C++ files", () => {
      const config = getFileTypeConfig('main.cpp');
      expect(config.Icon).toBe(FileCode);
      expect(config.color).toBe('#f34b7d');
    });

    it("returns Settings with #ecd53f for env files", () => {
      const config = getFileTypeConfig('.env');
      expect(config.Icon).toBe(Settings);
      expect(config.color).toBe('#ecd53f');
    });

    it("returns FileDiff with #f14e32 for gitignore", () => {
      const config = getFileTypeConfig('.gitignore');
      expect(config.Icon).toBe(FileDiff);
      expect(config.color).toBe('#f14e32');
    });
  });

  describe('case-insensitivity', () => {
    it("handles uppercase TypeScript extension", () => {
      const config = getFileTypeConfig('INDEX.TS');
      expect(config.Icon).toBe(FileCode);
      expect(config.color).toBe('#3178c6');
    });

    it("handles mixed-case TypeScript extension", () => {
      const config = getFileTypeConfig('app.Tsx');
      expect(config.Icon).toBe(FileCode);
      expect(config.color).toBe('#3178c6');
    });

    it("handles uppercase filename for package.json", () => {
      const config = getFileTypeConfig('PACKAGE.JSON');
      expect(config.Icon).toBe(Package);
      expect(config.color).toBe('#cb3837');
    });

    it("handles mixed-case filename for Dockerfile", () => {
      const config = getFileTypeConfig('DOCKERFILE');
      // 'dockerfile' is not in FILE_NAME_MAP (only lowercase), so it falls to extension lookup
      // 'dockerfile' → dotIndex = -1, so no extension → DEFAULT_FILE_CONFIG
      // Wait, the plan says 'dockerfile' → Package. Let me check the plan again.
      // In the plan's FILE_NAME_MAP, 'dockerfile' is there without extension.
      // 'DOCKERFILE'.toLowerCase() = 'dockerfile', and 'dockerfile' IS in FILE_NAME_MAP.
      expect(config.Icon).toBe(Package);
      expect(config.color).toBe('#2496ed');
    });
  });

  describe('filename priority over extension', () => {
    it("returns Package icon for package.json (not Braces from .json)", () => {
      const config = getFileTypeConfig('package.json');
      expect(config.Icon).toBe(Package);
      expect(config.color).toBe('#cb3837');
    });

    it("returns Settings icon for tsconfig.json (not FileCode from .json)", () => {
      const config = getFileTypeConfig('tsconfig.json');
      expect(config.Icon).toBe(Settings);
      expect(config.color).toBe('#3178c6');
    });

    it("returns FileDiff icon for .gitignore (not Settings from .env)", () => {
      const config = getFileTypeConfig('.gitignore');
      expect(config.Icon).toBe(FileDiff);
      expect(config.color).toBe('#f14e32');
    });
  });

  describe('default config', () => {
    it("returns default config for unknown extension", () => {
      const config = getFileTypeConfig('document.pdf');
      expect(config.Icon).toBe(File);
      expect(config.color).toBe('#8b949e');
    });

    it("returns default config for no extension", () => {
      // 'Makefile' matches FILE_NAME_MAP['makefile'] → FileTerminal
      // Test a truly no-extension filename that isn't in FILE_NAME_MAP
      const config = getFileTypeConfig('Rakefile');
      expect(config.Icon).toBe(File);
      expect(config.color).toBe('#8b949e');
    });

    it("returns default config for hidden file with no extension", () => {
      const config = getFileTypeConfig('.bashrc');
      // '.bashrc' → dotIndex = 0, ext would be 'bashrc' which is not in FILE_TYPE_MAP
      // and '.bashrc' is not in FILE_NAME_MAP, so DEFAULT
      expect(config.Icon).toBe(File);
      expect(config.color).toBe('#8b949e');
    });
  });

  describe('distinct extension coverage', () => {
    it("covers at least 8 distinct file type categories", () => {
      const testCases = [
        { file: 'a.ts', expectedIcon: FileCode },
        { file: 'a.json', expectedIcon: Braces },
        { file: 'a.md', expectedIcon: FileText },
        { file: 'a.png', expectedIcon: Image },
        { file: 'a.sh', expectedIcon: FileTerminal },
        { file: 'a.java', expectedIcon: Coffee },
        { file: 'a.yaml', expectedIcon: FileText },
        { file: 'a.lock', expectedIcon: Hash },
        { file: 'a.env', expectedIcon: Settings },
        { file: 'a.adoc', expectedIcon: FileText },
      ];

      const results = testCases.map(({ file, expectedIcon }) => ({
        file,
        match: getFileTypeConfig(file).Icon === expectedIcon,
      }));

      const failures = results.filter(r => !r.match);
      expect(failures).toHaveLength(0);
    });
  });
});
