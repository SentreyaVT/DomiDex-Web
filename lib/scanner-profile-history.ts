import type { ScannerProfileVersion } from './scanner-profile';

interface ProfileHistory { present: ScannerProfileVersion; past: ScannerProfileVersion[]; future: ScannerProfileVersion[]; saved: string; group?: string; }
type Action = { type: 'replace' | 'edit'; value: ScannerProfileVersion; group?: string } | { type: 'undo' | 'redo' };

export function profileHistoryReducer(state: ProfileHistory, action: Action): ProfileHistory {
  if (action.type === 'replace') return { present: action.value, past: [], future: [], saved: JSON.stringify(action.value) };
  if (action.type === 'edit') {
    if (JSON.stringify(state.present) === JSON.stringify(action.value)) return state;
    return { ...state, group: action.group, past: action.group && state.group === action.group ? state.past : [...state.past, state.present].slice(-80), present: action.value, future: [] };
  }
  if (action.type === 'undo' && state.past.length) return {
    ...state, group: undefined, past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future].slice(0, 80),
  };
  if (action.type === 'redo' && state.future.length) return {
    ...state, group: undefined, past: [...state.past, state.present].slice(-80), present: state.future[0], future: state.future.slice(1),
  };
  return state;
}
