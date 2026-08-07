/**
 * EJSTemplateLibrary — Browsable template library with preview and customization
 * Phase 3: Advanced template browsing, preview, and insertion.
 */

import { useState, useMemo, useCallback } from 'react';
import {
  BookOpen, Copy, Check, Plus,
  Search, Eye, EyeOff, Star,
} from 'lucide-react';
import { EJS_ADVANCED_TEMPLATES, type EJSAdvancedTemplate } from './ejsSnippets';
import { t as ui } from '../../i18n';
import { copyWithToast } from '../../lib/copyToClipboard';   // (bug 224) copy chạy được cả trong iframe của Hub
import { useToastStore } from '../../store/toastStore';

interface EJSTemplateLibraryProps {
  onInsertCode: (code: string) => void;
}

type LibraryCategory = 'all' | 'flow' | 'ui' | 'mvu' | 'event' | 'advanced';

const CATEGORIES: { id: LibraryCategory; label: string; emoji: string }[] = [
  { id: 'all', label: ui.etAll, emoji: '📚' },
  { id: 'flow', label: 'Control Flow', emoji: '🔀' },
  { id: 'ui', label: 'UI / Display', emoji: '🎨' },
  { id: 'mvu', label: 'MVU / State', emoji: '📊' },
  { id: 'event', label: 'Events', emoji: '⚡' },
  { id: 'advanced', label: ui.etAdvanced, emoji: '🔧' },
];

export function EJSTemplateLibrary({ onInsertCode }: EJSTemplateLibraryProps) {
  const [selectedCategory, setSelectedCategory] = useState<LibraryCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('ejs_template_favorites');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  // Filter templates
  const filteredTemplates = useMemo(() => {
    let templates = EJS_ADVANCED_TEMPLATES;

    if (selectedCategory !== 'all') {
      templates = templates.filter(t => t.category === selectedCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      templates = templates.filter(t =>
        t.label.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q))
      );
    }

    // Sort: favorites first
    return [...templates].sort((a, b) => {
      const aFav = favorites.has(a.id) ? 0 : 1;
      const bFav = favorites.has(b.id) ? 0 : 1;
      return aFav - bFav;
    });
  }, [selectedCategory, searchQuery, favorites]);

  const handleCopy = useCallback((template: EJSAdvancedTemplate) => {
    void copyWithToast(template.code, 'code mẫu', useToastStore.getState());
    setCopiedId(template.id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem('ejs_template_favorites', JSON.stringify([...next])); } catch { /* */ }
      return next;
    });
  }, []);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="text-xs font-semibold flex items-center gap-1.5 mb-1">
        <BookOpen className="w-3.5 h-3.5 text-amber-400" />
        Template Library
        <span className="text-[9px] text-muted-foreground font-normal ml-auto">
          {filteredTemplates.length} templates
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-3 h-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={ui.etSearchPh}
          className="w-full pl-6 pr-2 py-1.5 text-[10px] rounded-md border border-border bg-background
            focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/40"
        />
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
              selectedCategory === cat.id
                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                : 'text-muted-foreground hover:text-foreground border border-transparent'
            }`}
          >
            {cat.emoji} {cat.label}
          </button>
        ))}
      </div>

      {/* Template list */}
      <div className="space-y-1.5">
        {filteredTemplates.map(template => (
          <div
            key={template.id}
            className="rounded-lg border border-border overflow-hidden hover:border-amber-500/30 transition-colors"
          >
            {/* Template header */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-muted/10">
              <button
                onClick={() => toggleFavorite(template.id)}
                className="shrink-0"
                title={favorites.has(template.id) ? ui.etUnfavorite : ui.etFavorite}
              >
                <Star className={`w-3 h-3 ${
                  favorites.has(template.id) ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30'
                }`} />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium truncate">{template.label}</p>
                <p className="text-[9px] text-muted-foreground truncate">{template.description}</p>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => setPreviewId(previewId === template.id ? null : template.id)}
                  className="p-1 rounded hover:bg-muted/30 transition-colors"
                  title="Preview"
                >
                  {previewId === template.id
                    ? <EyeOff className="w-3 h-3 text-muted-foreground" />
                    : <Eye className="w-3 h-3 text-muted-foreground" />}
                </button>
                <button
                  onClick={() => handleCopy(template)}
                  className="p-1 rounded hover:bg-muted/30 transition-colors"
                  title="Copy"
                >
                  {copiedId === template.id
                    ? <Check className="w-3 h-3 text-green-400" />
                    : <Copy className="w-3 h-3 text-muted-foreground" />}
                </button>
                <button
                  onClick={() => onInsertCode(template.code)}
                  className="p-1 rounded hover:bg-muted/30 transition-colors"
                  title={ui.etInsert}
                >
                  <Plus className="w-3 h-3 text-primary" />
                </button>
              </div>
            </div>

            {/* Tags */}
            {template.tags.length > 0 && (
              <div className="px-2.5 py-1 flex flex-wrap gap-0.5 border-t border-border/50">
                {template.tags.map(tag => (
                  <span key={tag} className="text-[8px] px-1 py-0.5 rounded bg-muted/30 text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Preview (collapsible) */}
            {previewId === template.id && (
              <div className="border-t border-border">
                <pre className="px-2.5 py-2 text-[9px] font-mono leading-relaxed overflow-x-auto max-h-40 overflow-y-auto scrollbar-thin bg-background/50">
                  {template.code}
                </pre>
              </div>
            )}
          </div>
        ))}

        {filteredTemplates.length === 0 && (
          <p className="text-[10px] text-muted-foreground/50 text-center py-4">
            {ui.etNoMatch}
          </p>
        )}
      </div>
    </div>
  );
}
