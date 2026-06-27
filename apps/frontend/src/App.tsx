import { useState } from 'react';
import { useJobs } from './hooks/useJobs.js';
import { KanbanBoard } from './components/KanbanBoard.js';
import { ProfileForm } from './components/ProfileForm.js';
import { ErrorState } from './components/ErrorState.js';

type Tab = 'board' | 'profile';

export function App() {
  const { jobs, loading, error, updateStatus } = useJobs();
  const [activeTab, setActiveTab] = useState<Tab>('board');

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading jobs…</div>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="bg-gray-100 min-h-screen">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-6">
        <h1 className="text-xl font-bold text-gray-900">PL-JobHunter</h1>
        <nav className="flex gap-1">
          <button
            onClick={() => setActiveTab('board')}
            className={`px-3 py-1.5 text-sm rounded font-medium ${
              activeTab === 'board'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Board
          </button>
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-3 py-1.5 text-sm rounded font-medium ${
              activeTab === 'profile'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Profile
          </button>
        </nav>
      </header>

      {activeTab === 'board' && <KanbanBoard jobs={jobs} updateStatus={updateStatus} />}
      {activeTab === 'profile' && <ProfileForm />}
    </div>
  );
}
