import { useJobs } from './hooks/useJobs.js';
import { KanbanBoard } from './components/KanbanBoard.js';
import { ErrorState } from './components/ErrorState.js';

export function App() {
  const { jobs, loading, error, updateStatus } = useJobs();

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
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">PL-JobHunter</h1>
      </header>
      <KanbanBoard jobs={jobs} updateStatus={updateStatus} />
    </div>
  );
}
