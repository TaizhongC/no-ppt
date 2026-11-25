import { useReducer } from 'react'

const initial = { past: [], project: null, future: [], group: null, time: 0 }

function reduce(state, action) {
  const { project, past, future } = state
  switch (action.type) {
    case 'load': return { ...initial, project: action.project }
    case 'edit': {
      const next = action.apply(project)
      if (next === project) return state
      const merge = action.group && action.group === state.group && action.time - state.time < 700
      return { project: next, past: merge ? past : [...past.slice(-79), project], future: [],
        group: action.group, time: action.time }
    }
    case 'undo': return past.length
      ? { ...initial, project: past.at(-1), past: past.slice(0, -1), future: [project, ...future] } : state
    case 'redo': return future.length
      ? { ...initial, project: future[0], past: [...past, project], future: future.slice(1) } : state
    default: return state
  }
}

export function useProjectHistory() {
  const [state, dispatch] = useReducer(reduce, initial)
  return {
    project: state.project, canUndo: state.past.length > 0, canRedo: state.future.length > 0,
    load: project => dispatch({ type: 'load', project }),
    edit: (apply, group) => dispatch({ type: 'edit', apply, group, time: Date.now() }),
    undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }),
  }
}
