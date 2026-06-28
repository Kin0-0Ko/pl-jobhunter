import { useState, useCallback } from 'react';
import { useJobs } from './hooks/useJobs.js';
import { useFilter } from './hooks/useFilter.js';
import { KanbanBoard } from './components/KanbanBoard.js';
import { FilterBar } from './components/FilterBar.js';
import { AnalyticsWidget } from './components/AnalyticsWidget.js';
import { ProfileForm } from './components/ProfileForm.js';
import { ErrorState } from './components/ErrorState.js';
import { triggerEtl } from './api/client.js';

type Tab = 'board' | 'profile';

export function App() {
  const { jobs, loading, error, updateStatus, refetch } = useJobs();
  const [scanning, setScanning] = useState(false);

  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      await triggerEtl();
    } catch {
      // ETL trigger failed — still wait and refetch
    }
    setTimeout(() => {
      refetch();
      setScanning(false);
    }, 10000);
  }, [refetch]);
  const { filters, setFilters, clearFilters, filteredJobs, topSkills } = useFilter(jobs);
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
        <button
          onClick={() => { void handleScan(); }}
          disabled={scanning}
          className="px-3 py-1.5 text-sm rounded font-medium bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {scanning ? '⏳ Scanning…' : '⚡ Scan Market'}
        </button>
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

      {activeTab === 'board' && (
        <>
          <FilterBar filters={filters} setFilters={setFilters} clearFilters={clearFilters} />
          <div className="flex gap-4 p-4">
            <div className="flex-1 min-w-0">
              <KanbanBoard jobs={filteredJobs} updateStatus={updateStatus} />
            </div>
            <div className="flex-shrink-0">
              <AnalyticsWidget topSkills={topSkills} />
            </div>
          </div>
        </>
      )}
      {activeTab === 'profile' && <ProfileForm />}
    </div>
  );
}
