import React, { useState, useRef } from 'react';
import { useApp } from './storeContext';
import { ChatWindow } from './components/ChatWindow';
import { SettingsModal } from './components/SettingsModal';
import { StepParameters } from './components/StepParameters';
import { StepPrompts } from './components/StepPrompts';
import { StepTemplate } from './components/StepTemplate';
import { StepRegex } from './components/StepRegex';
import { StepExport } from './components/StepExport';
import {
  Settings as SettingsIcon,
  Sparkles, 
  FolderPlus, 
  Trash2, 
  BookOpen, 
  FileText, 
  FolderOpen,
  Menu,
  X,
  Upload
} from 'lucide-react';
import { t, fmt } from './i18n';

function App() {
  const {
    projects,
    activeProjectId,
    activeStep,
    appMode,
    toasts,
    removeToast,
    setActiveProjectId,
    createNewProject,
    importProjectFromFile,
    deleteProject,
    setActiveStep,
    setAppMode,
    updateProjectName,
    addToast
  } = useApp();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [editingProjId, setEditingProjId] = useState<string | null>(null);
  const [editProjName, setEditProjName] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Dynamic Accent colors based on current mode
  const accentColor = appMode === 'preset' ? 'purple' : 'cyan';
  
  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName.trim()) return;
    createNewProject(newProjName.trim());
    setNewProjName('');
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.json')) {
      addToast(t.toastOnlyJson, "error");
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const content = ev.target?.result as string;
        const parsed = JSON.parse(content);
        importProjectFromFile(parsed, file.name);
      } catch {
        addToast(fmt(t.toastBadJson, { name: file.name }), "error");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleStartRename = (id: string, name: string) => {
    setEditingProjId(id);
    setEditProjName(name);
  };

  const handleSaveRename = (id: string) => {
    if (editProjName.trim()) {
      updateProjectName(id, editProjName.trim());
      setEditingProjId(null);
    }
  };

  return (
    <div className="h-screen max-h-screen bg-theme-bg text-gray-200 flex flex-col font-sans overflow-hidden selection:bg-purple-500/30 selection:text-purple-200">
      
      {/* 1. Header component */}
      <header className="h-14 border-b border-theme-border bg-gray-900/80 backdrop-blur-md flex items-center justify-between px-4 sm:px-6 sticky top-0 z-40 transition-colors duration-300">
        
        {/* Logo and Mobile Menu toggle */}
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition"
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          
          <div className="flex items-center gap-2">
            <div className={`p-1.5 bg-${accentColor}-500/15 rounded-lg border border-${accentColor}-500/30 text-${accentColor}-400 shadow-lg shadow-${accentColor}-500/5`}>
              <Sparkles size={16} />
            </div>
            <span className="font-bold text-sm sm:text-base tracking-tight text-white flex items-center gap-1">
              ST Studio <span className={`text-[10px] bg-${accentColor}-500/20 px-1.5 py-0.5 rounded-full border border-${accentColor}-500/40 text-${accentColor}-300 font-bold uppercase`}>Beta</span>
            </span>
          </div>
        </div>

        {/* Mode switcher and Cài đặt icon */}
        <div className="flex items-center gap-4">
          
          {/* Active Preset / Regex Mode Selector */}
          <div className="flex bg-gray-950 p-0.5 rounded-lg border border-theme-border text-[10px] sm:text-xs font-bold text-gray-400">
            <button
              onClick={() => setAppMode('preset')}
              className={`px-3 py-1.5 rounded-md transition ${
                appMode === 'preset'
                  ? 'bg-purple-500 text-white'
                  : 'hover:text-gray-200'
              }`}
            >
              {t.presetMode}
            </button>
            <button
              onClick={() => setAppMode('regex')}
              className={`px-3 py-1.5 rounded-md transition ${
                appMode === 'regex'
                  ? 'bg-cyan-500 text-white'
                  : 'hover:text-gray-200'
              }`}
            >
              {t.regexMode}
            </button>
          </div>

          {/* Settings button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1 bg-gray-900 border border-theme-border hover:border-gray-700 text-gray-300 font-semibold text-xs px-3 py-2 rounded-lg transition"
          >
            <SettingsIcon size={14} className="text-gray-400 animate-spin-slow" />
            <span className="hidden sm:inline">{t.settings}</span>
          </button>
        </div>
      </header>

      {/* 2. Main content wrap (Sidebar + Workspace Split + Chat) */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* LEFT SIDEBAR: Projects index */}
        <aside className={`w-[260px] border-r border-theme-border bg-gray-900/30 flex flex-col flex-shrink-0 absolute md:static top-0 bottom-0 left-0 z-30 transition-transform duration-300 md:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0 bg-theme-panel/95 backdrop-blur-md' : '-translate-x-full'
        }`}>
          {/* Create new project form */}
          <form onSubmit={handleCreateProject} className="p-4 border-b border-theme-border/60">
            <div className="flex gap-2">
              <input
                type="text"
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
                placeholder={t.newProjectPh}
                className="flex-1 bg-gray-900 border border-theme-border rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-400"
              />
              <button
                type="submit"
                className="p-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition"
                title={t.newProjectTitle}
              >
                <FolderPlus size={14} />
              </button>
              <button
                type="button"
                onClick={() => importFileRef.current?.click()}
                className="p-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition"
                title={t.importProjectTitle}
              >
                <Upload size={14} />
              </button>
              <input
                ref={importFileRef}
                type="file"
                accept=".json"
                onChange={handleImportFile}
                className="hidden"
              />
            </div>
          </form>

          {/* Projects lists */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <span className="block text-[10px] text-gray-500 font-bold uppercase tracking-wider px-2 pb-1">
              {fmt(t.savedProjects, { count: projects.length })}
            </span>

            <div className="space-y-1">
              {projects.map((proj) => {
                const isActive = proj.id === activeProjectId;
                const isEditing = editingProjId === proj.id;

                return (
                  <div
                    key={proj.id}
                    className={`flex items-center justify-between p-2 rounded-xl group transition ${
                      isActive
                        ? `bg-${accentColor}-500/10 border border-${accentColor}-500/30 text-${accentColor}-400`
                        : 'border border-transparent hover:bg-gray-800/40 text-gray-400'
                    }`}
                  >
                    <div 
                      onClick={() => {
                        if (!isEditing) {
                          setActiveProjectId(proj.id);
                          setMobileMenuOpen(false);
                        }
                      }}
                      className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                    >
                      <FolderOpen size={14} className={isActive ? `text-${accentColor}-400` : 'text-gray-500'} />
                      {isEditing ? (
                        <input
                          type="text"
                          value={editProjName}
                          onChange={(e) => setEditProjName(e.target.value)}
                          onBlur={() => handleSaveRename(proj.id)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveRename(proj.id)}
                          autoFocus
                          className="bg-gray-900 border border-purple-500/40 rounded px-1 text-xs text-purple-400 w-full"
                        />
                      ) : (
                        <span 
                          onDoubleClick={() => handleStartRename(proj.id, proj.name)}
                          className="text-xs font-semibold truncate select-none text-gray-200"
                        >
                          {proj.name}
                        </span>
                      )}
                    </div>

                    {/* Actions button */}
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition">
                      <button
                        onClick={() => handleStartRename(proj.id, proj.name)}
                        className="p-1 text-gray-500 hover:text-gray-300"
                        title={t.rename}
                      >
                        <FileText size={11} />
                      </button>
                      <button
                        onClick={() => deleteProject(proj.id)}
                        className="p-1 text-gray-500 hover:text-red-400"
                        title={t.deleteProject}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick specs helper */}
          <div className="p-4 border-t border-theme-border/60 text-[10px] text-gray-500 space-y-1.5 bg-gray-950/20">
            <span className="font-bold flex items-center gap-1 text-gray-400">
              <BookOpen size={12} /> {t.quickGuide}
            </span>
            <p className="leading-relaxed">
              {t.quickGuideBody}
            </p>
          </div>
        </aside>

        {/* MIDDLE WORKSPACE PANELS & RIGHT CHAT WINDOW (Split Screen Layout) */}
        <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          
          {/* DYNAMIC WORKSPACE (LEFT) */}
          <div className="flex-1 flex flex-col border-r border-theme-border overflow-hidden h-1/2 lg:h-auto">
            {/* Steps Workspace Tab selectors */}
            <div className="flex bg-gray-950/40 border-b border-theme-border text-[11px] sm:text-xs font-bold text-gray-400 select-none overflow-x-auto scrollbar-none">
              <button
                onClick={() => setActiveStep('parameters')}
                className={`flex-1 py-3 px-4 text-center border-b-2 flex items-center justify-center gap-1.5 transition whitespace-nowrap ${
                  activeStep === 'parameters'
                    ? `border-${accentColor}-400 text-${accentColor}-400 bg-${accentColor}-500/[0.02]`
                    : 'border-transparent hover:text-gray-200'
                }`}
              >
                {t.step1}
              </button>
              <button
                onClick={() => setActiveStep('prompts')}
                className={`flex-1 py-3 px-4 text-center border-b-2 flex items-center justify-center gap-1.5 transition whitespace-nowrap ${
                  activeStep === 'prompts'
                    ? `border-${accentColor}-400 text-${accentColor}-400 bg-${accentColor}-500/[0.02]`
                    : 'border-transparent hover:text-gray-200'
                }`}
              >
                {t.step2}
              </button>
              <button
                onClick={() => setActiveStep('template')}
                className={`flex-1 py-3 px-4 text-center border-b-2 flex items-center justify-center gap-1.5 transition whitespace-nowrap ${
                  activeStep === 'template'
                    ? `border-${accentColor}-400 text-${accentColor}-400 bg-${accentColor}-500/[0.02]`
                    : 'border-transparent hover:text-gray-200'
                }`}
              >
                {t.stepTemplate}
              </button>
              <button
                onClick={() => setActiveStep('regex')}
                className={`flex-1 py-3 px-4 text-center border-b-2 flex items-center justify-center gap-1.5 transition whitespace-nowrap ${
                  activeStep === 'regex'
                    ? `border-${accentColor}-400 text-${accentColor}-400 bg-${accentColor}-500/[0.02]`
                    : 'border-transparent hover:text-gray-200'
                }`}
              >
                {t.step3}
              </button>
              <button
                onClick={() => setActiveStep('export')}
                className={`flex-1 py-3 px-4 text-center border-b-2 flex items-center justify-center gap-1.5 transition whitespace-nowrap ${
                  activeStep === 'export'
                    ? `border-${accentColor}-400 text-${accentColor}-400 bg-${accentColor}-500/[0.02]`
                    : 'border-transparent hover:text-gray-200'
                }`}
              >
                {t.step4}
              </button>
            </div>

            {/* Active Step Panel Render */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-gray-950/20">
              {activeStep === 'parameters' && <StepParameters />}
              {activeStep === 'prompts' && <StepPrompts />}
              {activeStep === 'template' && <StepTemplate />}
              {activeStep === 'regex' && <StepRegex />}
              {activeStep === 'export' && <StepExport />}
            </div>
          </div>

          {/* CHAT WINDOW (RIGHT) */}
          <div className="w-full lg:w-[420px] xl:w-[480px] border-t lg:border-t-0 border-theme-border flex flex-col h-1/2 lg:h-auto overflow-hidden">
            <ChatWindow onOpenSettings={() => setIsSettingsOpen(true)} />
          </div>

        </main>

      </div>

      {/* 3. Settings Config modal popup */}
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
      />

      {/* 4. Custom Floating Toast alert notification lists */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            onClick={() => removeToast(toast.id)}
            className={`p-3.5 rounded-xl border shadow-xl flex items-center gap-3 cursor-pointer text-xs font-semibold animate-slide-up transition ${
              toast.type === 'success'
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : toast.type === 'error'
                  ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : toast.type === 'warning'
                    ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                    : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
            }`}
          >
            <span>{toast.text}</span>
          </div>
        ))}
      </div>

    </div>
  );
}

export default App;
