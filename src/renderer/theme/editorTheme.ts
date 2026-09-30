import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { oneDark } from '@codemirror/theme-one-dark';
import type { ThemeId } from '../../shared/types/theme';

// Preserve the Clanker Dark surfaces previously imposed by component CSS,
// while leaving One Dark's syntax and interaction palette intact.
const darkSurface = EditorView.theme({
  '&': { backgroundColor: '#121212' },
  '.cm-scroller': { backgroundColor: '#121212' },
  '.cm-gutters': { backgroundColor: '#121212', borderRight: '1px solid rgba(255, 255, 255, 0.05)' },
}, { dark: true });

const lightUI = EditorView.theme({
  '&': { color: '#202630', backgroundColor: '#f3f4f6' },
  '.cm-content': { caretColor: '#245da8' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#245da8' },
  '.cm-gutters': { color: '#626d7b', backgroundColor: '#e9edf2', borderRight: '1px solid #d1d8e1' },
  '.cm-activeLine': { backgroundColor: '#e5ecf5' },
  '.cm-activeLineGutter': { color: '#202630', backgroundColor: '#dce6f3' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#bed5f2' },
  '.cm-selectionMatch': { backgroundColor: '#d6e5d2' },
  '.cm-searchMatch': { backgroundColor: '#f2e4b9', outline: '1px solid #886300' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#e6d391' },
  '.cm-matchingBracket': { backgroundColor: '#d4deeb' },
  '.cm-nonmatchingBracket': { backgroundColor: '#f2cece' },
  '.cm-panels, .cm-tooltip': { color: '#202630', backgroundColor: '#e9edf2', border: '1px solid #d1d8e1' },
  '.cm-tooltip .cm-tooltip-arrow:before': { borderTopColor: '#d1d8e1', borderBottomColor: '#d1d8e1' },
  '.cm-tooltip .cm-tooltip-arrow:after': { borderTopColor: '#e9edf2', borderBottomColor: '#e9edf2' },
  '.cm-foldPlaceholder': { color: '#525e6d', backgroundColor: '#e9edf2', border: '1px solid #d1d8e1' },
}, { dark: false });

const lightSyntax = HighlightStyle.define([
  { tag: tags.comment, color: '#626d7b', fontStyle: 'italic' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: '#236b35' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.literal], color: '#795600' },
  { tag: [tags.keyword, tags.modifier], color: '#7840a0' },
  { tag: [tags.variableName, tags.propertyName], color: '#202630' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#245da8' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], color: '#176b78' },
  { tag: [tags.attributeName, tags.definition(tags.propertyName)], color: '#795600' },
  { tag: [tags.operator, tags.punctuation, tags.meta], color: '#525e6d' },
  { tag: tags.heading, color: '#245da8', fontWeight: 'bold' },
  { tag: [tags.link, tags.url], color: '#245da8', textDecoration: 'underline' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.invalid, color: '#a32929' },
]);

// GitHub Dark Dimmed syntax with readable comments and Clanker interactions.
const slateUI = EditorView.theme({
  '&': { color: '#adbac7', backgroundColor: '#22272e' },
  '.cm-content': { caretColor: '#6cb6ff' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#6cb6ff' },
  '.cm-gutters': { color: '#909dab', backgroundColor: '#22272e', borderRight: '1px solid #373e47' },
  '.cm-activeLine': { backgroundColor: '#2d333b' },
  '.cm-activeLineGutter': { color: '#cdd9e5', backgroundColor: '#2d333b' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#384e6b' },
  '.cm-selectionMatch': { backgroundColor: '#344e3d' },
  '.cm-searchMatch': { backgroundColor: '#574522', outline: '1px solid #daaa3f' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#735722' },
  '.cm-matchingBracket': { backgroundColor: '#344e3d' },
  '.cm-nonmatchingBracket': { backgroundColor: '#643535' },
  '.cm-panels, .cm-tooltip': { color: '#adbac7', backgroundColor: '#2d333b', border: '1px solid #444c56' },
  '.cm-tooltip .cm-tooltip-arrow:before': { borderTopColor: '#444c56', borderBottomColor: '#444c56' },
  '.cm-tooltip .cm-tooltip-arrow:after': { borderTopColor: '#2d333b', borderBottomColor: '#2d333b' },
  '.cm-foldPlaceholder': { color: '#909dab', backgroundColor: '#2d333b', border: '1px solid #444c56' },
}, { dark: true });

const slateSyntax = HighlightStyle.define([
  { tag: tags.comment, color: '#909dab', fontStyle: 'italic' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: '#96d0ff' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.literal], color: '#6cb6ff' },
  { tag: [tags.keyword, tags.modifier], color: '#f47067' },
  { tag: [tags.variableName, tags.propertyName], color: '#adbac7' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#dcbdfb' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#f69d50' },
  { tag: tags.tagName, color: '#8ddb8c' },
  { tag: [tags.attributeName, tags.definition(tags.propertyName)], color: '#6cb6ff' },
  { tag: [tags.operator, tags.punctuation, tags.meta], color: '#adbac7' },
  { tag: tags.heading, color: '#6cb6ff', fontWeight: 'bold' },
  { tag: [tags.link, tags.url], color: '#96d0ff', textDecoration: 'underline' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.invalid, color: '#ff938a' },
]);

const EDITOR_THEMES: Readonly<Record<ThemeId, readonly Extension[]>> = {
  dark: Object.freeze([darkSurface, oneDark]),
  light: Object.freeze([lightUI, syntaxHighlighting(lightSyntax)]),
  slate: Object.freeze([slateUI, syntaxHighlighting(slateSyntax)]),
};

/** A fresh extension list protects the canonical configuration from callers. */
export function getEditorTheme(theme: ThemeId): Extension {
  return [...EDITOR_THEMES[theme]];
}
