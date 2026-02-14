import { createContext, useCallback, useContext, useRef, useState } from 'react';

const PROJECT_ID_KEY = 'memory-mcp-project-id';
const PROJECT_NAME_KEY = 'memory-mcp-project-name';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [projectId, _setProjectId] = useState(() => localStorage.getItem(PROJECT_ID_KEY) || '');
  const [projectName, _setProjectName] = useState(() => localStorage.getItem(PROJECT_NAME_KEY) || '');
  const [loading, setLoading] = useState(false);
  const [toast, setToastState] = useState(null);
  const timerRef = useRef(null);

  const setProject = useCallback((id, name) => {
    _setProjectId(id);
    _setProjectName(name);
    localStorage.setItem(PROJECT_ID_KEY, id);
    localStorage.setItem(PROJECT_NAME_KEY, name);
  }, []);

  const showToast = useCallback((message, type = 'error') => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToastState({ message, type });
    timerRef.current = setTimeout(() => setToastState(null), 3500);
  }, []);

  const projectConfig = useCallback(() => ({ projectId }), [projectId]);

  return (
    <AppContext.Provider value={{
      projectId, projectName, setProject, projectConfig,
      loading, setLoading,
      toast, showToast,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
