import { useCallback, useRef, useState } from 'react';
import { useStore } from '../store';
import { validateCard, getCardSummary, extractTranslatableFields } from '../utils/cardFields';
import { extractCharaFromPNG } from '../utils/pngHandler';
import { isWorldbookFormat, worldbookToCard, getWorldbookSummary } from '../utils/worldbookParser';
import type { CharacterCard, FieldGroup, FieldGroupConfig } from '../types/card';
import CardParserWorker from '../workers/cardParser.worker.ts?worker';

export function useCardParser() {
  const { setCard, addToast, clearCard } = useStore();
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState<{ stage: string; percent: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Get or create the shared worker instance
  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new CardParserWorker();
    }
    return workerRef.current;
  }, []);

  const parseCardFile = useCallback(
    async (file: File) => {
      const isPng = file.name.toLowerCase().endsWith('.png');
      const isJson = file.name.toLowerCase().endsWith('.json');

      if (!isJson && !isPng) {
        addToast('error', 'Only .json and .png files are accepted');
        return null;
      }

      // For small files (<2MB), parse on main thread (worker overhead not worth it)
      const WORKER_THRESHOLD = 2 * 1024 * 1024; // 2MB

      if (file.size < WORKER_THRESHOLD) {
        return parseOnMainThread(file);
      }

      // Large files → use Web Worker
      setIsParsing(true);
      setParseProgress({ stage: 'reading', percent: 0 });

      try {
        const buffer = await file.arrayBuffer();
        const worker = getWorker();

        // Get enabled groups for field extraction in worker
        const enabledGroups = useStore.getState().translationConfig.fieldGroups
          .filter((g: FieldGroupConfig) => g.enabled)
          .map((g: FieldGroupConfig) => g.id) as FieldGroup[];

        const result = await new Promise<any>((resolve, reject) => {
          const requestId = crypto.randomUUID();

          const handler = (e: MessageEvent) => {
            const data = e.data;
            if (data.id !== requestId) return;

            if (data.type === 'progress') {
              setParseProgress(data.progress);
              return;
            }

            worker.removeEventListener('message', handler);

            if (data.type === 'error') {
              reject(new Error(data.error));
              return;
            }

            resolve(data);
          };

          worker.addEventListener('message', handler);

          // Transfer ArrayBuffer to worker (zero-copy)
          worker.postMessage(
            { type: 'parse', id: requestId, buffer, fileName: file.name, enabledGroups },
            [buffer]
          );
        });

        // Convert Blob to Blob URL on main thread
        let blobUrl: string | null = null;
        if (result.pngBlob) {
          blobUrl = URL.createObjectURL(result.pngBlob);
        }

        // Store the original ArrayBuffer reference for PNG export
        if (isPng && result.pngBlob) {
          useStore.getState()._pngArrayBuffer = await result.pngBlob.arrayBuffer();
        } else {
          useStore.getState()._pngArrayBuffer = null;
        }

        setCard(result.card, file.name, blobUrl, result.contentType, result.originalWorldbook);

        // Set pre-extracted fields if available
        if (result.fields && result.fields.length > 0) {
          useStore.getState().setFields(result.fields);
        }

        addToast('success', result.toastMessage || `Loaded: ${file.name}`);
        return result.card;

      } catch (err) {
        addToast('error', `Failed to parse: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      } finally {
        setIsParsing(false);
        setParseProgress(null);
      }
    },
    [setCard, addToast, getWorker]
  );

  // Original main-thread parsing for small files
  const parseOnMainThread = useCallback(
    async (file: File) => {
      const isPng = file.name.toLowerCase().endsWith('.png');

      try {
        let text = '';
        let dataUrl: string | null = null;
        if (isPng) {
          try {
            const extracted = await extractCharaFromPNG(file);
            text = extracted.json;
            dataUrl = extracted.dataUrl;
          } catch (e) {
            addToast('error', 'Failed to extract character data from PNG');
            return null;
          }
        } else {
          text = await file.text();
        }

        const json = JSON.parse(text);
        const validation = validateCard(json);

        if (!validation.valid) {
          if (isWorldbookFormat(json)) {
            const wbSummary = getWorldbookSummary(json);
            const pseudoCard = worldbookToCard(json, file.name);
            setCard(pseudoCard, file.name, dataUrl, 'worldbook', json);
            addToast('success', `📖 Loaded Worldbook: ${wbSummary.name} (${wbSummary.entryCount} entries, ${wbSummary.withContent} with content)`);
            return pseudoCard;
          }
          addToast('error', validation.error || 'Invalid card format');
          return null;
        }

        const card = json as CharacterCard;
        const summary = getCardSummary(card);
        
        useStore.getState()._pngArrayBuffer = null;
        setCard(card, file.name, dataUrl, 'card', null);
        addToast('success', `Loaded: ${summary.name} (${summary.lorebookCount} lorebook entries)`);
        return card;
      } catch (err) {
        addToast('error', `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
    [setCard, addToast]
  );

  const updateCardFromOriginal = useCallback(
    async (file: File) => {
      const isPng = file.name.toLowerCase().endsWith('.png');
      const isJson = file.name.toLowerCase().endsWith('.json');

      if (!isJson && !isPng) {
        addToast('error', 'Only .json and .png files are accepted');
        return null;
      }

      try {
        let text = '';
        let dataUrl: string | null = null;
        if (isPng) {
          try {
            const extracted = await extractCharaFromPNG(file);
            text = extracted.json;
            dataUrl = extracted.dataUrl;
          } catch (e) {
            addToast('error', 'Failed to extract character data from PNG');
            return null;
          }
        } else {
          text = await file.text();
        }

        const json = JSON.parse(text);
        const validation = validateCard(json);

        if (!validation.valid) {
          addToast('error', validation.error || 'Invalid card format');
          return null;
        }

        const newCard = json as CharacterCard;
        const currentFields = useStore.getState().fields;
        
        if (currentFields.length === 0) {
          addToast('error', 'No existing translations to update from. Please load a translated card first.');
          return null;
        }

        // Dynamically import extractTranslatableFields to avoid circular deps if any,
        // or just use it if imported. We'll import it at the top of the file.
        const { extractTranslatableFields } = await import('../utils/cardFields');
        
        // Extract all fields from the NEW card
        const allGroups = ['core', 'messages', 'system', 'creator', 'lorebook', 'lorebook_keys', 'regex', 'depth_prompt', 'tavern_helper'] as any;
        const newFields = extractTranslatableFields(newCard, allGroups);
        
        // Merge strategy:
        // For each new field, find the corresponding field in currentFields by path.
        // If current field is found and has a translation:
        // - If new original == old original: set as 'done', copy translated text.
        // - If new original != old original: set as 'pending', but store old translated text in `previousTranslation`.
        let matchedCount = 0;
        let updatedCount = 0;

        const mergedFields = newFields.map(nf => {
          const cf = currentFields.find(f => f.path === nf.path);
          if (cf && (cf.status === 'done' || cf.status === 'skipped')) {
            if (cf.original === nf.original) {
              matchedCount++;
              return { ...nf, status: cf.status, translated: cf.translated };
            } else {
              // The text changed! Set to pending but keep the old translation as reference.
              updatedCount++;
              return { ...nf, status: 'pending' as const, previousTranslation: cf.translated };
            }
          }
          return nf;
        });

        setCard(newCard, file.name, dataUrl);
        useStore.getState().setFields(mergedFields);
        useStore.getState().setPhase('idle');
        
        addToast('success', `Updated Card: ${matchedCount} fields unchanged, ${updatedCount} fields modified/new.`);
        return newCard;
      } catch (err) {
        addToast('error', `Failed to update: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
    [setCard, addToast]
  );

  return { parseCardFile, clearCard, updateCardFromOriginal, isParsing, parseProgress };
}
