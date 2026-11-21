import { useCallback, useRef, useState } from 'react';

/** Layout state with undo/redo. `commit=false` updates without a history entry (used mid-drag). */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const set = useCallback((next: T | ((prev: T) => T), commit = true) => {
    const prev = stateRef.current;
    const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
    if (value === prev) return;
    if (commit) {
      past.current.push(prev);
      if (past.current.length > 200) past.current.shift();
      future.current = [];
    }
    stateRef.current = value;
    setState(value);
  }, []);

  /** Push the current state as an undo point (call at drag start, then set(..., false) while dragging). */
  const checkpoint = useCallback(() => {
    past.current.push(stateRef.current);
    future.current = [];
  }, []);

  const undo = useCallback(() => {
    const p = past.current.pop();
    if (p === undefined) return;
    future.current.push(stateRef.current);
    stateRef.current = p;
    setState(p);
  }, []);

  const redo = useCallback(() => {
    const f = future.current.pop();
    if (f === undefined) return;
    past.current.push(stateRef.current);
    stateRef.current = f;
    setState(f);
  }, []);

  /** Replace the state and forget undo history (switching to a different layout). */
  const reset = useCallback((value: T) => {
    past.current = [];
    future.current = [];
    stateRef.current = value;
    setState(value);
  }, []);

  return { state, set, reset, checkpoint, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
